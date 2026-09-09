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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FileSink, Runtime } from '../seams/index.js';
import { DteError, ValidationError } from '../errors/index.js';
import { initOperateState } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import {
  dteEmpresas,
  dteEmitidos,
  dtePdf,
  dteBorradorDelete,
  dteBorradorList,
  dteBorradorSave,
  dtePreviewPdf,
} from './dte.js';

const SELF = '11111111-1';
const EMPRESA = '76192083-9';
const RECEPTOR = '64000001-5';

const EMPRESAS_HTML =
  '<form name="fPrmEmpPOP"><select name="RUT_EMP"><option value="76192083-9">ACME SPA 76192083-9' +
  '</select></form>';
const OK_BORRADOR = 'Su documento borrador ha sido grabado/actualizado con éxito';
const REVIEW = '<form name="PreViewDTE"><input type="hidden" name="PTDC_CODIGO" value="33"></form>';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const EMITIDAS_HTML =
  '<table><tr><td><a href="/cgi-bin/Portal001/mipeGesDocEmi.cgi?ALL_PAGE_ANT=2&CODIGO=99001">' +
  '<img src="x"></a></td><td>64000001-5 <td>CLIENTE DE PRUEBA SPA</td>' +
  '<td>Factura Electronica</td><td>7</td><td>2026-09-08</td><td>1190000</td>' +
  '<td>Documento Emitido</td></tr></table>';

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
      if (url.includes('mipeAdminDocsEmi.cgi')) return EMITIDAS_HTML;
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

    const res = await dteBorradorSave(rt, DOC);
    expect(res).toMatchObject({
      id: '5000001',
      actualizado: false,
      tipoDte: 33,
      totales: { neto: 1000000, iva: 190000, total: 1190000 },
    });

    const a = entries(rt).at(-1)!;
    expect(a).toMatchObject({
      action: 'dte_borrador_save',
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
    const res = await dteBorradorSave(rt, { ...DOC, borradorId: '5000002' });
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
    const res = await dteBorradorList(rt, { empresa: EMPRESA });
    expect(res.empresa).toEqual({ rut: EMPRESA, nombre: 'ACME SPA' });
    expect(res.borradores).toHaveLength(1);
    expect(res.borradores[0]).toMatchObject({ id: '5000002', total: 990000 });
  });

  it('deletes a borrador using the type from the LISTING, not the 33 default', async () => {
    // REVIEW-3: deleting is irreversible; navigating with the wrong PTDC_CODIGO fails
    // confusingly, so the type comes from the borrador's own row.
    const rt = makeRuntime([{ ehdr_CODIGO: '5000001', ptdc_CODIGO: '34' }]);
    await seed(rt);
    const res = await dteBorradorDelete(rt, { empresa: EMPRESA, borradorId: '5000001' });
    expect(res).toMatchObject({ borradorId: '5000001', tipoDte: 34, eliminado: true });
    expect(entries(rt).at(-1)).toMatchObject({ tipoDte: 34 });
  });

  it('refuses to delete a borrador that is not in the listing', async () => {
    const rt = makeRuntime([]);
    await seed(rt);
    await expect(
      dteBorradorDelete(rt, { empresa: EMPRESA, borradorId: '9999999' }),
    ).rejects.toThrow(/no existe/);
  });

  it('deletes a borrador and audits the id', async () => {
    const rt = makeRuntime([{ ehdr_CODIGO: '5000001', ptdc_CODIGO: '33' }]);
    await seed(rt);
    const res = await dteBorradorDelete(rt, { empresa: EMPRESA, borradorId: '5000001' });
    expect(res).toMatchObject({ borradorId: '5000001', eliminado: true });
    expect(entries(rt).at(-1)).toMatchObject({
      action: 'dte_borrador_delete',
      result: 'ok',
      borradorId: '5000001',
    });
  });

  it('writes the preview PDF through FileSink and returns a DESCRIPTOR, never bytes', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const res = await dtePreviewPdf(rt, { ...DOC, directorio: '/tmp/docs' });
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
      await expect(dteBorradorSave(noSession(), doc as never)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects a non-numeric borrador id on delete', async () => {
      await expect(
        dteBorradorDelete(noSession(), { empresa: EMPRESA, borradorId: 'abc' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});

describe('retry policy (CONVENTIONS: never retry after a SII block)', () => {
  class Timeout extends Error {
    override name = 'TimeoutError';
  }
  const runtimeWith = (fail: () => never, calls: { n: number }): Runtime => ({
    clock: new FixedClock(new Date('2026-09-08T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({
      restoreSession: {
        requestForm: (url: string) => {
          if (url.includes('mipeSelEmpresa.cgi?')) {
            calls.n += 1;
            fail();
          }
          return '';
        },
      },
    }),
  });

  it('does NOT retry a 429 / rate-limit answered by SII', async () => {
    const calls = { n: 0 };
    const rt = runtimeWith(() => {
      throw new DteError('429 Too Many Requests');
    }, calls);
    await seed(rt);
    await expect(dteEmpresas(rt, {})).rejects.toThrow(/429/);
    expect(calls.n).toBe(1); // one attempt only — a block is never retried
  });

  it('does NOT retry a message that merely contains a 5xx-looking number', async () => {
    const calls = { n: 0 };
    const rt = runtimeWith(() => {
      throw new Error('El folio 512 no existe');
    }, calls);
    await seed(rt);
    await expect(dteEmpresas(rt, {})).rejects.toThrow(/folio 512/);
    expect(calls.n).toBe(1);
  });

  it('DOES retry a genuine transport timeout, at most twice', async () => {
    const calls = { n: 0 };
    const rt = runtimeWith(() => {
      throw new Timeout('apiRequestContext.fetch: Timeout 30000ms exceeded.');
    }, calls);
    await seed(rt);
    await expect(dteEmpresas(rt, {})).rejects.toThrow(/Timeout/);
    expect(calls.n).toBe(3); // initial + 2 retries
  });

  it('uses the Clock for jitter, so the core stays deterministic', () => {
    const src = readFileSync(fileURLToPath(new URL('./dte.ts', import.meta.url)), 'utf8');
    expect(src).not.toContain('Math.random');
    expect(src).toContain('runtime.clock.now().getTime() % 250');
  });
});

describe('documentos emitidos (#91)', () => {
  it('lists emitted documents and audits count only (no PII)', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const res = await dteEmitidos(rt, { empresa: EMPRESA });
    expect(res.documentos).toHaveLength(1);
    expect(res.documentos[0]).toMatchObject({ folio: 7, codigo: '99001' });
    const a = entries(rt).at(-1)!;
    expect(a).toMatchObject({ action: 'dte_emitidos', result: 'ok', count: 1 });
    expect(JSON.stringify(a)).not.toContain('CLIENTE DE PRUEBA');
  });

  it('validates a receptor RUT and the dates BEFORE opening a session', async () => {
    const noSession: Runtime = {
      clock: new FixedClock(new Date('2026-09-08T12:00:00Z')),
      audit: new RecordingAuditSink(),
      store: new InMemoryKeyValueStore(),
      portal: new FakePortalDriver({}),
    };
    await expect(
      dteEmitidos(noSession, { empresa: EMPRESA, receptor: '64000001-9' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      dteEmitidos(noSession, { empresa: EMPRESA, desde: '08-09-2026' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('downloads by folio and returns a DESCRIPTOR, never the bytes', async () => {
    const rt = makeRuntime();
    await seed(rt);
    const res = await dtePdf(rt, { empresa: EMPRESA, folio: 7, directorio: '/tmp/docs' });
    expect(res).toMatchObject({ bytes: PDF.length, contentType: 'application/pdf' });
    expect(res.archivo).toBe('dte-7-76192083-9-2026-09-08.pdf');
    expect(rt.written).toEqual(['/tmp/docs/dte-7-76192083-9-2026-09-08.pdf']);
    expect(JSON.stringify(res)).not.toContain('%PDF');
    expect(entries(rt).at(-1)).toMatchObject({ action: 'dte_pdf', result: 'ok', folio: 7 });
  });

  it('fails clearly when the folio is not in the listing', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await expect(
      dtePdf(rt, { empresa: EMPRESA, folio: 999, directorio: '/tmp/docs' }),
    ).rejects.toThrow(/No se encontró un documento emitido con folio 999/);
  });

  it('requires a folio or a codigo', async () => {
    const rt = makeRuntime();
    await seed(rt);
    await expect(dtePdf(rt, { empresa: EMPRESA, directorio: '/tmp/docs' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('GH-93: emitidas/pdf follow the patterns settled in #90', () => {
  class TimeoutErr extends Error {
    override name = 'TimeoutError';
  }
  /** A runtime whose emitted-listing read fails `fail()` every time, counting the chooser POSTs
   *  and the listing reads separately — so a retry can be seen to repeat ONE and not the other. */
  const runtimeCounting = (fail: () => never, counts: { sel: number; list: number }): Runtime => ({
    clock: new FixedClock(new Date('2026-09-08T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({
      restoreSession: {
        requestForm: (url: string) => {
          if (url.includes('mipeSelEmpresa.cgi?')) {
            counts.sel += 1;
            return EMPRESAS_HTML;
          }
          if (url.includes('mipeSelEmpresa.cgi')) return '<html>formulario</html>';
          if (url.includes('mipeAdminDocsEmi.cgi')) {
            counts.list += 1;
            fail();
          }
          return '';
        },
      },
    }),
  });

  it('retries the LISTING only — the empresa selection is session state, never replayed', async () => {
    const counts = { sel: 0, list: 0 };
    const rt = runtimeCounting(() => {
      throw new TimeoutErr('apiRequestContext.fetch: Timeout 30000ms exceeded.');
    }, counts);
    await seed(rt);
    await expect(dteEmitidos(rt, { empresa: EMPRESA })).rejects.toThrow(/Timeout/);
    expect(counts.list).toBe(3); // initial + 2 retries
    expect(counts.sel).toBe(1); // the chooser GET/POST happened exactly once
  });

  it('still never retries a SII block on the listing', async () => {
    const counts = { sel: 0, list: 0 };
    const rt = runtimeCounting(() => {
      throw new DteError('429 Too Many Requests');
    }, counts);
    await seed(rt);
    await expect(dteEmitidos(rt, { empresa: EMPRESA })).rejects.toThrow(/429/);
    expect(counts.list).toBe(1);
  });

  /** Pages the emitted listing: page 1 holds CODIGO=99001, page 2 holds CODIGO=99002. */
  const pagedRuntime = (reads: string[]): Runtime => ({
    clock: new FixedClock(new Date('2026-09-08T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    files: { write: async (dir: string, name: string) => `${dir}/${name}` } as FileSink,
    portal: new FakePortalDriver({
      restoreSession: {
        requestForm: (url: string) => {
          if (url.includes('mipeSelEmpresa.cgi?')) return EMPRESAS_HTML;
          if (url.includes('mipeSelEmpresa.cgi')) return '<html>formulario</html>';
          if (url.includes('mipeAdminDocsEmi.cgi')) {
            reads.push(url);
            const pag = /NUM_PAG=(\d+)/.exec(url)?.[1] ?? '1';
            if (pag === '1') return EMITIDAS_HTML;
            if (pag === '2') return EMITIDAS_HTML.replace(/99001/g, '99002').replace('>7<', '>8<');
            return '<html><h1>Documentos Emitidos</h1>No se encontraron documentos</html>';
          }
          return '';
        },
        requestBinary: () => PDF,
      },
    }),
  });

  it('walks pages to reach a document by codigo, and paces the walk', async () => {
    const reads: string[] = [];
    const rt = pagedRuntime(reads);
    await seed(rt);
    const res = await dtePdf(rt, {
      empresa: EMPRESA,
      codigo: '99002',
      directorio: '/tmp/docs',
    });
    expect(res.documento.codigo).toBe('99002');
    expect(reads.map((u) => /NUM_PAG=(\d+)/.exec(u)?.[1])).toEqual(['1', '2']);
  });

  it('a folio is filtered server-side — one read, whatever page it lives on', async () => {
    const reads: string[] = [];
    const rt = pagedRuntime(reads);
    await seed(rt);
    await dtePdf(rt, { empresa: EMPRESA, folio: 7, directorio: '/tmp/docs' });
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('FOLIO=7');
  });

  it('an unreachable codigo reports how far it looked, and stops at the bound', async () => {
    const reads: string[] = [];
    const rt = pagedRuntime(reads);
    await seed(rt);
    await expect(
      dtePdf(rt, { empresa: EMPRESA, codigo: '99999', directorio: '/tmp/docs' }),
    ).rejects.toThrow(/recorrer el listado completo \(3 página\(s\)\)/);
    // page 3 comes back empty, which ends the walk before the 20-page bound
    expect(reads).toHaveLength(3);
  });

  /** A listing whose CGI CLAMPS an out-of-range NUM_PAG to the last page instead of emptying
   *  it — the legacy behaviour the walk must not spin on. Every page returns page 1's rows. */
  const clampingRuntime = (reads: string[]): Runtime => ({
    clock: new FixedClock(new Date('2026-09-08T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    files: { write: async (dir: string, name: string) => `${dir}/${name}` } as FileSink,
    portal: new FakePortalDriver({
      restoreSession: {
        requestForm: (url: string) => {
          if (url.includes('mipeSelEmpresa.cgi?')) return EMPRESAS_HTML;
          if (url.includes('mipeSelEmpresa.cgi')) return '<html>formulario</html>';
          if (url.includes('mipeAdminDocsEmi.cgi')) {
            reads.push(url);
            return EMITIDAS_HTML; // same rows forever
          }
          return '';
        },
        requestBinary: () => PDF,
      },
    }),
  });

  it('stops when a page repeats the previous one — a clamping CGI is not spun on', async () => {
    const reads: string[] = [];
    const rt = clampingRuntime(reads);
    await seed(rt);
    await expect(
      dtePdf(rt, { empresa: EMPRESA, codigo: '99999', directorio: '/tmp/docs' }),
    ).rejects.toThrow(/recorrer el listado completo \(2 página\(s\)\)/);
    expect(reads).toHaveLength(2); // page 1, page 2 == page 1 ⇒ stop, not 20 requests
  });

  /** Every page distinct and non-empty: the walk can only end at the bound. */
  const endlessRuntime = (reads: string[]): Runtime => ({
    clock: new FixedClock(new Date('2026-09-08T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    files: { write: async (dir: string, name: string) => `${dir}/${name}` } as FileSink,
    portal: new FakePortalDriver({
      restoreSession: {
        requestForm: (url: string) => {
          if (url.includes('mipeSelEmpresa.cgi?')) return EMPRESAS_HTML;
          if (url.includes('mipeSelEmpresa.cgi')) return '<html>formulario</html>';
          if (url.includes('mipeAdminDocsEmi.cgi')) {
            reads.push(url);
            const pag = /NUM_PAG=(\d+)/.exec(url)?.[1] ?? '1';
            return EMITIDAS_HTML.replace(/99001/g, `99${pag.padStart(3, '0')}`);
          }
          return '';
        },
        requestBinary: () => PDF,
      },
    }),
  });

  it('respects the 20-page bound and says the walk was cut short', async () => {
    const reads: string[] = [];
    const rt = endlessRuntime(reads);
    await seed(rt);
    await expect(
      dtePdf(rt, { empresa: EMPRESA, codigo: '99999', directorio: '/tmp/docs' }),
    ).rejects.toThrow(/tras revisar 20 página\(s\), el tope del recorrido/);
    expect(reads).toHaveLength(20);
  });
});
