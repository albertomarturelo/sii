// MIPYME FACTURA (borradores) — the SII's FREE facturación electrónica portal, `Portal001`
// CGIs on www1.sii.cl. Wire contract captured live 2026-09-08 (own session, a real borrador
// created/listed/deleted end-to-end); see docs/sii-contract/factura.md. NOT a third-party
// library (ADR-004): every field, endpoint and selector below is first-hand-observed.
//
// BORRADORES ONLY (ADR-023). The portal's emisión path is `mipeDisplayPreView.cgi` →
// `mipeGenXMLFirma.cgi` (SII signs SERVER-SIDE — no certificado digital is involved, so the
// Clave alone would be enough to issue a legally-binding factura). This module deliberately
// stops at the borrador + preview: `mipeGenXMLFirma.cgi` is NEVER called from here.
//
// TWO WIRE SHAPES, like the BTE facade:
//   * the FORM (`mipeGenFacEx.cgi`) is an HTML skeleton whose emisor context (sucursal, giro,
//     domicilio, acteco) and detail grid are built CLIENT-SIDE by JS — the static HTML carries
//     EMPTY values. So it is driven through `PortalSession.goto` + `evaluate` (never a cold
//     `requestForm` GET, which would read blanks), exactly as the convention requires.
//   * the CGIs that consume the filled form (`mipeGrabaBorrador` / `mipeEliminaBorrador` /
//     `mipeDisplayPreView`) take `x-www-form-urlencoded` and return HTML ⇒ `requestForm`.
//   * the borrador LIST is a plain SPA JSON GET on www4 ⇒ `requestJson`.
//
// EMPRESA-KEYED (ADR-023): the working empresa is whichever RUT was last POSTed to
// `mipeSelEmpresa.cgi` — the MIPYME "usuario autorizado" list, which is its OWN value domain,
// distinct from the operate pointer's operable set. Every operation selects it first — except
// on an account authorized for a SINGLE empresa, where SII skips the chooser (a JS launcher
// instead of the select) and the session is already scoped; then the empresa is read off the
// factura form's DTE header box and nothing is POSTed (observed 2026-09-09, #95).
import { HOSTS } from '../config/index.js';
import { FacturaError } from '../errors/index.js';
import type { Rut } from '../rut/index.js';
import type { PortalSession, PublicResponse } from '../seams/index.js';

const CGI = HOSTS.mipeCgi;
const SEL_EMPRESA_URL = `${CGI}/mipeSelEmpresa.cgi`;
const FORM_URL = `${CGI}/mipeGenFacEx.cgi`;
const GRABA_URL = `${CGI}/mipeGrabaBorrador.cgi`;
const ELIMINA_URL = `${CGI}/mipeEliminaBorrador.cgi`;
const PREVIEW_URL = `${CGI}/mipeDisplayPreView.cgi`;
/** "Ver documentos emitidos" — the listing of DTEs already ISSUED by the selected empresa,
 *  reached from `mipeLaunchPage.cgi?OPCION=2&TIPO=4` (observed 2026-09-08). Read-only. */
const EMITIDOS_URL = `${CGI}/mipeAdminDocsEmi.cgi`;
/** The emitted document's PDF, keyed by the listing row's `CODIGO`. A plain authenticated GET
 *  answering `application/pdf` — no review/iframe dance, unlike the borrador preview
 *  (observed 2026-09-08). */
const EMITIDO_PDF_URL = `${CGI}/mipeDisplayPDF.cgi`;
/** Renders the (unsigned) document as a real `application/pdf` — the preview the portal embeds
 *  in its `framePdf` iframe. Takes the review page's `PreViewDTE` body (observed 2026-09-08). */
const PDF_URL = `${CGI}/mipePreView.cgi`;
/** The iframe that issues the PDF POST. SII checks the Referer: a POST without it comes back
 *  as HTML, not `application/pdf` (observed 2026-09-08 — the browser sends
 *  `referer: .../PreViewFrame.html`, `origin: https://www1.sii.cl`, `sec-fetch-dest: iframe`). */
const PREVIEW_FRAME_URL = `${HOSTS.mipeStatic}/PreViewFrame.html`;
/** Same-origin `Origin` header the iframe sends — derived from the configured host, never
 *  hard-coded (ADR-004: hostnames live only in the config module). */
const MIPE_ORIGIN = new URL(HOSTS.mipeCgi).origin;
/** The borradores list is served by the MIPYME SPA, not the CGIs (observed 2026-09-08). */
const LISTA_BORRADOR_URL = `${HOSTS.portalApi}/mipymeinternetui/services/data/borradorService/listaBorrador`;

/** `DESDE_DONDE_URL` — the post-selection destination `mipeSelEmpresa.cgi` forwards to. It is
 *  an unkeyed `OPCION=<tipo>&TIPO=4` pair (observed); `OPCION` is the DTE code. */
const desdeDonde = (tipoDte: number): string => `OPCION=${tipoDte}&TIPO=4`;

/** The DTE types the MIPYME portal exposes as their own `mipeLaunchPage` OPCION (observed
 *  2026-09-08 on sii.cl/servicios_online/1039-1183.html). Only 33/34 are wired here — the
 *  others need their own live capture before their extra fields can be trusted. */
export const TIPOS_DTE = {
  33: 'Factura electrónica',
  34: 'Factura no afecta o exenta electrónica',
} as const;
export type TipoDte = keyof typeof TIPOS_DTE;

export const isTipoDte = (n: number): n is TipoDte => n === 33 || n === 34;

/** SII's `EFXP_FMA_PAGO` codes (observed in the form's `<select>`). */
export const FORMA_PAGO = { contado: '1', credito: '2', sin_costo: '3' } as const;
export type FormaPago = keyof typeof FORMA_PAGO;

/** The grid's hard ceiling — the form's own `cantTotCol` (observed). */
export const MAX_ITEMS = 10;

/** An empresa the authenticated user may invoice for, as offered by `mipeSelEmpresa.cgi`. */
export interface FacturaEmpresa {
  readonly rut: string; // canonical `<body>-<dv>` exactly as SII serves it
  readonly nombre: string;
}

export interface FacturaReceptor {
  readonly rut: string; // body digits, no DV
  readonly dv: string;
  readonly razonSocial: string;
  readonly direccion: string;
  readonly comuna: string;
  readonly ciudad: string;
  readonly giro: string;
  readonly contacto?: string;
}

export interface FacturaItem {
  readonly nombre: string;
  readonly descripcion?: string;
  readonly cantidad: number;
  readonly unidad?: string;
  readonly precioUnitario: number;
  readonly descuentoPct?: number;
}

/** Everything the caller supplies. The EMISOR block (razón social, giro, domicilio, acteco,
 *  sucursal) is read from the live form — except `ciudadEmisor`, which SII leaves BLANK yet
 *  its own validation demands, so the caller must provide it (observed 2026-09-08). */
export interface FacturaBorradorInput {
  readonly empresa: string; // emisor RUT, from the MIPYME authorized list
  readonly tipoDte: TipoDte;
  readonly fechaEmision: string; // YYYY-MM-DD
  readonly ciudadEmisor: string;
  readonly receptor: FacturaReceptor;
  readonly items: readonly FacturaItem[];
  readonly formaPago: FormaPago;
  /** Set to UPDATE an existing borrador in place; omit to create a new one. */
  readonly borradorId?: string;
}

/** Server-side totals, computed by the form's own JS (so the arithmetic is SII's, not ours). */
export interface FacturaTotales {
  readonly neto: number;
  readonly iva: number;
  readonly total: number;
}

/** SII's `ESTADO` filter values on the emitted listing (observed in the form's <select>). */
export const ESTADO_EMITIDO = { emitido: 'EMI', preview: 'PRV' } as const;
export type EstadoEmitido = keyof typeof ESTADO_EMITIDO;

/** Filters the emitted listing accepts, all optional (observed as query params). */
export interface FacturaEmitidasFiltro {
  readonly tipoDoc?: number;
  readonly estado?: EstadoEmitido;
  readonly folio?: number;
  readonly receptor?: string; // `<body>-<dv>`
  readonly desde?: string; // YYYY-MM-DD
  readonly hasta?: string; // YYYY-MM-DD
  readonly pagina?: number;
}

/** One emitted DTE — CURATED, no `raw` (the row is receptor identity, ADR-004). */
export interface FacturaEmitida {
  /** `DHDR_CODIGO` — SII's internal id and the key the PDF is fetched by. */
  readonly codigo: string;
  readonly receptorRut: string | null;
  readonly receptorNombre: string | null;
  readonly tipoDteDesc: string | null;
  readonly folio: number | null;
  readonly fecha: string | null;
  readonly monto: number | null;
  readonly estado: string | null;
}

/** One row of the borradores list — CURATED. */
export interface FacturaBorradorRow {
  readonly id: string; // ehdr_CODIGO
  readonly tipoDte: number;
  readonly tipoDteDesc: string;
  readonly fecha: string | null;
  readonly receptorRut: string | null;
  readonly receptorNombre: string | null;
  readonly emisorNombre: string | null;
  readonly iva: number | null;
  readonly total: number | null;
}

// --- HTML parsing (in-house, no third-party lib — ADR-004) ------------------------

/** What `mipeSelEmpresa.cgi` answers. THREE shapes observed, decided by how many empresas list
 *  the account as "usuario autorizado":
 *   * `chooser`         — two or more: the `RUT_EMP` select (observed 2026-09-08).
 *   * `sinAutorizacion` — none: the same select with an EMPTY `<optgroup>` (observed 2026-09-09
 *                         on an empresa account that is not itself a usuario autorizado).
 *   * `launcher`        — exactly one: NO chooser at all — a 593-byte JS shim titled
 *                         "Facturacion Electronica - Launcher" whose `start_pop()` jumps straight
 *                         to the destination. The session is ALREADY scoped to that empresa, so
 *                         there is nothing to POST (observed 2026-09-09, #95). */
export type ChooserShape =
  | { readonly kind: 'chooser'; readonly empresas: FacturaEmpresa[] }
  | { readonly kind: 'sinAutorizacion' }
  | { readonly kind: 'launcher' };

/** Classify the chooser response. Read the `<option value="RUT">NOMBRE RUT` rows when there is
 *  a select: SII closes neither the `<option>` nor quotes the label, so match up to the next
 *  `<` or newline (observed). A page that is none of the three shapes is "scraper roto". */
export function parseChooser(html: string): ChooserShape {
  if (/Facturacion Electronica - Launcher/i.test(html) && /FacturaOpenEnlace\(/.test(html)) {
    return { kind: 'launcher' };
  }
  const select = /<select[^>]*name="RUT_EMP"[\s\S]*?<\/select>/i.exec(html)?.[0];
  if (!select) {
    throw new FacturaError(
      'La página de selección de empresa del Portal MIPYME (mipeSelEmpresa.cgi) no tiene una ' +
        'forma conocida: ni selector RUT_EMP ni launcher. El portal puede haber cambiado.',
    );
  }
  const empresas: FacturaEmpresa[] = [];
  const re = /<option\s+value="([^"]+)"\s*>([^<\n]*)/gi;
  for (let m = re.exec(select); m; m = re.exec(select)) {
    const rut = (m[1] ?? '').trim();
    // The label repeats the RUT ("RAZON SOCIAL 76192083-9") — strip it for a clean name.
    const nombre = (m[2] ?? '')
      .trim()
      .replace(new RegExp(`\\s*${rut.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '')
      .trim();
    if (rut) empresas.push({ rut, nombre });
  }
  return empresas.length === 0 ? { kind: 'sinAutorizacion' } : { kind: 'chooser', empresas };
}

/** Read the message out of SII's server-side rejection page: a 200 "Redireccionando" document
 *  whose script is `alert('…')` followed by `window.history.go(-1)` (observed 2026-09-08).
 *  Returns the alert text with its escaped newlines turned into separators, or null. */
export function serverAlert(html: string): string | null {
  if (!/Redireccionando|history\.go\(-1\)/i.test(html)) return null;
  const raw = /alert\('([\s\S]*?)'\)/.exec(html)?.[1];
  if (!raw) return null;
  return raw
    .replace(/\\n/g, ' | ')
    .replace(/\s*\|\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** SII answers 200 with a human message on both success and refusal, so decide on the text.
 *  The success wording is observed 2026-09-08; anything else is surfaced VERBATIM (ADR-004). */
const CGI_OK: Record<string, RegExp> = {
  // Keyed per step: a delete that answered with a "grabado" page must NOT read as deleted.
  grabaBorrador: /ha sido grabado|ha sido actualizado|grabado\/actualizado/i,
  eliminaBorrador: /ha sido eliminad[oa]/i,
};

function assertCgiOk(html: string, step: string): void {
  const expected = CGI_OK[step];
  if (expected && expected.test(html)) return;
  const rejection = serverAlert(html);
  if (rejection) throw new FacturaError(`El SII rechazó el documento: ${rejection}`);
  const msg = /<(?:p|div|td|span|h\d)[^>]*>\s*([^<]{15,300}?)\s*<\//i.exec(
    html.replace(/<script[\s\S]*?<\/script>/gi, ''),
  )?.[1];
  throw new FacturaError(
    `El SII no confirmó la operación de borrador (paso: ${step}).` +
      (msg ? ` Respuesta: ${msg.replace(/\s+/g, ' ').trim()}` : ''),
  );
}

/** Percent-encode a form body as ISO-8859-1, the charset every `Portal001` page declares.
 *  `URLSearchParams` encodes UTF-8, so "Diseño" went out as `Dise%C3%B1o` and SII stored — and
 *  printed — "DiseÃ±o" (observed 2026-09-08, both in the saved borrador and in the preview PDF).
 *  The browser encodes per the PAGE charset, so we must too. Characters outside Latin-1 are sent
 *  as an HTML numeric reference, exactly as a browser does for an unrepresentable character.
 *
 *  The label says ISO-8859-1 but the encoding is WINDOWS-1252: the HTML spec requires browsers to
 *  treat a declared ISO-8859-1 document as windows-1252, and SII's own <select> options come back
 *  holding characters from its 0x80–0x9F block (e.g. U+2018 in "ENSE\u00c3\u2018ANZA"). Encoding
 *  those as Latin-1 turned them into `&#8216;` in the rendered document, so the 1252 block is
 *  mapped back explicitly. */
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

export function latin1FormBody(fields: Iterable<readonly [string, string]>): string {
  const enc = (raw: string): string => {
    let out = '';
    for (const ch of raw) {
      const c = ch.codePointAt(0) ?? 0;
      if (/[A-Za-z0-9*\-._]/.test(ch)) out += ch;
      else if (ch === ' ') out += '+';
      else {
        const byte = c <= 0xff ? c : CP1252_HIGH[c];
        out +=
          byte === undefined
            ? encodeURIComponent(`&#${c};`) // truly unrepresentable — browser behaviour
            : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
    return out;
  };
  const parts: string[] = [];
  for (const [k, v] of fields) parts.push(`${enc(k)}=${enc(v)}`);
  return parts.join('&');
}

/** The `name`s of the `VIEW` form inside `PreViewFrame.html` — the EXACT field set the iframe
 *  posts to the PDF CGI, in order (observed 2026-09-08: 239 inputs, matching the browser's own
 *  request byte-for-byte in count). Read from SII's frame at runtime so an upstream edit is
 *  followed rather than drifting against a hardcoded list. */
export function frameFields(html: string): { name: string; value: string }[] {
  const form = /<form[^>]*name="VIEW"[\s\S]*?<\/form>/i.exec(html)?.[0];
  if (!form) return [];
  const out: { name: string; value: string }[] = [];
  const re = /<input[^>]*>/gi;
  for (let m = re.exec(form); m; m = re.exec(form)) {
    const name = /\bname="([^"]+)"/i.exec(m[0])?.[1];
    if (!name || out.some((f) => f.name === name)) continue;
    out.push({ name, value: unescapeHtml(/\bvalue="([^"]*)"/i.exec(m[0])?.[1] ?? '') });
  }
  return out;
}

/** `content-type` says PDF AND the body starts with the `%PDF` magic. Status is never a
 *  success signal here — SII answers 200 for its own error page (ADR-022). */
export function isPdfBytes(bytes: Uint8Array, contentType: string | null): boolean {
  return (
    (contentType ?? '').toLowerCase().includes('application/pdf') &&
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

/** Also relay SII's generic failure page ("Error al contribuyente"), which carries a support
 *  code rather than a validation message — it is a SII-side refusal, not our bad input. */
export function contribuyenteError(bytes: Uint8Array, contentType: string | null): string | null {
  if (!(contentType ?? '').toLowerCase().includes('html')) return null;
  const html = new TextDecoder('iso-8859-1').decode(bytes);
  if (!/Error al contribuyente/i.test(html)) return null;
  const msg = /alert\('([\s\S]*?)'\)/.exec(html)?.[1];
  return (msg ?? 'Error al contribuyente').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Read a form's `<input type="hidden" name="X" value="Y">` pairs. SII's preview page carries
 *  the whole document that way (uniform markup, double-quoted, observed 2026-09-08). */
function parseHiddenInputs(html: string, formName: string): Record<string, string> {
  const form = new RegExp(`<form[^>]*name="${formName}"[\\s\\S]*?</form>`, 'i').exec(html)?.[0];
  if (!form) return {};
  const out: Record<string, string> = {};
  const re = /<input[^>]*type="hidden"[^>]*>/gi;
  for (let m = re.exec(form); m; m = re.exec(form)) {
    const tag = m[0];
    const name = /name="([^"]*)"/i.exec(tag)?.[1];
    if (!name) continue;
    out[name] = unescapeHtml(/value="([^"]*)"/i.exec(tag)?.[1] ?? '');
  }
  return out;
}

/** The five predefined XML entities — enough for SII's form values (no numeric refs observed). */
const unescapeHtml = (v: string): string =>
  v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

// --- The in-page fill script -------------------------------------------------------

/** Build the expression evaluated INSIDE the loaded form page. It grows the detail grid, sets
 *  the fields, runs SII's OWN validator (`validaFacEx`) so the user sees SII's message
 *  verbatim, and returns the serialized form exactly as a browser would submit it.
 *
 *  Two observed hazards it works around:
 *   * firing `change` on `EFXP_RUT_RECEP` triggers the portal's receptor-autofill round trip,
 *     which RELOADS the page and wipes the detail grid — so the receptor fields are assigned
 *     WITHOUT events; only the numeric item fields need `change` to drive the total recompute.
 *   * `DESCRIP_nn` is a checkbox whose `onclick` DRAWS the `EFXP_DSC_ITEM_nn` textarea; the
 *     textarea does not exist until it is clicked. */
function fillScript(payload: unknown): string {
  return `(async () => {
  const P = ${JSON.stringify(payload)};
  const f = document.forms['VIEW_EFXP'];
  if (!f) return { scraper: 'no se encontró el formulario VIEW_EFXP' };

  // BUG-2 (live): the detail grid is drawn ASYNCHRONOUSLY by the page's own JS, so
  // \`DESCRIP_01\` / \`EFXP_NMB_01\` may not exist yet the instant domcontentloaded fires.
  // Wait for the REAL elements (never a blind sleep) before touching anything.
  const waitFor = async (names, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (names.every((n) => f.elements[n])) return true;
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  if (!(await waitFor(['EFXP_NMB_01', 'DESCRIP_01', 'CANT_DET'], 15000))) {
    return { scraper: 'la grilla de detalle no se dibujó (EFXP_NMB_01/DESCRIP_01 ausentes)' };
  }

  const missing = [];
  const coerced = [];
  // Every direct element read goes through el()/cantDet() so a renamed field becomes a clean
  // "scraper roto" error instead of a raw TypeError escaping page.evaluate.
  const el = (n) => f.elements[n] || null;
  const cantDet = () => Number((el('CANT_DET') || {}).value || 1);
  const numOf = (n) => {
    const e = el(n);
    if (!e) { missing.push(n); return 0; }
    return Number(e.value || 0);
  };
  const norm = (v) =>
    String(v ?? '')
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .replace(/\\s+/g, ' ')
      .trim()
      .toUpperCase();

  // BUG-3 (live): when a saved borrador is REOPENED, SII renders EFXP_DIR_RECEP and
  // EFXP_GIRO_RECEP as <select> (the receptor's registered addresses / giros) instead of
  // <input>. Assigning a value that is not exactly one of the options silently leaves the
  // select EMPTY, which is how the receptor block came back blank. So: match an option by
  // value, then by accent/case-insensitive text; if nothing matches, KEEP SII's canonical
  // selection rather than blanking it, and report the coercion.
  const put = (n, v, fire) => {
    const e = f.elements[n];
    if (!e) { missing.push(n); return; }
    if (e.tagName === 'SELECT') {
      const want = norm(v);
      if (want === '') return; // nothing to set — keep SII's own option
      const opts = Array.from(e.options);
      const hit =
        opts.find((o) => o.value === v) ??
        opts.find((o) => norm(o.value) === want) ??
        opts.find((o) => norm(o.text) === want) ??
        opts.find((o) => norm(o.text).startsWith(want) || want.startsWith(norm(o.text)));
      if (hit) { e.value = hit.value; return; }
      // Nothing matched: keep SII's canonical option and report BOTH what was kept and the
      // options it does offer, so the caller (or a model) can pick a real one next time.
      coerced.push({
        campo: n,
        solicitado: String(v),
        usado: e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : '',
        opciones: opts.map((o) => o.text).filter((t) => t !== ''),
      });
      return;
    }
    e.value = v;
    // Only the numeric item fields need an event (they drive the total recompute). NEVER fire
    // on the receptor RUT: it triggers the portal's autofill round trip, which RELOADS the
    // page and wipes the grid (observed).
    if (fire) e.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // BOUNDED: if modCantLineaDet ever stops incrementing CANT_DET — SII caps the grid for this
  // DTE type, renames the function, or AGREGA_DETALLE disappears — an unbounded loop would spin
  // in the renderer forever (page.evaluate does not time out), hanging the CLI and the MCP
  // server with no error. Fail LOUD through the scraper channel instead (ADR-004).
  const addBtn = el('AGREGA_DETALLE');
  if (!addBtn && P.items.length > 1) return { scraper: 'falta el botón AGREGA_DETALLE' };
  for (let guard = 0; cantDet() < P.items.length; guard += 1) {
    if (guard >= P.items.length) {
      return {
        scraper:
          'el formulario no aceptó más líneas de detalle (CANT_DET quedó en ' + cantDet() + ')',
      };
    }
    const before = cantDet();
    modCantLineaDet(addBtn);
    const row = String(before + 1).padStart(2, '0');
    // each click re-renders the grid — wait for the row it just added
    if (!(await waitFor(['EFXP_NMB_' + row], 10000)) || cantDet() <= before) {
      return { scraper: 'no se dibujó la línea de detalle ' + row };
    }
  }

  put('EFXP_CIUDAD_ORIGEN', P.ciudadEmisor);
  put('EFXP_FCH_EMIS', P.fechaEmision);
  put('EFXP_FMA_PAGO', P.formaPago);
  put('EFXP_RUT_RECEP', P.receptor.rut);
  put('EFXP_DV_RECEP', P.receptor.dv);
  put('EFXP_RZN_SOC_RECEP', P.receptor.razonSocial);
  put('EFXP_DIR_RECEP', P.receptor.direccion);
  put('EFXP_CMNA_RECEP', P.receptor.comuna);
  put('EFXP_CIUDAD_RECEP', P.receptor.ciudad);
  put('EFXP_GIRO_RECEP', P.receptor.giro);
  put('EFXP_CONTACTO', P.receptor.contacto);
  if (P.borradorId) {
    const h = el('EHDR_CODIGO');
    if (!h) return { scraper: 'falta EHDR_CODIGO en el formulario' };
    h.value = P.borradorId;
  }

  for (let i = 0; i < P.items.length; i += 1) {
    const it = P.items[i];
    const s = String(i + 1).padStart(2, '0');
    if (it.descripcion) {
      const c = el('DESCRIP_' + s);
      if (!c || typeof c.onclick !== 'function') {
        return { scraper: 'falta la casilla de descripción DESCRIP_' + s };
      }
      if (!c.checked) { c.checked = true; c.onclick(); }
      // the textarea is DRAWN by that onclick — wait for it, don't assume
      if (!(await waitFor(['EFXP_DSC_ITEM_' + s], 10000))) {
        return { scraper: 'no se dibujó la descripción EFXP_DSC_ITEM_' + s };
      }
    }
    put('EFXP_NMB_' + s, it.nombre);
    put('EFXP_UNMD_' + s, it.unidad);
    if (it.descripcion) put('EFXP_DSC_ITEM_' + s, it.descripcion);
    if (it.descuentoPct) put('EFXP_PCTD_' + s, it.descuentoPct, true);
    put('EFXP_QTY_' + s, it.cantidad, true);
    put('EFXP_PRC_' + s, it.precioUnitario, true);
  }

  const msgs = [];
  const prev = window.alert;
  window.alert = (m) => msgs.push(String(m).trim());
  let ok = false;
  try {
    const btn = el('Button_Update');
    if (!btn) { window.alert = prev; return { scraper: 'falta el botón Button_Update' }; }
    ok = !!validaFacEx(btn);
  } catch (e) { window.alert = prev; return { scraper: String((e && e.message) || e) }; }
  window.alert = prev;

  const fields = {};
  for (const e of f.elements) {
    if (!e.name || e.type === 'button' || e.type === 'submit') continue;
    if ((e.type === 'checkbox' || e.type === 'radio') && !e.checked) continue;
    fields[e.name] = e.value;
  }
  return {
    ok, msgs, missing, coerced, fields,
    totales: {
      neto: numOf('EFXP_MNT_NETO'),
      iva: numOf('EFXP_IVA'),
      total: numOf('EFXP_MNT_TOTAL'),
    },
  };
})()`;
}

interface FillResult {
  readonly scraper?: string;
  readonly ok?: boolean;
  readonly msgs?: string[];
  readonly missing?: string[];
  readonly coerced?: FacturaSelectAviso[];
  readonly fields?: Record<string, string>;
  readonly totales?: FacturaTotales;
}

/** A receptor field SII renders as a <select> where the requested value matched no option.
 *  SII's own selection was KEPT (assigning a non-matching value blanks the select — observed
 *  2026-09-08), and `opciones` lists what it actually offers so a caller can choose a real one. */
export interface FacturaSelectAviso {
  readonly campo: string;
  readonly solicitado: string;
  readonly usado: string;
  readonly opciones: readonly string[];
}

/** A filled, SII-validated form: the exact body to POST plus the totals SII computed. */
export interface FacturaFilled {
  readonly fields: Record<string, string>;
  readonly totales: FacturaTotales;
  /** Non-fatal: <select> fields where SII's own option was kept. Surfaced to the user. */
  readonly avisos: readonly FacturaSelectAviso[];
}

/** POST a form body encoded as ISO-8859-1. Uses `requestText` (raw authenticated body) rather
 *  than `requestForm`, whose `form` option is UTF-8-encoded by the driver — that encoding is what
 *  mangled every accented value the portal stored. */
async function postLatin1(
  session: PortalSession,
  url: string,
  fields: Record<string, string>,
): Promise<PublicResponse> {
  return session.requestText(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=ISO-8859-1' },
    body: latin1FormBody(Object.entries(fields)),
  });
}

// --- Operations ---------------------------------------------------------------------

/** In-page: read the empresa the portal ALREADY scoped this session to, off the factura form.
 *  Two sources, both observed 2026-09-09 on a single-empresa persona account:
 *   * the RUT is the DTE header box — `<div class="well well-sm"><strong>Rut 76192083-9</strong>
 *     FACTURA ELECTRÓNICA N° folio no asignado</div>` — the EMISOR by construction of the
 *     document. NOT the navbar's `Rut:` (`ul#conAutenticacion`), not `cook_rut`, not the
 *     `NETSCAPE_LIVEWIRE.rut` / `RUT_NS` cookies: those are the LOGGED-IN principal, which on a
 *     persona account is a different RUT from the empresa it invoices for.
 *   * the razón social is `EFXP_RZN_SOC`, JS-populated like the rest of the emisor block.
 *  Both are awaited with a deadline-bounded 50 ms poll, never a blind sleep (like fillScript). */
const SCOPED_EMPRESA_SCRIPT = `(async () => {
  const RUT = /^\\s*Rut\\s+([\\d.]{7,10}-[\\dkK])\\s*$/i;
  const header = () => {
    for (const s of document.querySelectorAll('div.well strong')) {
      const m = RUT.exec(s.textContent || '');
      if (m) return m[1].replace(/\\./g, '');
    }
    return null;
  };
  const f = document.forms['VIEW_EFXP'];
  if (!f) return { scraper: 'no se encontró el formulario VIEW_EFXP' };
  const el = f.elements['EFXP_RZN_SOC'] || null;
  if (!el) return { scraper: 'falta el campo EFXP_RZN_SOC (razón social del emisor)' };
  const deadline = Date.now() + 10000;
  let rut = header();
  while ((!rut || !String(el.value || '').trim()) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    rut = rut || header();
  }
  if (!rut) return { scraper: 'no se encontró el RUT del emisor en el cuadro del documento (div.well strong "Rut …")' };
  const nombre = String(el.value || '').trim();
  if (!nombre) return { scraper: 'EFXP_RZN_SOC quedó vacío' };
  return { rut, nombre };
})()`;

async function readScopedEmpresa(
  session: PortalSession,
  tipoDte: TipoDte,
): Promise<FacturaEmpresa> {
  const landed = await session.goto(`${FORM_URL}?PTDC_CODIGO=${tipoDte}`);
  if (!landed.includes('mipeGenFacEx.cgi')) {
    throw new FacturaError(`El SII no entregó el formulario de factura (llegamos a ${landed}).`);
  }
  const r = await session.evaluate<{ scraper?: string; rut?: string; nombre?: string } | null>(
    SCOPED_EMPRESA_SCRIPT,
  );
  if (!r || r.scraper || !r.rut || !r.nombre) {
    throw new FacturaError(
      `Formulario de factura del SII no reconocido (${r?.scraper ?? 'sin RUT/razón social del emisor'}).`,
    );
  }
  return { rut: r.rut, nombre: r.nombre };
}

/** GET the chooser and resolve the authorized empresas for this session. `scoped` says the
 *  portal already pointed the session at the single empresa (launcher shape) — the caller must
 *  then NOT POST `mipeSelEmpresa.cgi`. `sinAutorizacion` is the only path to the "not
 *  authorized" message, so the wording can be actionable (#95). */
async function resolveChooser(
  session: PortalSession,
  tipoDte: TipoDte,
  sleep: () => Promise<void>,
): Promise<{ empresas: FacturaEmpresa[]; scoped: boolean }> {
  const res = await session.requestForm(
    `${SEL_EMPRESA_URL}?DESDE_DONDE_URL=${encodeURIComponent(desdeDonde(tipoDte))}`,
    { method: 'GET' },
  );
  const shape = parseChooser(res.body);
  if (shape.kind === 'chooser') return { empresas: shape.empresas, scoped: false };
  if (shape.kind === 'sinAutorizacion') {
    throw new FacturaError(
      'Tu cuenta no figura como usuario autorizado de ninguna empresa en el Portal MIPYME ' +
        '(mipeSelEmpresa.cgi sin opciones). El portal se opera normalmente con la PERSONA que ' +
        'representa a la empresa, no con la cuenta de la empresa: si entraste como empresa, ' +
        'cierra sesión (`sii auth logout`) y entra con tu RUT personal.',
    );
  }
  await sleep(); // the chooser GET and the form load are two hops — pace them (ADR-004)
  return { empresas: [await readScopedEmpresa(session, tipoDte)], scoped: true };
}

/** The empresas the authenticated user may invoice for. This is the MIPYME "usuario
 *  autorizado" list — its own value domain, NOT the operate pointer's operable set. On a
 *  single-empresa account (no chooser) it is the one empresa the portal scoped the session to. */
export async function fetchEmpresas(
  session: PortalSession,
  tipoDte: TipoDte,
  sleep: () => Promise<void> = () => Promise.resolve(),
): Promise<FacturaEmpresa[]> {
  return (await resolveChooser(session, tipoDte, sleep)).empresas;
}

/** Point the MIPYME session at `empresa`. EVERY other operation depends on this having run:
 *  the form, the borrador CRUD and the borradores list are all scoped to it (observed). */
async function selectEmpresa(
  session: PortalSession,
  empresa: FacturaEmpresa,
  tipoDte: TipoDte,
): Promise<void> {
  const res = await session.requestForm(SEL_EMPRESA_URL, {
    form: { DESDE_DONDE_URL: desdeDonde(tipoDte), RUT_EMP: empresa.rut },
  });
  // The redirect target IS the factura form; a bounce back to the chooser means SII refused.
  if (/name="RUT_EMP"/i.test(res.body)) {
    throw new FacturaError(
      `El SII no aceptó la empresa ${empresa.rut} en el Portal MIPYME. ` +
        'Verifica que sigas siendo usuario autorizado de esa empresa.',
    );
  }
}

/** Resolve `rut` against the live authorized list and select it. Returns the matched empresa so
 *  callers can echo SII's own razón social. An unknown RUT fails with the list (ADR-005 style). */
export async function resolveAndSelectEmpresa(
  session: PortalSession,
  rut: Rut,
  tipoDte: TipoDte,
  sleep: () => Promise<void> = () => Promise.resolve(),
): Promise<FacturaEmpresa> {
  const { empresas, scoped } = await resolveChooser(session, tipoDte, sleep);
  const match = empresas.find((e) => e.rut.split('-')[0] === String(rut.body));
  if (!match) {
    throw new FacturaError(
      `${rut.formatted} no está en tus empresas del Portal MIPYME. Disponibles: ` +
        empresas.map((e) => `${e.rut} (${e.nombre})`).join(', ') +
        '.',
    );
  }
  // Launcher shape: SII already scoped the session to this empresa — a POST would be a
  // no-op at best and there is no chooser to accept it (observed 2026-09-09, #95).
  if (scoped) return match;
  await sleep(); // pace the two consecutive hops like every other pair (ADR-004)
  await selectEmpresa(session, match, tipoDte);
  return match;
}

/** Load the factura form for `empresa` (a fresh one, or an existing borrador) and fill it with
 *  `input`, letting SII's own client-side validator pass judgement. Returns the POST-ready body
 *  + SII's computed totals, which every downstream CGI (graba / elimina / preview) consumes. */
export async function fillFactura(
  session: PortalSession,
  empresa: FacturaEmpresa,
  input: FacturaBorradorInput,
): Promise<FacturaFilled> {
  const [body, dv] = empresa.rut.split('-');
  const url = input.borradorId
    ? `${FORM_URL}?PTDC_CODIGO=${input.tipoDte}&ES_BORR=TRUE&VALOR=${input.borradorId}` +
      `&IGUAL=CODIGO&RUT=${body}&DV=${dv}&TPO_DOC_GEN=${input.tipoDte}`
    : `${FORM_URL}?PTDC_CODIGO=${input.tipoDte}`;
  const landed = await session.goto(url);
  if (!landed.includes('mipeGenFacEx.cgi')) {
    throw new FacturaError(
      `El SII no entregó el formulario de factura (llegamos a ${landed}). ` +
        'Puede que la empresa no esté autorizada a emitir este tipo de documento.',
    );
  }
  const r = await session.evaluate<FillResult>(
    fillScript({
      ciudadEmisor: input.ciudadEmisor,
      fechaEmision: input.fechaEmision,
      formaPago: FORMA_PAGO[input.formaPago],
      receptor: { ...input.receptor, contacto: input.receptor.contacto ?? '' },
      items: input.items.map((it) => ({
        nombre: it.nombre,
        descripcion: it.descripcion ?? '',
        cantidad: String(it.cantidad),
        unidad: it.unidad ?? '',
        precioUnitario: String(it.precioUnitario),
        descuentoPct: it.descuentoPct ? String(it.descuentoPct) : '',
      })),
      borradorId: input.borradorId ?? '',
    }),
  );
  if (r.scraper) {
    throw new FacturaError(`Formulario de factura del SII no reconocido (${r.scraper}).`);
  }
  if (r.missing && r.missing.length > 0) {
    throw new FacturaError(
      `El formulario del SII cambió de forma: faltan los campos ${r.missing.join(', ')}.`,
    );
  }
  // SII's own validator refused — pass its Spanish message through UNCHANGED (ADR-004).
  if (!r.ok) throw new FacturaError((r.msgs ?? []).join(' ') || 'El SII rechazó el documento.');
  if (!r.fields || !r.totales) throw new FacturaError('El formulario del SII no entregó datos.');
  return { fields: r.fields, totales: r.totales, avisos: r.coerced ?? [] };
}

/** Serialize an EXISTING borrador's form without changing it — the body `mipeEliminaBorrador`
 *  needs (the CGI takes the whole form back, keyed by `EHDR_CODIGO`). Totals come from the
 *  form as SII rendered it. */
export async function loadBorrador(
  session: PortalSession,
  empresa: FacturaEmpresa,
  tipoDte: TipoDte,
  borradorId: string,
): Promise<FacturaFilled> {
  const [body, dv] = empresa.rut.split('-');
  const landed = await session.goto(
    `${FORM_URL}?PTDC_CODIGO=${tipoDte}&ES_BORR=TRUE&VALOR=${borradorId}` +
      `&IGUAL=CODIGO&RUT=${body}&DV=${dv}&TPO_DOC_GEN=${tipoDte}`,
  );
  if (!landed.includes('mipeGenFacEx.cgi')) {
    throw new FacturaError(`El SII no entregó el borrador ${borradorId} (llegamos a ${landed}).`);
  }
  const r = await session.evaluate<FillResult>(`(async () => {
    const f = document.forms['VIEW_EFXP'];
    if (!f) return { scraper: 'no se encontró el formulario VIEW_EFXP' };
    const el = (n) => f.elements[n] || null;
    const hdr = el('EHDR_CODIGO');
    if (!hdr) return { scraper: 'falta EHDR_CODIGO en el borrador' };
    if (hdr.value !== ${JSON.stringify(borradorId)}) {
      return { scraper: 'el SII devolvió otro borrador (' + hdr.value + ')' };
    }
    // The detail grid is drawn ASYNCHRONOUSLY (same hazard as fillScript). Serializing before
    // it exists yielded a form with NO detail lines, and SII then rejected the preview with
    // "Debe ingresar nombre del primer item del detalle" (observed 2026-09-08).
    const deadline = Date.now() + 15000;
    while (!(el('EFXP_NMB_01') && el('EFXP_QTY_01') && el('EFXP_PRC_01'))) {
      if (Date.now() > deadline) return { scraper: 'la grilla de detalle del borrador no se dibujó' };
      await new Promise((r) => setTimeout(r, 50));
    }
    // and wait for the values to actually land (the grid is filled after it is drawn)
    const valued = Date.now() + 10000;
    while (String((el('EFXP_NMB_01') || {}).value || '').trim() === '') {
      if (Date.now() > valued) break; // a genuinely empty borrador is possible
      await new Promise((r) => setTimeout(r, 50));
    }
    const fields = {};
    for (const e of f.elements) {
      if (!e.name || e.type === 'button' || e.type === 'submit') continue;
      if ((e.type === 'checkbox' || e.type === 'radio') && !e.checked) continue;
      fields[e.name] = e.value;
    }
    const num = (n) => Number((el(n) || {}).value || 0);
    return { ok: true, fields, totales: {
      neto: num('EFXP_MNT_NETO'), iva: num('EFXP_IVA'), total: num('EFXP_MNT_TOTAL'),
    } };
  })()`);
  if (r.scraper) throw new FacturaError(`No se pudo leer el borrador ${borradorId}: ${r.scraper}.`);
  if (!r.fields || !r.totales) throw new FacturaError(`El borrador ${borradorId} llegó vacío.`);
  return { fields: r.fields, totales: r.totales, avisos: [] };
}

/** Persist the filled form as a borrador (create, or update when `EHDR_CODIGO` is set).
 *  `ES_BORR=TRUE` is what tells the CGI this is a draft, not a document to sign (observed). */
export async function grabaBorrador(session: PortalSession, filled: FacturaFilled): Promise<void> {
  const res = await postLatin1(session, GRABA_URL, { ...filled.fields, ES_BORR: 'TRUE' });
  assertCgiOk(res.body, 'grabaBorrador');
}

/** Delete a borrador. SII takes the WHOLE form back, keyed by `EHDR_CODIGO` (observed). */
export async function eliminaBorrador(
  session: PortalSession,
  filled: FacturaFilled,
): Promise<void> {
  const res = await postLatin1(session, ELIMINA_URL, { ...filled.fields, ES_BORR: 'TRUE' });
  assertCgiOk(res.body, 'eliminaBorrador');
}

/** Repair SII's DOUBLE-ENCODED text. `listaBorrador` declares `charset=ISO-8859-1` but serves
 *  UTF-8 bytes of an ALREADY-mojibaked string: "Á" arrives as `C3 83 C2 81`, i.e. UTF-8 of
 *  ("Ã", U+0081) — so a correct UTF-8 decode still yields "FundaciÃ³n" / "Ã‘uÃ±oa" (observed
 *  2026-09-08). Undo the extra layer by re-encoding the decoded string as Latin-1 and decoding
 *  it as UTF-8 again. Applied ONLY when the string carries the tell-tale `Ã`/`Â` + continuation
 *  pair AND the round trip decodes cleanly, so legitimately-accented text is left untouched.
 *  This only fixes what we DISPLAY — nothing sent to SII is altered. */
export function repairMojibake(v: string): string {
  if (!/[\u00c2-\u00c3][\u0080-\u00bf]/.test(v)) return v;
  const bytes = Uint8Array.from(v, (ch) => {
    const c = ch.charCodeAt(0);
    return c > 0xff ? 0x3f : c; // non-Latin-1 char ⇒ not a mojibake string
  });
  if (Array.from(v).some((ch) => ch.charCodeAt(0) > 0xff)) return v;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded.includes('\ufffd') ? v : decoded;
  } catch {
    return v; // not valid UTF-8 once re-encoded ⇒ leave the original alone
  }
}

/** The borradores of the CURRENTLY SELECTED empresa. A plain JSON array (no SDI `respEstado`
 *  envelope — observed), served ISO-8859-1; the seam decodes it. Rows carry ~250 mostly-null
 *  form columns; only the listing columns are curated (no `raw` — the row is receptor +
 *  emisor identity, i.e. PII, ADR-004). */
export async function fetchBorradores(session: PortalSession): Promise<FacturaBorradorRow[]> {
  const data = await session.requestJson(LISTA_BORRADOR_URL, { method: 'GET' });
  if (!Array.isArray(data)) {
    throw new FacturaError('El SII no entregó la lista de borradores en el formato esperado.');
  }
  const num = (v: unknown): number | null =>
    typeof v === 'string' && v.trim() !== '' ? Number(v) : null;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v !== '' ? repairMojibake(v) : null;
  return data.map((r) => {
    const row = r as Record<string, unknown>;
    const body = str(row['efxp_RUT_RECEP']);
    const dv = str(row['efxp_DV_RECEP']);
    return {
      id: String(row['ehdr_CODIGO'] ?? ''),
      tipoDte: Number(row['ptdc_CODIGO'] ?? 0),
      tipoDteDesc: String(row['ptdc_CODIGO_DESC'] ?? ''),
      fecha: str(row['efxp_FCH_EMIS']),
      receptorRut: body && dv ? `${body}-${dv}` : null,
      receptorNombre: str(row['efxp_RZN_SOC_RECEP']),
      emisorNombre: str(row['efxp_RZN_SOC']),
      iva: num(row['efxp_IVA']),
      total: num(row['efxp_MNT_TOTAL']),
    };
  });
}

/** Strip tags from one HTML cell and normalise whitespace. */
const cellText = (html: string): string =>
  unescapeHtml(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Parse the emitted-documents table. The markup is MALFORMED — SII leaves the receptor cell
 *  unclosed (`<td>64000001-5 <td>NOMBRE</td>`, observed 2026-09-08) — so rows are split on the
 *  `mipeGesDocEmi.cgi?...CODIGO=` anchor and cells on `<td`, never with a strict parser. */
export function parseEmitidas(html: string): FacturaEmitida[] {
  const out: FacturaEmitida[] = [];
  const re = /<a[^>]*mipeGesDocEmi\.cgi\?[^"']*CODIGO=(\d+)[^>]*>[\s\S]*?<\/tr>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const codigo = m[1];
    if (!codigo) continue;
    // cells AFTER the "Ver" cell that holds the anchor
    const cells = m[0]
      .split(/<td[^>]*>/i)
      .slice(1)
      .map(cellText)
      .filter((c) => c !== '');
    const num = (v: string | undefined): number | null => {
      const d = (v ?? '').replace(/[^\d-]/g, '');
      return d === '' ? null : Number(d);
    };
    out.push({
      codigo,
      receptorRut: cells[0] ?? null,
      receptorNombre: cells[1] ?? null,
      tipoDteDesc: cells[2] ?? null,
      folio: num(cells[3]),
      fecha: cells[4] ?? null,
      monto: num(cells[5]),
      estado: cells[6] ?? null,
    });
  }
  return out;
}

/** The DTEs already emitted by the selected empresa. Read-only: this touches nothing and
 *  cannot issue a document (ADR-023). Every filter is optional; SII takes them as query
 *  params and answers ISO-8859-1 HTML (observed 2026-09-08). */
export async function fetchEmitidas(
  session: PortalSession,
  filtro: FacturaEmitidasFiltro = {},
): Promise<FacturaEmitida[]> {
  const q = new URLSearchParams({
    RUT_RECP: filtro.receptor ?? '',
    FOLIO: filtro.folio === undefined ? '' : String(filtro.folio),
    RZN_SOC: '',
    FEC_DESDE: filtro.desde ?? '',
    FEC_HASTA: filtro.hasta ?? '',
    TPO_DOC: filtro.tipoDoc === undefined ? '' : String(filtro.tipoDoc),
    ESTADO: filtro.estado ? ESTADO_EMITIDO[filtro.estado] : '',
    ORDEN: '',
    NUM_PAG: String(filtro.pagina ?? 1),
  });
  const res = await session.requestForm(`${EMITIDOS_URL}?${q.toString()}`, { method: 'GET' });
  const rejection = serverAlert(res.body);
  if (rejection) throw new FacturaError(`El SII rechazó la consulta: ${rejection}`);
  if (
    !/mipeGesDocEmi\.cgi/i.test(res.body) &&
    !/Documentos Emitidos|No se encontraron/i.test(res.body)
  ) {
    throw new FacturaError(
      'El SII no entregó el listado de documentos emitidos (mipeAdminDocsEmi.cgi). ' +
        'Puede que la sesión ya no esté viva o que el portal haya cambiado.',
    );
  }
  return parseEmitidas(res.body);
}

/** The PDF of an ALREADY EMITTED document, by its listing `codigo` (`DHDR_CODIGO`). A plain
 *  authenticated GET — far simpler than the borrador preview, which needs the review page and
 *  the iframe's own form. Success is decided by `content-type` + `%PDF` magic, NEVER by HTTP
 *  status: SII answers 200 for its error page and for the login-wall bounce too (ADR-022). */
export async function fetchEmitidaPdf(session: PortalSession, codigo: string): Promise<Uint8Array> {
  const res = await session.requestBinary(
    `${EMITIDO_PDF_URL}?DHDR_CODIGO=${encodeURIComponent(codigo)}`,
    {
      method: 'GET',
      headers: {
        Referer: `${CGI}/mipeGesDocEmi.cgi?ALL_PAGE_ANT=2&CODIGO=${encodeURIComponent(codigo)}`,
      },
    },
  );
  if (!isPdfBytes(res.bytes, res.contentType)) {
    const sii = contribuyenteError(res.bytes, res.contentType);
    throw new FacturaError(
      sii
        ? `El SII no entregó el documento emitido: ${sii}`
        : `El SII no devolvió un PDF del documento emitido (content-type: ${res.contentType ?? 'desconocido'}).`,
    );
  }
  return res.bytes;
}

/** Fetch the PREVIEW PDF of a filled (unsigned) document — the "Validar y visualizar" path.
 *
 *  TWO hops, both first-hand-observed 2026-09-08:
 *    1. POST the VIEW_EFXP body to `mipeDisplayPreView.cgi` → the review page, whose
 *       `PreViewDTE` form carries the document as ~245 HIDDEN inputs.
 *    2. POST that `PreViewDTE` body to `mipePreView.cgi` → `application/pdf`.
 *
 *  Hop 2 is the PDF the portal embeds in its `framePdf` iframe: the document stamped
 *  "VISTA PREVIA / DOCUMENTO NO VALIDO", folio NOT assigned. Reaching the review page is NOT
 *  signing it — its `Firmar` button posts to `mipeGenXMLFirma.cgi`, which this module never
 *  calls (ADR-023).
 *
 *  Success is decided by `content-type` + the `%PDF` magic, NEVER by HTTP status — SII answers
 *  200 for its own error page and for the login-wall bounce too (the ADR-022 rule). */
export async function fetchPreviewPdf(
  session: PortalSession,
  filled: FacturaFilled,
  sleep: () => Promise<void> = () => Promise.resolve(),
): Promise<Uint8Array> {
  const review = await postLatin1(session, PREVIEW_URL, filled.fields);
  // SII rejects a bad document with a 200 "Redireccionando" page whose only content is an
  // alert() + history.go(-1) (observed 2026-09-08). Surface ITS message verbatim (ADR-004)
  // instead of a generic failure — that is the real reason the PDF never came back.
  const rejection = serverAlert(review.body);
  if (rejection) throw new FacturaError(`El SII rechazó el documento: ${rejection}`);
  const fields = parseHiddenInputs(review.body, 'PreViewDTE');
  if (Object.keys(fields).length === 0) {
    throw new FacturaError(
      'El SII no entregó la vista previa del documento (no se encontró el formulario PreViewDTE). ' +
        'Puede que haya rechazado algún dato del documento.',
    );
  }
  // Reproduce the iframe's request as the browser issues it — captured from the live network
  // panel, NOT guessed. Without the Referer/Origin/sec-fetch-dest trio SII answers with an
  // HTML page instead of the PDF (that was the "recibe HTML en vez de PDF" failure).
  // The iframe does NOT post the review page's fields wholesale: it owns a form of its own
  // (`VIEW`, 239 inputs) and copies the values across, so the PDF CGI receives that exact,
  // narrower field set. Posting all 243 PreViewDTE hidden inputs instead made SII answer with
  // its generic "Error al contribuyente" page (observed 2026-09-08). Derive the field list from
  // SII's own frame at runtime rather than hardcoding 239 names — if SII edits the frame, the
  // request follows.
  await sleep();
  const frame = await session.requestForm(PREVIEW_FRAME_URL, { method: 'GET' });
  const wanted = frameFields(frame.body);
  if (wanted.length === 0) {
    throw new FacturaError(
      'El SII cambió PreViewFrame.html: no se pudo determinar los campos de la vista previa.',
    );
  }
  // The frame copies 238 of its 239 inputs from the review page; the odd one out, `EFXP_FOLIO`,
  // keeps the frame's OWN default (`value="0"`) because an unsigned preview has no folio. So a
  // field absent from the review page must fall back to the frame's declared value, NOT to ''
  // — sending `EFXP_FOLIO=` made SII answer "Error al contribuyente" (observed 2026-09-08).
  const body = latin1FormBody(wanted.map((f) => [f.name, fields[f.name] ?? f.value] as const));

  await sleep(); // pace the two consecutive POSTs (the browser does them a beat apart)
  const res = await session.requestBinary(PDF_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: PREVIEW_FRAME_URL,
      Origin: MIPE_ORIGIN,
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Upgrade-Insecure-Requests': '1',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
    body,
  });
  if (!isPdfBytes(res.bytes, res.contentType)) {
    // Relay SII's own message when it gave one (ADR-004) instead of a bare content-type.
    const sii = contribuyenteError(res.bytes, res.contentType);
    throw new FacturaError(
      sii
        ? `El SII no generó la vista previa: ${sii}`
        : `El SII no devolvió un PDF de vista previa (content-type: ${res.contentType ?? 'desconocido'}).`,
    );
  }
  return res.bytes;
}
