// Task-level tests for the MIPYME factura surface. No SII: fakes only, synthetic Mod-11-valid
// RUTs, no real PII. The load-bearing guarantees checked here are (a) every input is validated
// BEFORE a session is opened, and (b) the audit receipt never carries receptor/monto/glosa.
import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { FileSink, Runtime } from '../seams/index.js';
import { ValidationError } from '../errors/index.js';
import { initOperateState } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import {
  facturaBorradorDelete,
  facturaBorradorList,
  facturaBorradorSave,
  facturaPreviewPdf,
} from './factura.js';

const SELF = '11111111-1';
const EMPRESA = '76192083-9';
const RECEPTOR = '64000001-5';

const EMPRESAS_HTML =
  '<form name="fPrmEmpPOP"><select name="RUT_EMP"><option value="76192083-9">ACME SPA 76192083-9' +
  '</select></form>';
const OK_BORRADOR = 'Su documento borrador ha sido grabado/actualizado con éxito';
const REVIEW = '<form name="PreViewDTE"><input type="hidden" name="PTDC_CODIGO" value="33"></form>';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

const DOC = {
  empresa: EMPRESA,
  ciudadEmisor: 'SANTIAGO',
  fechaEmision: '2026-09-08',
  receptor: {
    rut: RECEPTOR,
    razonSocial: 'CLIENTE DE PRUEBA SPA',
    direccion: 'Calle Falsa 123',
    comuna: 'Arica',
    ciudad: 'Arica',
    giro: 'Comercio',
  },
  items: [{ nombre: 'Servicio secreto', cantidad: 1, precioUnitario: 1000000 }],
};

/** Scripts the whole observed chain: chooser → form fill → graba/elimina → list → preview PDF. */
function sessionScript(borradores: unknown[] = []) {
  let saved = false;
  return {
    requestForm: (url: string) => {
      if (url.includes('mipeSelEmpresa.cgi?')) return EMPRESAS_HTML;
      if (url.includes('mipeSelEmpresa.cgi')) return '<html>formulario</html>';
      if (url.includes('PreViewFrame'))
        return '<form name="VIEW"><input type="hidden" name="PTDC_CODIGO" value=""></form>';
      return '';
    },
    // the accent-carrying CGIs post a Latin-1 body via requestText
    requestText: (url: string) => {
      if (url.includes('mipeGrabaBorrador.cgi')) {
        saved = true;
        return OK_BORRADOR;
      }
      if (url.includes('mipeEliminaBorrador.cgi')) return 'El borrador ha sido eliminado';
      if (url.includes('mipeDisplayPreView.cgi')) return REVIEW;
      return '';
    },
    requestJson: () =>
      saved ? [...borradores, { ehdr_CODIGO: '5000001', ptdc_CODIGO: '33' }] : borradores,
    requestBinary: () => PDF,
    // `loadBorrador`'s script is the one that verifies the id it got back; `fillScript` doesn't.
    evaluate: (expr: string) =>
      expr.includes('devolvió otro borrador')
        ? { ok: true, fields: { EHDR_CODIGO: '5000001' }, totales: { neto: 1, iva: 0, total: 1 } }
        : {
            ok: true,
            msgs: [],
            missing: [],
            fields: { EFXP_NMB_01: 'Servicio secreto' },
            totales: { neto: 1000000, iva: 190000, total: 1190000 },
          },
  };
}

function makeRuntime(borradores: unknown[] = []): Runtime & { written: string[] } {
  const written: string[] = [];
  const files: FileSink = {
    write: async (dir, name) => {
      written.push(`${dir}/${name}`);
      return `${dir}/${name}`;
    },
  };
  return {
    clock: new FixedClock(new Date('2026-09-08T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({ restoreSession: sessionScript(borradores) }),
    files,
    written,
  };
}

async function seed(runtime: Runtime): Promise<void> {
  await writeSession(runtime.store, { rut: SELF, cookies: ['c'], savedAt: '2026-09-08T12:00:00Z' });
  await initOperateState(runtime.store, {
    selfRut: SELF,
    accountType: 'persona',
    operable: [{ rut: SELF, razonSocial: 'Titular', isSelf: true }],
  });
}

const entries = (rt: Runtime) => (rt.audit as RecordingAuditSink).entries;

describe('factura tasks (fakes, no SII)', () => {
  it('saves a borrador, resolves its new id and audits WITHOUT any PII', async () => {
    const rt = makeRuntime();
    await seed(rt);

    const res = await facturaBorradorSave(rt, DOC);
    expect(res).toMatchObject({
      id: '5000001',
      actualizado: false,
      tipoDte: 33,
      totales: { neto: 1000000, iva: 190000, total: 1190000 },
    });

    const a = entries(rt).at(-1)!;
    expect(a).toMatchObject({
      action: 'factura_borrador_save',
      result: 'ok',
      borradorId: '5000001',
    });
    // The receipt is identifiers only — never the receptor, the montos or the glosas (ADR-006).
    const line = JSON.stringify(a);
    expect(line).not.toContain('Servicio secreto');
    expect(line).not.toContain('1000000');
    expect(line).not.toContain('64000001');
    expect(line).not.toContain('CLIENTE DE PRUEBA');
  });

  it('updates in place when borradorId is given (no id diffing)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const res = await facturaBorradorSave(rt, { ...DOC, borradorId: '5000002' });
    expect(res).toMatchObject({ id: '5000002', actualizado: true });
  });

  it('lists borradores curated, with the empresa SII confirmed', async () => {
    const rt = makeRuntime([
      {
        ehdr_CODIGO: '5000002',
        ptdc_CODIGO: '33',
        ptdc_CODIGO_DESC: 'Factura Electronica',
        efxp_MNT_TOTAL: '990000',
      },
    ]);
    await seed(rt);
    const res = await facturaBorradorList(rt, { empresa: EMPRESA });
    expect(res.empresa).toEqual({ rut: EMPRESA, nombre: 'ACME SPA' });
    expect(res.borradores).toHaveLength(1);
    expect(res.borradores[0]).toMatchObject({ id: '5000002', total: 990000 });
  });

  it('deletes a borrador using the type from the LISTING, not the 33 default', async () => {
    // REVIEW-3: deleting is irreversible; navigating with the wrong PTDC_CODIGO fails
    // confusingly, so the type comes from the borrador's own row.
    const rt = makeRuntime([{ ehdr_CODIGO: '5000001', ptdc_CODIGO: '34' }]);
    await seed(rt);
    const res = await facturaBorradorDelete(rt, { empresa: EMPRESA, borradorId: '5000001' });
    expect(res).toMatchObject({ borradorId: '5000001', tipoDte: 34, eliminado: true });
    expect(entries(rt).at(-1)).toMatchObject({ tipoDte: 34 });
  });

  it('refuses to delete a borrador that is not in the listing', async () => {
    const rt = makeRuntime([]);
    await seed(rt);
    await expect(
      facturaBorradorDelete(rt, { empresa: EMPRESA, borradorId: '9999999' }),
    ).rejects.toThrow(/no existe/);
  });

  it('deletes a borrador and audits the id', async () => {
    const rt = makeRuntime([{ ehdr_CODIGO: '5000001', ptdc_CODIGO: '33' }]);
    await seed(rt);
    const res = await facturaBorradorDelete(rt, { empresa: EMPRESA, borradorId: '5000001' });
    expect(res).toMatchObject({ borradorId: '5000001', eliminado: true });
    expect(entries(rt).at(-1)).toMatchObject({
      action: 'factura_borrador_delete',
      result: 'ok',
      borradorId: '5000001',
    });
  });

  it('writes the preview PDF through FileSink and returns a DESCRIPTOR, never bytes', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const res = await facturaPreviewPdf(rt, { ...DOC, directorio: '/tmp/docs' });
    expect(res).toMatchObject({ bytes: PDF.length, contentType: 'application/pdf' });
    expect(res.archivo).toBe('borrador-33-76192083-9-2026-09-08-64000001.pdf');
    expect(rt.written).toEqual(['/tmp/docs/borrador-33-76192083-9-2026-09-08-64000001.pdf']);
    // the bytes themselves must not be in the result (ADR-022 / ADR-006)
    expect(JSON.stringify(res)).not.toContain('%PDF');
  });

  describe('local validation runs BEFORE any session is opened', () => {
    const noSession = (): Runtime => ({
      clock: new FixedClock(new Date('2026-09-08T12:00:00Z')),
      audit: new RecordingAuditSink(),
      store: new InMemoryKeyValueStore(), // no session seeded: reaching SII would raise NotAuthenticated
      portal: new FakePortalDriver({}),
    });

    it.each([
      ['a malformed empresa RUT', { ...DOC, empresa: '76192083-0' }],
      ['a malformed receptor RUT', { ...DOC, receptor: { ...DOC.receptor, rut: '64000001-9' } }],
      ['an unsupported DTE type', { ...DOC, tipoDte: 52 }],
      ['a bad fecha', { ...DOC, fechaEmision: '08-09-2026' }],
      ['a blank ciudad emisor', { ...DOC, ciudadEmisor: '  ' }],
      ['zero items', { ...DOC, items: [] }],
      [
        'a non-integer precio',
        { ...DOC, items: [{ nombre: 'x', cantidad: 1, precioUnitario: 1.5 }] },
      ],
      [
        'an out-of-range descuento',
        { ...DOC, items: [{ nombre: 'x', cantidad: 1, precioUnitario: 10, descuentoPct: 100 }] },
      ],
    ])('rejects %s without touching SII', async (_label, doc) => {
      await expect(facturaBorradorSave(noSession(), doc as never)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects a non-numeric borrador id on delete', async () => {
      await expect(
        facturaBorradorDelete(noSession(), { empresa: EMPRESA, borradorId: 'abc' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
