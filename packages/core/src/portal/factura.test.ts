// Facade tests for the MIPYME factura surface. No real SII: the fake session scripts the
// observed wire shapes (docs/sii-contract/factura.md, captured 2026-09-08). Synthetic,
// Mod-11-valid RUTs only — never real PII.
import { describe, expect, it } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { FacturaError } from '../errors/index.js';
import { Rut } from '../rut/index.js';
import {
  eliminaBorrador,
  fetchBorradores,
  fetchEmpresas,
  fetchPreviewPdf,
  fillFactura,
  grabaBorrador,
  loadBorrador,
  resolveAndSelectEmpresa,
} from './factura.js';
import type { FacturaEmpresa } from './factura.js';
import { repairMojibake, frameFields, contribuyenteError, latin1FormBody } from './factura.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The facade source. The in-page fill script is a STRING, so its invariants (waiting for real
 *  selectors, select-aware assignment, no event on the receptor RUT) are asserted against the
 *  source directly — a browser-level test would need a live SII page. */
const facturaSource = (): string =>
  readFileSync(fileURLToPath(new URL('./factura.ts', import.meta.url)), 'utf8');
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

const EMPRESA: FacturaEmpresa = { rut: '76192083-9', nombre: 'ACME REPUESTOS SPA' };

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
    await expect(fetchEmpresas(s, 33)).rejects.toBeInstanceOf(FacturaError);
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
    const s = new FakePortalSession({ landingUrl: 'https://zeusr.sii.cl/AUT2000/' });
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
    ).rejects.toBeInstanceOf(FacturaError);
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
