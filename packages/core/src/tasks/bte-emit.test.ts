import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { FormRequest, Runtime } from '../seams/index.js';
import { BteError, NotAuthenticatedError, ValidationError } from '../errors/index.js';
import { initOperateState, setOperatingRut } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { bteEmit, bteEmitPreview, type BteEmitArgs } from './bte.js';

// Synthetic data only (no SII, no real PII): emisor 20.000.042-0, receptor 12.345.670-K.
const SELF = '20000042-0';
const EMPRESA = '77777777-7';

// Synthetic HTML fixtures mirroring the observed TMBECN_* responses (single-quoted xml_values;
// confirm-page amounts via formatMiles). Región 13 / comuna 15103 (PROVIDENCIA) are real SII codes.
const FORM_HTML =
  '<html><script>' +
  "xml_values['dia_actual'] = '02';xml_values['mes_actual'] = '07';xml_values['anio_actual'] = '2026';" +
  "xml_values['comuna_ctr'] = 'SANTIAGO';xml_values['fono_ctr'] = '';" +
  "xml_values['glosa_actividad'] = 'SERVICIOS PROFESIONALES';</script>" +
  "<form name='formulario'><select name='cbo_domicilio'>" +
  "<option value='111'>A</option><option value='092726950' selected>B</option></select></form></html>";

const CONFIRM_HTML =
  '<html><script>' +
  'xml_values[\'Monto_Boleta\'] = formatMiles("1000000",".");' +
  'xml_values[\'Monto_Retencion\'] = formatMiles("137500",".");' +
  'xml_values[\'Monto_Liquido\'] = formatMiles("862500",".");' +
  "xml_values['PorcentajeRetencion'] = '13,75';" +
  "xml_values['email_contribuyente'] = 'emisor@example.cl';</script>" +
  "<form name='formulario'>ok</form></html>";

const RESULT_HTML =
  "<html><script>xml_values['cod_barras'] = '200000420000000123DD';" +
  "xml_values['nombre_archivo'] = 'boleta.pdf';</script>ok</html>";

const ENVIO_PREP_HTML =
  "<html><script>xml_values['rut_destinatario'] = '12345670';xml_values['dv_destinatario'] = 'K';" +
  "xml_values['codigo_inferior'] = '1010';xml_values['desc_comuna'] = 'PROVIDENCIA';" +
  "xml_values['nombres_destinatario'] = 'RECEPTOR';</script>ok</html>";

/** Route a requestForm URL to the right synthetic HTML — and record the emit POST for assertions. */
function makeRuntime(opts: { failEmit?: boolean } = {}): Runtime {
  return {
    clock: new FixedClock(new Date('2026-07-02T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({
      restoreSession: {
        cookies: { TOKEN: 't' },
        requestForm: (url: string) => {
          if (url.includes('PresentaDatosEnvio')) return ENVIO_PREP_HTML;
          if (url.includes('EnviarBoleta')) return 'correo enviado exitosamente';
          if (url.includes('ValidaTimbrajeContrib')) return FORM_HTML;
          if (url.includes('PresentaDatosBoleta')) return FORM_HTML;
          if (url.includes('ConfirmaTimbrajeContrib')) return CONFIRM_HTML;
          if (url.includes('BoletaHonorariosElectronica')) {
            return opts.failEmit ? '<html>error, sin boleta</html>' : RESULT_HTML;
          }
          return '';
        },
      },
    }),
  };
}

async function seed(
  runtime: Runtime,
  accountType: 'persona' | 'empresa' = 'persona',
): Promise<void> {
  await writeSession(runtime.store, { rut: SELF, cookies: ['c'], savedAt: '2026-07-02T12:00:00Z' });
  await initOperateState(runtime.store, {
    selfRut: SELF,
    accountType,
    operable: [
      { rut: SELF, razonSocial: 'Juan Pérez', isSelf: true },
      { rut: EMPRESA, razonSocial: 'Mi Empresa SpA', isSelf: false },
    ],
  });
}

const entries = (rt: Runtime) => (rt.audit as RecordingAuditSink).entries;

const baseArgs: BteEmitArgs = {
  receptor: '12345670-K',
  receptorNombre: 'ACME SPA',
  receptorDomicilio: 'Av. Siempre Viva 100',
  region: 13,
  comuna: 15103,
  lineas: [{ glosa: 'Asesoría', monto: 1_000_000 }],
  fecha: { dia: 2, mes: 7, anio: 2026 },
  retiene: 'RECEPTOR',
};

describe('bte emit (fakes, no SII)', () => {
  it('preview returns the server-computed retención/líquido and does NOT issue', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const preview = await bteEmitPreview(rt, baseArgs);
    expect(preview).toEqual({
      totalHonorarios: 1_000_000,
      retencion: 137_500,
      liquido: 862_500,
      porcentajeRetencion: '13,75',
      retiene: 'RECEPTOR',
    });
    // Preview never posts the issue endpoint.
    const audited = entries(rt).at(-1);
    expect(audited).toMatchObject({ action: 'bte_emit_preview', result: 'ok', rut: SELF });
    // No receptor / monto in the receipt (PII / business data).
    expect(JSON.stringify(audited)).not.toContain('12345670');
    expect(JSON.stringify(audited)).not.toContain('1000000');
  });

  it('emit issues and returns the código de barras + PDF url; audits the folio (no PII)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const res = await bteEmit(rt, baseArgs);
    expect(res.codBarras).toBe('200000420000000123DD');
    expect(res.pdfUrl).toContain('txt_codigobarras=200000420000000123DD');
    expect(res.totalHonorarios).toBe(1_000_000);
    const audited = entries(rt).at(-1);
    expect(audited).toMatchObject({
      action: 'bte_emit',
      result: 'ok',
      folio: '200000420000000123DD',
    });
    expect(JSON.stringify(audited)).not.toContain('ACME'); // receptor name never audited
  });

  it('emit sends the confirmed field payload (session-keyed emisor, receptor, líneas)', async () => {
    let emitForm: Record<string, string> | undefined;
    const rt: Runtime = {
      clock: new FixedClock(new Date('2026-07-02T12:00:00Z')),
      audit: new RecordingAuditSink(),
      store: new InMemoryKeyValueStore(),
      portal: new FakePortalDriver({
        restoreSession: {
          cookies: { TOKEN: 't' },
          requestForm: (url: string, options?: FormRequest) => {
            if (url.includes('BoletaHonorariosElectronica')) {
              emitForm = options?.form;
              return RESULT_HTML;
            }
            if (url.includes('ConfirmaTimbrajeContrib')) return CONFIRM_HTML;
            return FORM_HTML;
          },
        },
      }),
    };
    await seed(rt);
    await bteEmit(rt, baseArgs);
    // The 24-field issue payload: session-keyed emisor, receptor, líneas, origen, recomputed
    // CantidadFilas — and NO cod_region/cbo_comuna (dropped from the emit set).
    expect(emitForm).toMatchObject({
      rut_arrastre: '20000042',
      dv_arrastre: '0',
      OptTipoRetencion: 'RETRECEPTOR',
      txt_rut_destinatario: '12345670',
      txt_dv_destinatario: 'K',
      txt_comuna_destinatario: 'PROVIDENCIA',
      desc_prestacion_1: 'Asesoría',
      valor_prestacion_1: '1000000',
      origen: 'SEPTIMO',
      CantidadFilas: '1',
      cbo_domicilio: '092726950',
    });
    expect(emitForm).not.toHaveProperty('cod_region');
    expect(emitForm).not.toHaveProperty('cbo_comuna');
  });

  it('rejects a malformed RUT / bad monto / bad region-comuna BEFORE any session', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await expect(bteEmitPreview(rt, { ...baseArgs, receptor: 'not-a-rut' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      bteEmitPreview(rt, { ...baseArgs, lineas: [{ glosa: 'x', monto: -5 }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      bteEmitPreview(rt, { ...baseArgs, region: 13, comuna: 9999 }),
    ).rejects.toBeInstanceOf(BteError);
    // A date outside ±3 months.
    await expect(
      bteEmitPreview(rt, { ...baseArgs, fecha: { dia: 1, mes: 1, anio: 2020 } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(entries(rt).some((e) => String(e.action).startsWith('bte_emit'))).toBe(false);
  });

  it('is session-keyed: a representing operate pointer is REJECTED up front (no session)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await setOperatingRut(rt.store, EMPRESA);
    await expect(bteEmit(rt, baseArgs)).rejects.toBeInstanceOf(BteError);
    await expect(bteEmit(rt, baseArgs)).rejects.toThrow('77.777.777-7');
    await expect(bteEmit(rt, baseArgs)).rejects.not.toThrow('Mi Empresa SpA'); // razón social = PII
  });

  it('no session → NotAuthenticated', async () => {
    const rt = makeRuntime();
    // No writeSession — withSession raises NotAuthenticated.
    await initOperateState(rt.store, { selfRut: SELF, accountType: 'persona', operable: [] });
    await expect(bteEmit(rt, baseArgs)).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('a missing código de barras on the result page → BteError (no false success)', async () => {
    const rt = makeRuntime({ failEmit: true });
    await seed(rt);
    await expect(bteEmit(rt, baseArgs)).rejects.toBeInstanceOf(BteError);
  });
});
