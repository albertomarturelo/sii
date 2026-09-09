// Facade tests for the MIPYME factura surface. No real SII: the fake session scripts the
// observed wire shapes (docs/sii-contract/dte-mipyme.md, captured 2026-09-08). Synthetic,
// Mod-11-valid RUTs only — never real PII.
import { describe, expect, it } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { DteError } from '../errors/index.js';
import { LOGIN_HOST } from '../config/index.js';
import { Rut } from '../rut/index.js';
import {
  eliminaBorrador,
  fetchEmitidaPdf,
  fetchEmitidas,
  parseEmitidas,
  fetchBorradores,
  fetchEmpresas,
  fetchPreviewPdf,
  parseChooser,
  fillFactura,
  grabaBorrador,
  loadBorrador,
  resolveAndSelectEmpresa,
} from './dte-mipyme.js';
import type { DteEmpresa } from './dte-mipyme.js';
import { repairMojibake, frameFields, contribuyenteError, latin1FormBody } from './dte-mipyme.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The facade source. The in-page fill script is a STRING, so its invariants (waiting for real
 *  selectors, select-aware assignment, no event on the receptor RUT) are asserted against the
 *  source directly — a browser-level test would need a live SII page. */
const facturaSource = (): string =>
  readFileSync(fileURLToPath(new URL('./dte-mipyme.ts', import.meta.url)), 'utf8');
const fillScriptSource = (): string => {
  const src = facturaSource();
  return src.slice(src.indexOf('function fillScript'));
};

/** The `RUT_EMP` select exactly as SII serves it: unclosed `<option>`, label repeats the RUT. */
const EMPRESAS_HTML = `<form name="fPrmEmpPOP" method="post">
  <select class="form-control" name="RUT_EMP">
    <optgroup label="Seleccione una opcion">
      <option value="76192083-9">ACME REPUESTOS SPA 76192083-9
      <option value="77111222-6">TALLER DEL SUR LTDA 77111222-6
    </optgroup>
  </select></form>`;

const EMPRESA: DteEmpresa = { rut: '76192083-9', nombre: 'ACME REPUESTOS SPA' };

const INPUT = {
  empresa: '76192083-9',
  tipoDte: 33 as const,
  fechaEmision: '2026-09-08',
  ciudadEmisor: 'SANTIAGO',
  receptor: {
    rut: '64000001',
    dv: '5',
    razonSocial: 'CLIENTE DE PRUEBA SPA',
    direccion: 'Calle Falsa 123',
    comuna: 'Arica',
    ciudad: 'Arica',
    giro: 'Comercio',
  },
  items: [{ nombre: 'Servicio', cantidad: 1, precioUnitario: 1000 }],
  formaPago: 'credito' as const,
};

/** A fill that SII's own validator accepted. */
const okFill = () => ({
  ok: true,
  msgs: [],
  missing: [],
  fields: { EFXP_NMB_01: 'Servicio', EFXP_MNT_TOTAL: '1190' },
  totales: { neto: 1000, iva: 190, total: 1190 },
});

describe('fetchEmpresas', () => {
  it('parses the authorized list and strips the RUT repeated in the label', async () => {
    const s = new FakePortalSession({ requestForm: () => EMPRESAS_HTML });
    await expect(fetchEmpresas(s, 33)).resolves.toEqual([
      { rut: '76192083-9', nombre: 'ACME REPUESTOS SPA' },
      { rut: '77111222-6', nombre: 'TALLER DEL SUR LTDA' },
    ]);
  });

  it('fails loudly when the select is gone (scraper roto)', async () => {
    const s = new FakePortalSession({ requestForm: () => '<html>mantención</html>' });
    await expect(fetchEmpresas(s, 33)).rejects.toBeInstanceOf(DteError);
  });
});

describe('resolveAndSelectEmpresa', () => {
  it('selects a RUT that is in the list', async () => {
    const s = new FakePortalSession({
      requestForm: (url) => (url.includes('?') ? EMPRESAS_HTML : '<html>formulario</html>'),
    });
    await expect(resolveAndSelectEmpresa(s, Rut.parse('76192083-9'), 33)).resolves.toEqual(EMPRESA);
  });

  it('rejects a RUT outside the MIPYME list and names the available ones', async () => {
    const s = new FakePortalSession({ requestForm: () => EMPRESAS_HTML });
    await expect(resolveAndSelectEmpresa(s, Rut.parse('77777777-7'), 33)).rejects.toThrow(
      /no está en tus empresas.*76192083-9/s,
    );
  });

  it('rejects when SII bounces back to the chooser', async () => {
    const s = new FakePortalSession({ requestForm: () => EMPRESAS_HTML }); // POST returns the form again
    await expect(resolveAndSelectEmpresa(s, Rut.parse('76192083-9'), 33)).rejects.toThrow(
      /no aceptó la empresa/,
    );
  });
});

describe('fillFactura', () => {
  it('navigates to the blank form and returns SII-computed totals', async () => {
    const s = new FakePortalSession({ evaluate: okFill });
    const r = await fillFactura(s, EMPRESA, INPUT);
    expect(r.totales).toEqual({ neto: 1000, iva: 190, total: 1190 });
    expect(s.gotos[0]).toContain('mipeGenFacEx.cgi?PTDC_CODIGO=33');
    expect(s.gotos[0]).not.toContain('ES_BORR');
  });

  it('navigates to the borrador URL when updating one', async () => {
    const s = new FakePortalSession({ evaluate: okFill });
    await fillFactura(s, EMPRESA, { ...INPUT, borradorId: '5000001' });
    expect(s.gotos[0]).toContain('ES_BORR=TRUE&VALOR=5000001');
    expect(s.gotos[0]).toContain('RUT=76192083&DV=9');
  });

  it("passes SII's own validation message through verbatim", async () => {
    const s = new FakePortalSession({
      evaluate: () => ({ ok: false, msgs: ['Debe ingresar Ciudad del contribuyente emisor'] }),
    });
    await expect(fillFactura(s, EMPRESA, INPUT)).rejects.toThrow(
      'Debe ingresar Ciudad del contribuyente emisor',
    );
  });

  it('fails loudly when the form lost a field (scraper roto)', async () => {
    const s = new FakePortalSession({ evaluate: () => ({ ok: true, missing: ['EFXP_NMB_01'] }) });
    await expect(fillFactura(s, EMPRESA, INPUT)).rejects.toThrow(/cambió de forma.*EFXP_NMB_01/);
  });

  it('rejects a login-wall / wrong landing', async () => {
    // the login host is config's to own, never a literal (ADR-004)
    const s = new FakePortalSession({ landingUrl: `https://${LOGIN_HOST}/AUT2000/` });
    await expect(fillFactura(s, EMPRESA, INPUT)).rejects.toThrow(/no entregó el formulario/);
  });
});

describe('grabaBorrador', () => {
  it('POSTs the filled form with ES_BORR=TRUE and accepts the confirmation', async () => {
    const s = new FakePortalSession({
      requestText: () => 'Su documento borrador ha sido grabado/actualizado con éxito',
    });
    await grabaBorrador(s, {
      fields: { EFXP_NMB_01: 'x' },
      totales: { neto: 1, iva: 0, total: 1 },
    });
    expect(s.lastTextRequest?.url).toContain('mipeGrabaBorrador.cgi');
    expect(s.lastTextRequest?.options?.body).toContain('ES_BORR=TRUE');
  });

  it('fails when SII does not confirm', async () => {
    const s = new FakePortalSession({ requestText: () => '<p>La empresa no está autorizada</p>' });
    await expect(
      grabaBorrador(s, { fields: {}, totales: { neto: 0, iva: 0, total: 0 } }),
    ).rejects.toThrow(/no está autorizada/);
  });
});

describe('loadBorrador', () => {
  it('refuses a borrador SII substituted for another', async () => {
    const s = new FakePortalSession({
      evaluate: () => ({ scraper: 'el SII devolvió otro borrador (999)' }),
    });
    await expect(loadBorrador(s, EMPRESA, 33, '5000001')).rejects.toThrow(/otro borrador/);
  });
});

describe('fetchBorradores', () => {
  it('curates the listing columns and drops the ~250 null form columns', async () => {
    const s = new FakePortalSession({
      requestJson: () => [
        {
          ehdr_CODIGO: '5000001',
          ptdc_CODIGO: '33',
          ptdc_CODIGO_DESC: 'Factura Electronica',
          efxp_FCH_EMIS: '2026-09-08 15:49:20',
          efxp_RUT_RECEP: '64000001',
          efxp_DV_RECEP: '5',
          efxp_RZN_SOC_RECEP: 'CLIENTE DE PRUEBA SPA',
          efxp_RZN_SOC: 'ACME REPUESTOS SPA',
          efxp_IVA: '190000',
          efxp_MNT_TOTAL: '1190000',
          efxp_NMB_07: null,
        },
      ],
    });
    const rows = await fetchBorradores(s);
    expect(rows).toEqual([
      {
        id: '5000001',
        tipoDte: 33,
        tipoDteDesc: 'Factura Electronica',
        fecha: '2026-09-08 15:49:20',
        receptorRut: '64000001-5',
        receptorNombre: 'CLIENTE DE PRUEBA SPA',
        emisorNombre: 'ACME REPUESTOS SPA',
        iva: 190000,
        total: 1190000,
      },
    ]);
    // no `raw`: the row is receptor + emisor identity (ADR-004)
    expect(Object.keys(rows[0] ?? {})).not.toContain('raw');
  });

  it('treats an empty list as zero borradores, not an error', async () => {
    const s = new FakePortalSession({ requestJson: () => [] });
    await expect(fetchBorradores(s)).resolves.toEqual([]);
  });
});

describe('fetchPreviewPdf', () => {
  const REVIEW = `<form name="PreViewDTE" method="post" action="/cgi-bin/Portal001/mipeGenFacEx.cgi">
    <input type="hidden" name="PTDC_CODIGO" value="33">
    <input type="hidden" name="EFXP_RZN_SOC" value="ACME &amp; CIA" maxlength="110">
    </form>`;
  // The PDF body is built from the iframe's own VIEW form, so the fake must serve it too.
  const FRAME = `<html><body onLoad="Enviar();">
    <form action="/cgi-bin/Portal001/mipePreView.cgi" name="VIEW" method="post">
      <input type="hidden" name="EFXP_RZN_SOC" value="">
      <input type="hidden" name="PTDC_CODIGO" value="">
    </form></body></html>`;
  const serveFrame = (): string => FRAME;
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

  it('posts the PreViewDTE body to the PDF CGI and returns the bytes', async () => {
    const s = new FakePortalSession({
      requestForm: serveFrame,
      requestText: () => REVIEW,
      requestBinary: () => PDF,
    });
    await expect(
      fetchPreviewPdf(s, {
        fields: { EFXP_RZN_SOC: 'ACME & CIA', PTDC_CODIGO: '33' },
        totales: { neto: 1, iva: 0, total: 1 },
      }),
    ).resolves.toEqual(PDF);
    expect(s.lastBinaryRequest?.url).toContain('mipePreView.cgi');
    // values come from the review page, but the FIELD SET comes from the iframe's VIEW form
    expect(s.lastBinaryRequest?.options?.body).toContain('EFXP_RZN_SOC=ACME+%26+CIA');
  });

  it('rejects when SII answers 200 with an error page instead of a PDF (ADR-022)', async () => {
    const s = new FakePortalSession({
      requestForm: serveFrame,
      requestText: () => REVIEW,
      requestBinary: () => ({
        status: 200,
        contentType: 'text/html',
        bytes: new Uint8Array([0x3c, 0x68, 0x74, 0x6d]),
      }),
    });
    await expect(
      fetchPreviewPdf(s, { fields: {}, totales: { neto: 0, iva: 0, total: 0 } }),
    ).rejects.toThrow(/no devolvió un PDF/);
  });

  it('rejects when the review page has no PreViewDTE form', async () => {
    const s = new FakePortalSession({ requestText: () => '<html>error</html>' });
    await expect(
      fetchPreviewPdf(s, { fields: {}, totales: { neto: 0, iva: 0, total: 0 } }),
    ).rejects.toThrow(/no entregó la vista previa/);
  });
});

// --- Regressions for the four failures observed live on 2026-09-08 -------------------
describe('regressions (live 2026-09-08)', () => {
  it('BUG-1: repairs SII double-encoded text, leaving clean text untouched', () => {
    expect(repairMojibake('Fundaci\u00c3\u00b3n Educacional \u00c3\u0091u\u00c3\u00b1oa')).toBe(
      'Fundaci\u00f3n Educacional \u00d1u\u00f1oa',
    );
    expect(repairMojibake('Fundaci\u00f3n Educacional \u00d1u\u00f1oa')).toBe(
      'Fundaci\u00f3n Educacional \u00d1u\u00f1oa',
    );
    expect(repairMojibake('TALLER DEL SUR LTDA')).toBe('TALLER DEL SUR LTDA');
  });

  it('BUG-1: curated listing rows come back repaired', async () => {
    const s = new FakePortalSession({
      requestJson: () => [
        {
          ehdr_CODIGO: '5000001',
          ptdc_CODIGO: '33',
          efxp_RZN_SOC_RECEP: 'Fundaci\u00c3\u00b3n Educacional \u00c3\u0091u\u00c3\u00b1oa',
        },
      ],
    });
    const rows = await fetchBorradores(s);
    expect(rows[0]?.receptorNombre).toBe('Fundaci\u00f3n Educacional \u00d1u\u00f1oa');
  });

  it('BUG-2: surfaces a scraper error when the async detail grid never draws', async () => {
    const s = new FakePortalSession({
      evaluate: () => ({ scraper: 'la grilla de detalle no se dibujo' }),
    });
    await expect(fillFactura(s, EMPRESA, INPUT)).rejects.toThrow(/grilla de detalle/);
  });

  it('BUG-2: the fill script waits for real selectors, never a blind sleep', () => {
    const src = fillScriptSource();
    expect(src).toContain("waitFor(['EFXP_NMB_01', 'DESCRIP_01', 'CANT_DET']");
    expect(src).toContain("waitFor(['EFXP_DSC_ITEM_'");
    // every setTimeout in the in-page scripts is a short POLL TICK, never a blind wait:
    // no timer of 100 ms or more is allowed anywhere in the facade.
    expect(facturaSource()).not.toMatch(/setTimeout\([^,]+,\s*\d{3,}\)/);
    // and the waits are bounded by a deadline rather than a fixed number of ticks
    expect(src).toContain('Date.now() + ');
  });

  it('BUG-3: select receptor fields are matched by option, never blanked', () => {
    const src = fillScriptSource();
    expect(src).toContain("e.tagName === 'SELECT'");
    expect(src).toContain('o.value === v');
    expect(src).toContain('norm(o.text) === want');
    expect(src).toContain('coerced.push');
  });

  it('BUG-3: never fires a change event on the receptor RUT (it reloads the form)', () => {
    const src = fillScriptSource();
    expect(src).toContain("put('EFXP_RUT_RECEP', P.receptor.rut);");
    expect(src).toContain("put('EFXP_DV_RECEP', P.receptor.dv);");
    expect(src).toContain("put('EFXP_QTY_' + s, it.cantidad, true);");
  });

  it('BUG-4: the PDF POST reproduces the iframe request (Referer/Origin/dest)', async () => {
    const s = new FakePortalSession({
      requestForm: () =>
        '<form name="VIEW"><input name="A" value=""><input name="EFXP_FOLIO" value="0"></form>',
      requestText: () => '<form name="PreViewDTE"><input type="hidden" name="A" value="1"></form>',
      requestBinary: () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    });
    await fetchPreviewPdf(s, { fields: { A: '1' }, totales: { neto: 1, iva: 0, total: 1 } });
    // EFXP_FOLIO is absent from the review page ⇒ the frame's own "0" must be sent, not ''
    expect(s.lastBinaryRequest?.options?.body).toContain('EFXP_FOLIO=0');
    const h = s.lastBinaryRequest?.options?.headers ?? {};
    expect(h['Referer']).toBe('https://www1.sii.cl/Portal001/PreViewFrame.html');
    expect(h['Origin']).toBe('https://www1.sii.cl');
    expect(h['Sec-Fetch-Dest']).toBe('iframe');
    expect(h['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(s.lastBinaryRequest?.options?.method).toBe('POST');
  });

  it('BUG-4: paces the two consecutive preview POSTs', async () => {
    const s = new FakePortalSession({
      requestForm: () => '<form name="VIEW"><input type="hidden" name="A" value=""></form>',
      requestText: () => '<form name="PreViewDTE"><input type="hidden" name="A" value="1"></form>',
      requestBinary: () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    });
    let paced = 0;
    await fetchPreviewPdf(
      s,
      { fields: { A: '1' }, totales: { neto: 1, iva: 0, total: 1 } },
      async () => {
        paced += 1;
      },
    );
    expect(paced).toBeGreaterThanOrEqual(2); // frame fetch + PDF post are both paced
  });

  it('BUG-4: the PDF body is the iframe VIEW form field set, not every hidden input', () => {
    const frame = `<html><body onLoad="Enviar();">
      <form action="/cgi-bin/Portal001/mipePreView.cgi" name="VIEW" method="post">
        <input type="hidden" name="PTDC_CODIGO" value="">
        <input type="hidden" name="EFXP_NMB_01" value="">
      </form></body></html>`;
    // the frame's OWN default must survive for a field the review page does not carry
    expect(frameFields('<form name="VIEW"><input name="EFXP_FOLIO" value="0"></form>')).toEqual([
      { name: 'EFXP_FOLIO', value: '0' },
    ]);
    expect(frameFields(frame).map((f) => f.name)).toEqual(['PTDC_CODIGO', 'EFXP_NMB_01']);
    expect(frameFields('<html>changed</html>')).toEqual([]);
  });

  it('BUG-4: relays SII generic "Error al contribuyente" page verbatim', () => {
    const html =
      "<html><head><title>Error al contribuyente</title></head><body onLoad='cerrarVentana()'>" +
      "<script>alert('Por el momento no se puede responder.\\n\\nCODIGO: 02.35.209');</script></body></html>";
    const bytes = new TextEncoder().encode(html);
    expect(contribuyenteError(bytes, 'text/html; charset=ISO-8859-1')).toContain(
      'CODIGO: 02.35.209',
    );
    expect(contribuyenteError(new Uint8Array([0x25, 0x50]), 'application/pdf')).toBeNull();
  });

  it('BUG-5: form bodies are encoded windows-1252, not UTF-8', () => {
    // UTF-8 would send %C3%B1 and SII stored/printed "Dise\u00c3\u00b1o" (observed live).
    expect(latin1FormBody([['a', 'Dise\u00f1o']])).toBe('a=Dise%F1o');
    expect(latin1FormBody([['a', 'Consultor\u00eda']])).toBe('a=Consultor%EDa');
    // the windows-1252 0x80-0x9F block: SII's own <select> options carry these
    expect(latin1FormBody([['a', '\u2018']])).toBe('a=%91');
    expect(latin1FormBody([['a', 'x y']])).toBe('a=x+y');
    // outside 1252 entirely -> HTML numeric reference, as a browser does
    expect(latin1FormBody([['a', '\u4e2d']])).toBe('a=%26%2320013%3B');
  });

  // --- Review findings on PR #88 ---------------------------------------------------
  it('REVIEW-critical: the grid-growth loop is bounded and fails through `scraper`', () => {
    const src = fillScriptSource();
    // no unbounded `while` around modCantLineaDet — it must be a guarded `for`
    expect(src).not.toMatch(/while \([^)]*cantDet\(\) <[^)]*\)/);
    expect(src).toContain('for (let guard = 0; cantDet() < P.items.length; guard += 1)');
    expect(src).toContain('el formulario no aceptó más líneas de detalle');
  });

  it('REVIEW-1: no unguarded f.elements[...] reads escape as a raw TypeError', () => {
    const src = fillScriptSource();
    // The invariant that matters: never dereference a property straight off f.elements[...],
    // which is what throws a raw TypeError when SII renames a field. The remaining bare lookups
    // are existence checks (waitFor) and put()'s own missing[] path, both guarded.
    expect(facturaSource()).not.toMatch(/f\.elements\[[^\]]+\]\s*\./);
    expect(src).toContain('const el = (n) => f.elements[n] || null;');
    expect(src).toContain('falta el botón Button_Update');
    expect(src).toContain('falta la casilla de descripción DESCRIP_');
  });

  it('REVIEW-2: a delete answered with a "grabado" page is NOT reported as deleted', async () => {
    const s = new FakePortalSession({
      requestText: () => 'Su documento borrador ha sido grabado/actualizado con éxito',
    });
    await expect(
      eliminaBorrador(s, { fields: {}, totales: { neto: 0, iva: 0, total: 0 }, avisos: [] }),
    ).rejects.toBeInstanceOf(DteError);
    // and the matching page IS accepted
    const ok = new FakePortalSession({ requestText: () => 'El borrador ha sido eliminado' });
    await expect(
      eliminaBorrador(ok, { fields: {}, totales: { neto: 0, iva: 0, total: 0 }, avisos: [] }),
    ).resolves.toBeUndefined();
  });

  it('REVIEW-nit: the two empresa hops are paced', async () => {
    const s = new FakePortalSession({
      requestForm: (url) => (url.includes('?') ? EMPRESAS_HTML : '<html>formulario</html>'),
    });
    let paced = 0;
    await resolveAndSelectEmpresa(s, Rut.parse('76192083-9'), 33, async () => {
      paced += 1;
    });
    expect(paced).toBe(1);
  });

  it('never CALLS the signing CGI (ADR-023)', () => {
    // The source names it once, in the comment that documents the boundary. What must never
    // exist is a call: assert against the COMPILED output, where comments are gone.
    const code = facturaSource()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('mipeGenXMLFirma');
    expect(code).not.toContain('Firma');
  });
});

// --- Documentos emitidos (#91) ------------------------------------------------------
describe('documentos emitidos', () => {
  // SII leaves the receptor cell UNCLOSED — `<td>RUT <td>NOMBRE</td>` (observed 2026-09-08).
  const LISTA = `<table><tr><td>Ver</td><td>Receptor</td></tr>
    <tr> <td> <a href="/cgi-bin/Portal001/mipeGesDocEmi.cgi?ALL_PAGE_ANT=2&CODIGO=99000001"><img src="/Portal001/button_edit.gif"></a></td>
      <td>76192083-9 <td>ACME REPUESTOS SPA</td> <td>Factura Electronica</td> <td>5</td>
      <td>2026-09-08</td> <td>990000</td> <td>Documento Emitido</td> </tr>
    <tr> <td> <a href="/cgi-bin/Portal001/mipeGesDocEmi.cgi?ALL_PAGE_ANT=2&CODIGO=99000002"><img src="/Portal001/button_edit.gif"></a></td>
      <td>77111222-6 <td>TALLER DEL SUR LTDA</td> <td>Factura Electronica</td> <td>1</td>
      <td>2026-09-07</td> <td>1190000</td> <td>Documento Emitido</td> </tr></table>`;

  it('parses the malformed table into curated rows (no raw)', () => {
    const rows = parseEmitidas(LISTA);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      codigo: '99000001',
      receptorRut: '76192083-9',
      receptorNombre: 'ACME REPUESTOS SPA',
      tipoDteDesc: 'Factura Electronica',
      folio: 5,
      fecha: '2026-09-08',
      monto: 990000,
      estado: 'Documento Emitido',
    });
    expect(Object.keys(rows[1] ?? {})).not.toContain('raw');
  });

  /** One row whose folio cell is rendered blank — the shape a `PRV` (vista previa) document
   *  produces, since a preview carries no folio. SYNTHETIC: capturing the real PRV markup is the
   *  follow-up half of #92 (no pre-view document existed on the account when it was probed). */
  const filaFolio = (folio: string, nombre = 'ACME REPUESTOS SPA'): string =>
    `<table><tr> <td> <a href="/cgi-bin/Portal001/mipeGesDocEmi.cgi?CODIGO=99000003"><img src="/Portal001/button_edit.gif"></a></td>
      <td>76192083-9 <td>${nombre}</td> <td>Factura Electronica</td> <td>${folio}</td>
      <td>2026-09-08</td> <td>990000</td> <td>Vista Previa</td> </tr></table>`;

  // #92: dropping the blank cell slid fecha into folio, monto into fecha and estado into monto —
  // a plausible row with the values under the wrong names, and no error.
  it.each([
    ['empty', ''],
    ['a raw non-breaking space', '\u00a0'],
    ['an &nbsp; entity', '&nbsp;'],
  ])('keeps every column in place when the folio cell is %s', (_label, folio) => {
    expect(parseEmitidas(filaFolio(folio))).toEqual([
      {
        codigo: '99000003',
        receptorRut: '76192083-9',
        receptorNombre: 'ACME REPUESTOS SPA',
        tipoDteDesc: 'Factura Electronica',
        folio: null,
        fecha: '2026-09-08',
        monto: 990000,
        estado: 'Vista Previa',
      },
    ]);
  });

  it('reads a blank receptor name as null without shifting the rest', () => {
    expect(parseEmitidas(filaFolio('5', ''))[0]).toMatchObject({
      receptorNombre: null,
      folio: 5,
      fecha: '2026-09-08',
      monto: 990000,
      estado: 'Vista Previa',
    });
  });

  it('raises "scraper roto" on a row that gained a leading blank cell', () => {
    // A blank cell BEFORE the receptor RUT shifts the row exactly as badly as a dropped one.
    const larga = `<table><tr> <td> <a href="/cgi-bin/Portal001/mipeGesDocEmi.cgi?CODIGO=99000005"><img></a></td>
      <td></td> <td>76192083-9 <td>ACME REPUESTOS SPA</td> <td>Factura Electronica</td> <td>5</td>
      <td>2026-09-08</td> <td>990000</td> <td>Documento Emitido</td> </tr></table>`;
    expect(() => parseEmitidas(larga)).toThrow(/8 celda\(s\) y se esperan 7/);
  });

  it('raises "scraper roto" on a row that lost a column, instead of realigning', () => {
    const corta = `<table><tr> <td> <a href="/cgi-bin/Portal001/mipeGesDocEmi.cgi?CODIGO=99000004"><img></a></td>
      <td>76192083-9 <td>ACME REPUESTOS SPA</td> <td>Factura Electronica</td> <td>5</td>
      <td>2026-09-08</td> <td>990000</td> </tr></table>`;
    expect(() => parseEmitidas(corta)).toThrow(DteError);
    expect(() => parseEmitidas(corta)).toThrow(/6 celda\(s\) y se esperan 7/);
  });

  it('sends every filter as a query param and treats an empty result as zero rows', async () => {
    const s = new FakePortalSession({
      requestForm: () => '<html>No se encontraron documentos</html>',
    });
    await expect(
      fetchEmitidas(s, { tipoDoc: 61, estado: 'emitido', folio: 7, desde: '2026-01-01' }),
    ).resolves.toEqual([]);
    const url = s.lastFormRequest?.url ?? '';
    expect(url).toContain('TPO_DOC=61');
    expect(url).toContain('ESTADO=EMI');
    expect(url).toContain('FOLIO=7');
    expect(url).toContain('FEC_DESDE=2026-01-01');
    expect(url).toContain('NUM_PAG=1');
  });

  it('fails loudly when the listing changes shape (scraper roto)', async () => {
    const s = new FakePortalSession({ requestForm: () => '<html>mantención</html>' });
    await expect(fetchEmitidas(s)).rejects.toBeInstanceOf(DteError);
  });

  it('relays a SII rejection page verbatim', async () => {
    const s = new FakePortalSession({
      requestForm: () =>
        "<html><title>Redireccionando</title><script>alert('Sesión no válida');window.history.go(-1);</script></html>",
    });
    await expect(fetchEmitidas(s)).rejects.toThrow(/Sesión no válida/);
  });

  it('downloads the emitted PDF by codigo with the detail page as Referer', async () => {
    const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const s = new FakePortalSession({ requestBinary: () => PDF });
    await expect(fetchEmitidaPdf(s, '99000002')).resolves.toEqual(PDF);
    expect(s.lastBinaryRequest?.url).toContain('mipeDisplayPDF.cgi?DHDR_CODIGO=99000002');
    expect(s.lastBinaryRequest?.options?.method).toBe('GET');
    expect(s.lastBinaryRequest?.options?.headers?.['Referer']).toContain('mipeGesDocEmi.cgi');
  });

  it('rejects a 200 HTML error page instead of a PDF (ADR-022: never trust status)', async () => {
    const s = new FakePortalSession({
      requestBinary: () => ({
        status: 200,
        contentType: 'text/html',
        bytes: new TextEncoder().encode('<html><title>Error al contribuyente</title></html>'),
      }),
    });
    await expect(fetchEmitidaPdf(s, '1')).rejects.toThrow(
      /no entregó el documento|no devolvió un PDF/,
    );
  });
});

// --- GH-95: single-empresa accounts get a launcher, not a chooser --------------------------

/** What SII answers INSTEAD of the chooser when the account is a usuario autorizado of exactly
 *  one empresa: a JS shim that jumps straight to the destination (observed 2026-09-09, #95). */
const LAUNCHER_HTML = `<!DOCTYPE HTML>
<html>
	<head>
		<title>Facturacion Electronica - Launcher</title>
		<script language=JavaScript>
		function start_pop() {
			var     nwp;
			window.location = "/Portal001/menuFacturaElectronica.html";
      FacturaOpenEnlace("/cgi-bin/Portal001/mipeGenFacEx.cgi?PTDC_CODIGO=33");
		  return true;
		}
		</script>
	</head>
	<body onLoad="javascript:start_pop();">
	</body>
</html>`;
/** The chooser with NO options — an account that is not a usuario autorizado of any empresa
 *  (observed 2026-09-09 on an empresa account). */
const EMPTY_CHOOSER_HTML = `<form name="fPrmEmpPOP" method="post">
  <select class="form-control" name="RUT_EMP">
    <optgroup label="Seleccione una opcion">

    </optgroup>
  </select></form>`;
/** What the scoped-empresa script reads off the form's DTE header box + EFXP_RZN_SOC. */
const SCOPED = { rut: '76192083-9', nombre: 'ACME REPUESTOS SPA' };
/** A fake that answers the launcher to the chooser GET and counts every chooser POST. */
const launcherSession = (evaluate: () => unknown = () => SCOPED) => {
  let posts = 0;
  const s = new FakePortalSession({
    requestForm: (_url, options) => {
      if (options?.form) posts += 1;
      return LAUNCHER_HTML;
    },
    evaluate,
  });
  return { s, posts: () => posts };
};

describe('GH-95: parseChooser classifies the three observed chooser shapes', () => {
  it('chooser — two or more empresas', () => {
    expect(parseChooser(EMPRESAS_HTML)).toEqual({
      kind: 'chooser',
      empresas: [EMPRESA, { rut: '77111222-6', nombre: 'TALLER DEL SUR LTDA' }],
    });
  });
  it('sinAutorizacion — the select is there but empty', () => {
    expect(parseChooser(EMPTY_CHOOSER_HTML)).toEqual({ kind: 'sinAutorizacion' });
  });
  it('launcher — no select at all, a JS shim', () => {
    expect(parseChooser(LAUNCHER_HTML)).toEqual({ kind: 'launcher' });
  });
  it('anything else is scraper roto, never silently one of the three', () => {
    expect(() => parseChooser('<html>mantención</html>')).toThrow(DteError);
    expect(() => parseChooser('<html>mantención</html>')).toThrow(/forma conocida/);
  });
});

describe('GH-95: fetchEmpresas on the launcher path', () => {
  it('resolves the single scoped empresa off the form instead of failing', async () => {
    const { s } = launcherSession();
    await expect(fetchEmpresas(s, 33)).resolves.toEqual([EMPRESA]);
    // identity comes from the FORM (goto + evaluate), always via PTDC_CODIGO=33
    expect(s.gotos).toEqual([expect.stringContaining('mipeGenFacEx.cgi?PTDC_CODIGO=33')]);
  });

  it('paces the chooser GET and the form load as two hops', async () => {
    const { s } = launcherSession();
    let slept = 0;
    await fetchEmpresas(s, 33, async () => {
      slept += 1;
    });
    expect(slept).toBe(1);
  });

  it('is scraper roto when the form has no DTE header box / razón social', async () => {
    const { s } = launcherSession(() => ({ scraper: 'no se encontró el RUT del emisor' }));
    await expect(fetchEmpresas(s, 33)).rejects.toThrow(/no reconocido.*RUT del emisor/);
  });

  it('rejects a login-wall / wrong landing on the form hop', async () => {
    const s = new FakePortalSession({
      requestForm: () => LAUNCHER_HTML,
      landingUrl: `https://${LOGIN_HOST}/AUT2000/x`,
    });
    await expect(fetchEmpresas(s, 33)).rejects.toThrow(/no entregó el formulario/);
  });
});

describe('GH-95: the "not authorized" message is reached ONLY by the empty chooser', () => {
  it('names the cause and the actionable path (persona, not empresa account)', async () => {
    const s = new FakePortalSession({ requestForm: () => EMPTY_CHOOSER_HTML });
    await expect(fetchEmpresas(s, 33)).rejects.toThrow(/usuario autorizado/);
    await expect(fetchEmpresas(s, 33)).rejects.toThrow(/RUT personal/);
  });
});

describe('GH-95: resolveAndSelectEmpresa on the launcher path', () => {
  it('resolves the scoped empresa and issues NO chooser POST — the session is already scoped', async () => {
    const { s, posts } = launcherSession();
    await expect(resolveAndSelectEmpresa(s, Rut.parse('76192083-9'), 33)).resolves.toEqual(EMPRESA);
    expect(posts()).toBe(0);
  });

  it('still refuses an --empresa that is not the scoped one (ADR-023 / ADR-005)', async () => {
    const { s, posts } = launcherSession();
    await expect(resolveAndSelectEmpresa(s, Rut.parse('77777777-7'), 33)).rejects.toThrow(
      /no está en tus empresas.*76192083-9 \(ACME REPUESTOS SPA\)/s,
    );
    expect(posts()).toBe(0);
  });

  it('the chooser path is untouched: a listed empresa is still POSTed', async () => {
    let posts = 0;
    const s = new FakePortalSession({
      requestForm: (_url, options) => {
        if (options?.form) {
          posts += 1;
          return '<html>formulario</html>';
        }
        return EMPRESAS_HTML;
      },
    });
    await expect(resolveAndSelectEmpresa(s, Rut.parse('76192083-9'), 33)).resolves.toEqual(EMPRESA);
    expect(posts).toBe(1);
  });
});

describe('GH-95: the scoped-empresa script reads the DTE header box, bounded', () => {
  it('anchors on the document header (div.well strong "Rut …"), not the navbar or cookies', () => {
    const src = facturaSource();
    expect(src).toContain("querySelectorAll('div.well strong')");
    expect(src).toContain('const RUT = /^\\\\s*Rut\\\\s+');
    // the razón social is the form field, awaited (JS-populated), never guessed
    expect(src).toContain("f.elements['EFXP_RZN_SOC'] || null");
    // bounded by a deadline; the 100 ms-timer ban is asserted globally in BUG-2
    expect(src.slice(src.indexOf('SCOPED_EMPRESA_SCRIPT'))).toContain('Date.now() + 10000');
  });
});

describe('GH-95 review: the scraped emisor RUT is Mod-11 checked, not trusted', () => {
  it('normalises SII dotted rendering to canonical', async () => {
    const { s } = launcherSession(() => ({ rut: '76.192.083-9', nombre: 'ACME REPUESTOS SPA' }));
    await expect(fetchEmpresas(s, 33)).resolves.toEqual([EMPRESA]);
  });

  it('a garbled scrape is scraper roto, never a silent wrong empresa', async () => {
    // Bad DV: trusting it would reject the user's legitimate --empresa instead of failing.
    const { s } = launcherSession(() => ({ rut: '76192083-0', nombre: 'ACME REPUESTOS SPA' }));
    await expect(fetchEmpresas(s, 33)).rejects.toThrow(/no es válido.*cambió de forma/s);
  });
});

describe('GH-95 review: identity resolution is independent of the requested DTE type', () => {
  it('reads the emisor off the 33 form even when 34 was asked for', async () => {
    // An account not authorized for exenta gets PTDC_CODIGO=34 back with NO forms at all
    // (observed 2026-09-09), so pinning identity to 33 keeps "who am I" separate from
    // "may I emit this type" — --tipo 34 must fail on the document, not on the empresa.
    const { s } = launcherSession();
    await expect(fetchEmpresas(s, 34)).resolves.toEqual([EMPRESA]);
    expect(s.gotos).toEqual([expect.stringContaining('PTDC_CODIGO=33')]);
    // the chooser GET still asks for the requested type
    expect(s.lastFormRequest?.url).toContain(encodeURIComponent('OPCION=34'));
  });
});
