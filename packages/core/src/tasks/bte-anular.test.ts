import { describe, expect, it } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  inlineMapsPage,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import { writeSession } from '../auth/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import type { FormRequest, Runtime } from '../seams/index.js';
import { bteAnular } from './bte-anular.js';

const SELF = '20000042-0';
const ARGS = { folio: 17, periodo: '202611', motivo: 3 };
const REVIEW =
  inlineMapsPage({
    xml_values: {
      rut_ctr: '20000042',
      dv_ctr: '0',
      nro_boleta: '17',
      codigo_causa: '3',
      anulada: 'N',
      dia_atencion: '02',
      mes_atencion: '11',
      anio_atencion: '2026',
      Monto_Boleta: '45000',
    },
  }) + '<input name="BtnConfirmar">';

async function scenario(
  options: {
    review?: string;
    initial?: 'missing' | 'already' | 'incomplete' | 'no-report' | 'unknown';
    reviewError?: boolean;
    outcome?:
      | 'annulled'
      | 'timeout'
      | 'timeout-with-effect'
      | 'verification-error'
      | 'incomplete'
      | 'pending';
  } = {},
) {
  const writes: FormRequest[] = [];
  const reviews: FormRequest[] = [];
  const audit = new RecordingAuditSink();
  let annulled = options.initial === 'already';
  const runtime: Runtime = {
    clock: new FixedClock(new Date('2026-11-10T12:00:00Z')),
    audit,
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({
      restoreSession: {
        requestText: () => {
          if (
            options.initial === 'no-report' ||
            (options.outcome === 'verification-error' && writes.length)
          ) {
            return '<html>unavailable</html>';
          }
          const empty = options.initial === 'missing';
          const incomplete =
            options.initial === 'incomplete' || (options.outcome === 'incomplete' && writes.length);
          return inlineMapsPage({
            xml_values: { total_boletas: empty ? '0' : incomplete ? '2' : '1' },
            arr_informe_mensual: empty
              ? {}
              : {
                  nroboleta_1: '17',
                  fecha_boleta_1: '02/11/2026',
                  totalhonorarios_1: '45000',
                  estado_1: annulled
                    ? 'S'
                    : options.initial === 'unknown' ||
                        (options.outcome === 'pending' && writes.length)
                      ? 'V'
                      : 'N',
                  fechaanulacion_1: annulled ? '10/11/2026' : '',
                  nombrereceptor_1: 'SYNTHETIC-COUNTERPARTY',
                },
          });
        },
        requestForm: (url, request = {}) => {
          if (url.endsWith('TMBANU_ConfirmarAnulacion.cgi')) {
            reviews.push(request);
            if (options.reviewError) throw new Error('Review transport failed');
            return options.review ?? REVIEW;
          }
          if (!url.endsWith('TMBANU_RecepcionAnulacion.cgi')) throw new Error('Unexpected route');
          writes.push(request);
          annulled = options.outcome === 'annulled' || options.outcome === 'timeout-with-effect';
          if (options.outcome?.startsWith('timeout')) throw new Error('Response lost');
          return '<html>Submission received</html>';
        },
      },
    }),
  };
  await writeSession(runtime.store, { rut: SELF, cookies: [], savedAt: '2026-11-10T12:00:00Z' });
  return { runtime, reviews, writes, audit };
}

describe('BHE annulment', () => {
  it('rejects a represented identity and a missing session before reaching the form', async () => {
    const { runtime, reviews, writes } = await scenario();
    await initOperateState(runtime.store, {
      selfRut: SELF,
      accountType: 'persona',
      operable: [
        { rut: SELF, razonSocial: 'Synthetic issuer', isSelf: true },
        { rut: '77777777-7', razonSocial: 'Synthetic company', isSelf: false },
      ],
    });
    await setOperatingRut(runtime.store, '77777777-7');
    expect((await bteAnular(runtime, ARGS)).EstadoEjecucion012).toBe(2);
    await runtime.store.delete('session');
    await runtime.store.delete('operate');
    expect((await bteAnular(runtime, ARGS)).EstadoEjecucion012).toBe(2);
    expect(reviews).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('reports a failed review request without sending an annulment', async () => {
    const { runtime, writes } = await scenario({ reviewError: true });
    expect(await bteAnular(runtime, { ...ARGS, confirm: 17 })).toMatchObject({
      EstadoEjecucion012: 2,
      Dato: { envioIntentado: false },
    });
    expect(writes).toHaveLength(0);
  });

  it('reviews the folio without writing when confirmation is omitted', async () => {
    const { runtime, reviews, writes } = await scenario();
    const result = await bteAnular(runtime, ARGS);
    expect(result).toMatchObject({ EstadoEjecucion012: 0, Dato: { EstadoFuncional: 'VIG' } });
    expect(reviews).toMatchObject([
      { form: { origen: 'SEXTO', OptCausaAnulacion: '3', Txt_BoletaAnular: '17' } },
    ]);
    expect(writes).toHaveLength(0);
  });

  it.each([
    { ...ARGS, confirm: 18 },
    { folio: 17, periodo: '202611', confirm: 17 },
    { ...ARGS, motivo: 4, confirm: 17 },
    { ...ARGS, folio: 0, confirm: 0 },
    { ...ARGS, periodo: '202613', confirm: 17 },
  ])('rejects invalid confirmation or reason before opening the form', async (args) => {
    const { runtime, reviews, writes } = await scenario();
    expect((await bteAnular(runtime, args)).EstadoEjecucion012).toBe(2);
    expect(reviews).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it.each([
    ['missing', 0, 'NO_ENCONTRADA'],
    ['already', 0, 'ANUL'],
    ['incomplete', 1, 'INDETERMINADO'],
    ['no-report', 2, 'FALLO'],
    ['unknown', 1, 'INDETERMINADO'],
  ] as const)('handles an initial %s report without submitting', async (initial, state, status) => {
    const { runtime, reviews, writes } = await scenario({ initial });
    expect(await bteAnular(runtime, { ...ARGS, confirm: 17 })).toMatchObject({
      EstadoEjecucion012: state,
      Dato: { EstadoFuncional: status, envioIntentado: false },
    });
    expect(reviews).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it.each([
    [REVIEW.replace('"17"', '"18"'), 1],
    [REVIEW.replace('"20000042"', '"12345670"'), 1],
    [REVIEW.replace('"45000"', '"44000"'), 1],
    [REVIEW.replace('"02"', '"01"'), 1],
    [REVIEW.replace('"3"', '"2"'), 1],
    ['<html>unknown layout</html>', 1],
    ['<html>No ha sido posible completar su solicitud.</html>', 2],
  ])('stops on a mismatched, unrecognized, or rejected review', async (review, state) => {
    const { runtime, writes } = await scenario({ review });
    expect((await bteAnular(runtime, { ...ARGS, confirm: 17 })).EstadoEjecucion012).toBe(state);
    expect(writes).toHaveLength(0);
  });

  it.each(['annulled', 'timeout-with-effect'] as const)(
    'verifies %s using the issued report',
    async (outcome) => {
      const { runtime, writes, audit } = await scenario({ outcome });
      const result = await bteAnular(runtime, { ...ARGS, confirm: 17 });
      expect(result).toMatchObject({
        EstadoEjecucion012: 0,
        Dato: { EstadoFuncional: 'ANUL', envioIntentado: true, fechaAnulacion: '10/11/2026' },
      });
      expect(writes).toEqual([
        {
          followRedirects: false,
          form: {
            rut_arrastre: '20000042',
            dv_arrastre: '0',
            Txt_CodigoCausa: '3',
            Txt_BoletaAnular: '17',
          },
        },
      ]);
      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: 'bte_anular',
          result: 'ANUL',
          folio: 17,
          period: '202611',
        }),
      ]);
      expect(JSON.stringify(audit.entries)).not.toContain('SYNTHETIC-COUNTERPARTY');
      expect((await bteAnular(runtime, { ...ARGS, confirm: 17 })).Dato.envioIntentado).toBe(false);
      expect(writes).toHaveLength(1);
    },
  );

  it.each([
    ['timeout', 0],
    ['incomplete', 1],
    ['verification-error', 2],
    ['pending', 0],
  ] as const)(
    'preserves uncertainty for %s and never replays the POST',
    async (outcome, verification) => {
      const { runtime, writes } = await scenario({ outcome });
      expect(await bteAnular(runtime, { ...ARGS, confirm: 17 })).toMatchObject({
        EstadoEjecucion012: 1,
        Dato: {
          EstadoFuncional: 'INDETERMINADO',
          envioIntentado: true,
          EstadoVerificacion012: verification,
        },
      });
      expect(writes).toHaveLength(1);
    },
  );
});
