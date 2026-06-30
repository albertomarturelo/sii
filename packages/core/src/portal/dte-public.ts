// DTE — public consulta de empresas autorizadas a emitir DTE. Typed facade over the
// UNAUTHENTICATED `PortalDriver.requestPublic` seam (ADR-014).
//
// The FIRST public/session-less portal surface. Unlike rcv/f22/f29, it does NOT ride
// `withSession`: it issues a cold form-POST to the public palena CGI
// (`/cvc_cgi/dte/ee_empresa_rut`), which returns a server-rendered HTML report for ANY
// RUT — no login, no cookie, no session. Ported from the proven Python sii-cli
// (portal/dte.py); the wire contract is first-hand-observed there, NOT a third-party
// library (ADR-004). Full contract: docs/sii-contract/dte-authorized.md.
//
// Observed 2026-06-13, prod (palena.sii.cl): the response is `text/html;
// charset=ISO-8859-1` (the seam decodes it), carrying a header block + a `<table>` of
// authorized docs. No JSON envelope, no captcha. We parse the table rows in-house with
// a small tag stripper — stdlib only, no third-party HTML library (ADR-004).
import { HOSTS } from '../config/index.js';
import { DteError } from '../errors/index.js';
import type { Rut } from '../rut/index.js';
import type { PortalDriver, PublicResponse } from '../seams/index.js';

// `/cvc/dte/ee_empresas_dte.html` is the public HTML form; its validation JS rewrites
// the submit target to this `/cvc_cgi/` CGI path (observed 2026-06-13). We POST the CGI
// path directly — the static `ee_empresa_rut` path returns "NO SE ENCONTRÓ LA PÁGINA".
const AUTORIZADOS_URL = `${HOSTS.dteWs}/cvc_cgi/dte/ee_empresa_rut`;

// Origin/Referer mirror the public form page; neither is required (all headers confirmed
// optional 2026-06-13), but sending them keeps the request indistinguishable from the form.
const HEADERS: Record<string, string> = {
  Origin: HOSTS.dteWs,
  Referer: `${HOSTS.dteWs}/cvc/dte/ee_empresas_dte.html`,
};

// SII's verbatim "not an authorized emisor" sentence (observed 2026-06-13). Its presence
// (with no docs table) is a CLEAN NEGATIVE — the RUT exists-or-not but is not a DTE emisor
// — never an error (ADR-014). Matched as a lowercased substring on the decoded body.
const NOT_AUTHORIZED_MARKER = 'no corresponde a una empresa autorizada';

/** One authorized DTE type row. `fecha*` keep SII's `DD-MM-YYYY` string verbatim
 *  (ADR-004 — pass SII's data through unchanged); `fechaDesautorizacion` is null while
 *  the type is currently authorized (empty cell). */
export interface DteAutorizado {
  readonly codigo: number;
  readonly descripcion: string | null;
  readonly fechaAutorizacion: string | null;
  readonly fechaDesautorizacion: string | null;
}

/** Authorized-DTE-emitter report for one subject RUT (public consulta). `autorizado` is
 *  true when the RUT is a registered DTE emisor (header + docs grid present); false when
 *  SII answered with the "no corresponde" message — then `mensaje` holds that verbatim
 *  sentence and `documentos` is empty. No `raw`: the HTML carries exactly these fields
 *  (ADR-004 curated+raw is for fat JSON rows, not this table). */
export interface DteAutorizados {
  /** Subject RUT queried (canonical, e.g. "20000042-0"). */
  readonly rut: string;
  readonly autorizado: boolean;
  readonly razonSocial: string | null;
  readonly nResolucion: string | null;
  readonly fechaResolucion: string | null;
  readonly direccionRegional: string | null;
  readonly documentos: readonly DteAutorizado[];
  /** SII's verbatim "no autorizado" sentence; null on the authorized path. */
  readonly mensaje: string | null;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Decode the handful of HTML entities SII's report can carry. The body is already
// Latin-1-decoded by the seam, so most accents are real chars; numeric/named refs
// (e.g. N&deg;, &oacute;) still appear and are normalised here. NAMED accent entities are
// CASE-SENSITIVE (`&Eacute;` = É, `&eacute;` = é) — keep the cases distinct.
const NAMED_ENTITIES: Record<string, string> = {
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  deg: '°',
  ordm: 'º',
};
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&([A-Za-z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

/** Collect every `<tr>` as a list of `<td>`/`<th>` cell texts (tags stripped, entities
 *  decoded, whitespace collapsed, empty cells preserved). The tables are siblings (not
 *  nested), so a flat row collector suffices — rows are classified by content downstream,
 *  not by which table they came from (mirrors the Python `_TableRowParser`). */
function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (let tr = trRe.exec(html); tr !== null; tr = trRe.exec(html)) {
    const cells: string[] = [];
    const tdRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const inner = tr[1] ?? '';
    for (let td = tdRe.exec(inner); td !== null; td = tdRe.exec(inner)) {
      const text = (td[1] ?? '').replace(/<[^>]*>/g, ' ');
      cells.push(decodeEntities(text).replace(/\s+/g, ' ').trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** Map a header-table label cell to a logical field. Order matters: "Fecha Resolución"
 *  also contains "resoluc", so test it before "N° Resolución" (mirrors Python). */
function classifyHeaderLabel(label: string): keyof DteAutorizados | null {
  const low = label.toLowerCase();
  if (low.includes('fecha') && low.includes('resoluc')) return 'fechaResolucion';
  if (low.includes('resoluc')) return 'nResolucion';
  if (low === 'rut') return 'rut';
  if (low.includes('raz') && low.includes('social')) return 'razonSocial';
  if (low.includes('regional')) return 'direccionRegional';
  return null;
}

const cell = (cells: string[], i: number): string | null => {
  const v = cells[i];
  return v === undefined || v === '' ? null : v;
};

/** Pull SII's verbatim "no autorizado" sentence out of the HTML (ADR-004); falls back to
 *  a fixed phrasing if the surrounding markup defeats cell extraction. */
function notAuthorizedMessage(html: string): string {
  for (const row of tableRows(html)) {
    for (const c of row) {
      if (c.toLowerCase().includes(NOT_AUTHORIZED_MARKER)) return c;
    }
  }
  return 'El rut que ha ingresado, no corresponde a una empresa autorizada a emitir Facturas Electronicas.';
}

/** Parse the decoded HTML report into a `DteAutorizados`. Throws `DteError` when the body
 *  is neither a recognizable authorized report nor the known not-authorized message (the
 *  portal HTML changed shape — "scraper roto", ADR-004). */
function parseReport(html: string, subjectCanonical: string): DteAutorizados {
  if (html.toLowerCase().includes(NOT_AUTHORIZED_MARKER)) {
    return {
      rut: subjectCanonical,
      autorizado: false,
      razonSocial: null,
      nResolucion: null,
      fechaResolucion: null,
      direccionRegional: null,
      documentos: [],
      mensaje: notAuthorizedMessage(html),
    };
  }

  const header: Partial<Record<keyof DteAutorizados, string>> = {};
  const documentos: DteAutorizado[] = [];
  for (const cells of tableRows(html)) {
    if (cells.length < 2) continue;
    const first = (cells[0] ?? '').trim();
    if (/^\d+$/.test(first)) {
      // A docs-grid row: [codigo, descripcion, autorizado, desautorizado].
      documentos.push({
        codigo: Number(first),
        descripcion: cell(cells, 1),
        fechaAutorizacion: cell(cells, 2),
        fechaDesautorizacion: cell(cells, 3),
      });
      continue;
    }
    const logical = classifyHeaderLabel(first);
    const value = cells[1];
    if (logical && value !== undefined && header[logical] === undefined) header[logical] = value;
  }

  if (header.rut === undefined && documentos.length === 0) {
    throw new DteError(
      'scraper roto: la respuesta del SII no trae ni la tabla de documentos autorizados ' +
        'ni el mensaje de "no autorizado" esperado (la página pudo cambiar). ' +
        `RUT consultado: ${subjectCanonical}.`,
    );
  }

  return {
    rut: subjectCanonical,
    autorizado: true,
    razonSocial: header.razonSocial ?? null,
    nResolucion: header.nResolucion ?? null,
    fechaResolucion: header.fechaResolucion ?? null,
    direccionRegional: header.direccionRegional ?? null,
    documentos,
    mensaje: null,
  };
}

/** List the DTE types a contribuyente is authorized to emit (public, login-free).
 *  Hits the palena consulta CGI with no session, for ANY RUT incl. counterparties
 *  (ADR-014). Returns the resolution header + authorized-document grid, or a clean
 *  negative (`autorizado: false` + SII's verbatim `mensaje`) when the RUT is not a
 *  registered DTE emisor. Throws `DteError` on a network/CGI failure, a non-200, or an
 *  unrecognizable body. `driver` is the seam — NO `PortalSession` (it is session-less). */
export async function fetchDteAutorizados(driver: PortalDriver, rut: Rut): Promise<DteAutorizados> {
  let response: PublicResponse;
  try {
    response = await driver.requestPublic(AUTORIZADOS_URL, {
      method: 'POST',
      headers: HEADERS,
      form: { RUT_EMP: String(rut.body), DV_EMP: rut.dv },
    });
  } catch (e) {
    throw new DteError(`No se pudo consultar el SII (${AUTORIZADOS_URL}): ${messageOf(e)}`);
  }
  // palena answers HTTP 200 for BOTH authorized and not-authorized; a non-200 is an
  // infrastructure failure, not a user condition — fail loud, never retry (ADR-004).
  if (response.status !== 200) {
    throw new DteError(
      `El SII respondió HTTP ${response.status} a la consulta de DTE autorizados.`,
    );
  }
  return parseReport(response.body, rut.canonical);
}
