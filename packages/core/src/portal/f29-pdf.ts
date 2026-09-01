// F29 document downloads — the `rfiInternet` PDF servlets (ADR-022).
//
// A filed F29 exposes two PDF artifacts, both plain AUTHENTICATED GETs (observed live
// 2026-08-31, docs/sii-contract/f29-pdf.md):
//
//   GET https://www4.sii.cl/rfiInternet/formCompacto?folio=…&rut=…&form=029&codInt=…
//   GET https://www4.sii.cl/rfiInternet/formSolemne?folio=…&rut=…&dv=…&form=029&codInt=…
//
// `codInt` is the `codigo` field the estado facade (`getDeclaracionConEstados`, portal/f29.ts)
// already returns per declaración — so no GWT-RPC and no SPA warm-up is needed. NOTE that
// `formSolemne` takes `dv` and `formCompacto` does not; SII's own inconsistency, observed.
//
// These are NOT the `rfiInternet` GWT app (`?opcionPagina=formCompleto`), which bounces a live
// session to the login wall without the SPA warm-up chain — that is ADR-013's deferred Fase 2.
import { HOSTS } from '../config/index.js';
import { F29Error } from '../errors/index.js';
import type { Rut } from '../rut/index.js';
import type { BinaryResponse, PortalSession } from '../seams/index.js';

/** Which artifact to download. `compacto` = the filed form as SII prints it (and, when the
 *  período was paid, the payment receipt — its stamp reads "RECIBIDA Y PAGADA POR INTERNET").
 *  `solemne` = the formal "Certificado Declaración de Formulario 29". */
export type F29PdfTipo = 'compacto' | 'solemne';

export const F29_PDF_TIPOS = ['compacto', 'solemne'] as const;

/** What a SURFACE accepts: the artifacts plus the "both" shorthand. Kept here so the CLI
 *  option list and the MCP zod enum cannot drift from each other. */
export const F29_PDF_TIPO_ARGS = ['compacto', 'solemne', 'ambos'] as const;
export type F29PdfTipoArg = (typeof F29_PDF_TIPO_ARGS)[number];

/** Internal F29 form number in the document URLs — `029`, zero-padded (NOT the internal id
 *  "2" the SDI facades use for `formId`/`formCodigo`). Observed. */
const FORM = '029';
const PDF_MAGIC = '%PDF-';

export interface F29PdfBytes {
  readonly tipo: F29PdfTipo;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/** Build the servlet URL for one artifact. Exported for the contract test — the param set
 *  differs per tipo and is easy to regress. */
export function f29PdfUrl(params: {
  tipo: F29PdfTipo;
  rut: Rut;
  folio: number;
  codigo: number;
}): string {
  const { tipo, rut, folio, codigo } = params;
  const q = new URLSearchParams({ folio: String(folio), rut: String(rut.body) });
  // Only `formSolemne` takes the DV (observed 2026-08-31) — sending it to `formCompacto`
  // is untested, so we mirror the portal exactly rather than guessing.
  if (tipo === 'solemne') q.set('dv', rut.dv);
  q.set('form', FORM);
  q.set('codInt', String(codigo));
  const path = tipo === 'solemne' ? 'formSolemne' : 'formCompacto';
  return `${HOSTS.portalApi}/rfiInternet/${path}?${q.toString()}`;
}

/** SII answers HTTP 200 for its own error page, so an unsuccessful download arrives as HTML.
 *  Decode it (ISO-8859-1, its declared charset) and lift the message so it can be surfaced
 *  VERBATIM (ADR-004). The page repeats its <title> in the body, so <head> is dropped first
 *  and consecutive duplicate sentences collapsed. */
function siiHtmlMessage(bytes: Uint8Array): string | null {
  const html = new TextDecoder('iso-8859-1').decode(bytes);
  // Only an actual HTML page is SII speaking; anything else is a changed surface, and
  // echoing raw bytes as if they were SII's message would be misleading.
  if (!/<\s*(html|body|b|br|p|div)\b/i.test(html)) return null;
  const body = html.replace(/<head[\s\S]*?<\/head>/i, '');
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  // "A. B. A. B." → "A. B." (the title echo).
  const parts = text.split(/(?<=\.)\s+/).filter(Boolean);
  const seen: string[] = [];
  for (const p of parts) if (!seen.includes(p)) seen.push(p);
  return seen.join(' ');
}

/** Download one F29 PDF. Success is decided by `content-type` + the `%PDF-` magic, NEVER by
 *  status: SII returns 200 for its error page too (observed). A dead cookie jar never reaches
 *  here — the seam detects the login-wall bounce and raises `SessionExpiredError`, which is
 *  allowed to propagate so the user is told to re-login (CONVENTIONS). Never retried. */
export async function fetchF29Pdf(
  session: PortalSession,
  params: { tipo: F29PdfTipo; rut: Rut; folio: number; codigo: number },
): Promise<F29PdfBytes> {
  const url = f29PdfUrl(params);
  const res: BinaryResponse = await session.requestBinary(url, { method: 'GET' });
  const contentType = res.contentType ?? '';
  const magic = new TextDecoder('latin1').decode(res.bytes.subarray(0, PDF_MAGIC.length));

  if (contentType.toLowerCase().includes('application/pdf') && magic === PDF_MAGIC) {
    return { tipo: params.tipo, contentType, bytes: res.bytes };
  }
  // Not a PDF: either SII's business refusal (wrong/absent codInt) or a changed surface.
  const message = siiHtmlMessage(res.bytes);
  if (message) throw new F29Error(message);
  throw new F29Error(
    `SII no devolvió un PDF para el folio ${params.folio} (content-type: ${contentType || 'desconocido'}). Scraper roto.`,
  );
}
