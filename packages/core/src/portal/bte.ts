// BTE/BHE — Boletas de Honorarios Electrónicas. Typed facade over the inline JS maps the
// legacy `loa.sii.cl/cgi_IMT/` CGIs fill client-side. Ported from the proven Python sii-cli
// (portal/bte.py, live-captured #62) and TS-live-validated 2026-06-30 (#20); the wire
// contract is first-hand-observed, NOT a third-party library (ADR-004). See
// docs/sii-contract/bte.md.
//
// DISTINCT from the SDI-JSON facades (RCV/F22/F29): these CGIs serve an HTML skeleton whose
// tables the page JS fills from global JS maps. The maps themselves are literal statements in
// the HTML (observed 2026-10-26, #222), so we GET the page with `requestText` (the .sii.cl
// session cookie carries to loa.sii.cl, on the HTTP driver too) and parse the statements
// (`readInlineMap`) — no browser, NOT `requestJson`, never the DOM (CONVENTIONS: prefer inline
// data). A dead jar lands on the login host and the driver raises `SessionExpiredError`.
//
// SESSION-KEYED (ADR-005): `rut_arrastre` is keyed to the session PRINCIPAL — a represented
// RUT does NOT reach the empresa's data (confirmed live #62). The task reads self only.
import { HOSTS } from '../config/index.js';
import { BteError } from '../errors/index.js';
import { checkAborted } from '../errors/abort.js';
import { Rut } from '../rut/index.js';
import { readInlineMap } from './inline-map.js';
import type { Periodo } from '../periodo/index.js';
import type { PortalSession } from '../seams/index.js';

export type BteSide = 'EMITIDAS' | 'RECIBIDAS';

// Monthly-detail CGIs (observed 2026-06-30). Emitidas (emisor) = `…Bhe`; recibidas
// (receptor) = `…BheRec`. All reads are GET; the RUT travels split in the query string.
const MENSUAL_CGI: Record<BteSide, string> = {
  EMITIDAS: 'TMBCOC_InformeMensualBhe.cgi',
  RECIBIDAS: 'TMBCOC_InformeMensualBheRec.cgi',
};

// A non-advancing-loop backstop. The total_boletas target + the no-new-rows guard end
// pagination first in practice; this only caps a pathological page sequence (ADR-004).
const MAX_PAGINAS = 100;

/** One boleta de honorarios — curated, **no `raw`** (live BUG-1, 2026-06-30). The per-boleta
 *  ROW mixes counterparty data with the taxpayer's OWN identity on BOTH sides (EMITIDAS:
 *  `usuemisor` = the emitter = self; RECIBIDAS: a self receptor-name field), plus a counterparty
 *  email — and the full own-identity field set is not provably enumerable. So, like F22/F29, BTE
 *  exposes NO `raw`: the curated fields below ARE the tax detail a contador reads; the dropped
 *  fields are own-identity PII / counterparty email / low-value metadata (barcode, comuna). The
 *  report META's `nombre_contribuyente`/`rut_arrastre` are likewise never read. Montos are parsed
 *  from SII's es-CL dot-formatted strings. (CONVENTIONS: drop `raw` when non-curated data is PII.) */
export interface BteBoleta {
  readonly folio: number | null;
  /** Emisión/boleta date, `DD/MM/YYYY` verbatim (ADR-004). */
  readonly fecha: string | null;
  /** Counterparty: receptor (emitidas) or emisor (recibidas), canonical RUT. */
  readonly contraparteRut: string | null;
  readonly contraparteNombre: string | null;
  readonly totalHonorarios: number | null;
  readonly honorariosLiquidos: number | null;
  readonly retencionEmisor: number | null;
  readonly retencionReceptor: number | null;
  /** `N` → `VIG` (vigente) / `S` → `ANUL` (anulada). */
  readonly estado: 'VIG' | 'ANUL' | null;
  readonly fechaAnulacion: string | null;
  readonly socProfesional: boolean | null;
}

/** Per-month aggregates from the report META (`xml_values`). */
export interface BteTotales {
  readonly honorarios: number | null;
  readonly retencionEmisor: number | null;
  readonly retencionReceptor: number | null;
  readonly liquido: number | null;
}

export interface BteMensual {
  /** Session-principal RUT these boletas belong to (canonical). */
  readonly rut: string;
  readonly periodo: string; // YYYY-MM
  readonly side: BteSide;
  readonly totalBoletas: number | null;
  readonly totales: BteTotales;
  readonly boletas: readonly BteBoleta[];
}

// --- Alias-tolerant row fields (observed name first; emitidas / recibidas differ) --------
const ALIASES = {
  folio: ['nroboleta'],
  fecha: ['fechaemision', 'fecha_boleta'], // emitidas: fechaemision; recibidas: fecha_boleta
  rutDigits: ['rutreceptor', 'rutemisor'],
  dv: ['dvreceptor', 'dvemisor'],
  nombre: ['nombrereceptor', 'nombre_emisor'],
  totalHonorarios: ['totalhonorarios'],
  honorariosLiquidos: ['honorariosliquidos'],
  retencionEmisor: ['retencion_emisor'],
  retencionReceptor: ['retencion_receptor'],
  estado: ['estado'],
  fechaAnulacion: ['fechaanulacion'],
  socProfesional: ['es_soc_profesional'],
} as const;

const aliasGet = (row: Record<string, unknown>, aliases: readonly string[]): unknown => {
  for (const key of aliases) {
    const v = row[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};

const asStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Parse a Chilean integer monto. Read from the HTML, row montos are `formatMiles`' raw
 *  argument and meta sums bare numbers (both plain, `"1300000"`); a dot-formatted `"1.300.000"`
 *  (what the rendered page shows) is accepted too. Non-numeric → null. */
const asMonto = (v: unknown): number | null => {
  const s = asStr(v);
  if (s === null) return null;
  const digits = s.replace(/[.\s]/g, '').replace(/,/g, '');
  if (!/^-?\d+$/.test(digits)) return null;
  return Number(digits);
};

const estadoLabel = (v: unknown): 'VIG' | 'ANUL' | null => {
  const s = asStr(v)?.toUpperCase();
  if (s === 'N') return 'VIG';
  if (s === 'S') return 'ANUL';
  return null;
};

const boolSiNo = (v: unknown): boolean | null => {
  const s = asStr(v)?.toUpperCase();
  if (s === 'SI' || s === 'S') return true;
  if (s === 'NO' || s === 'N') return false;
  return null;
};

const canonicalRut = (digits: unknown, dv: unknown): string | null => {
  if (digits === undefined || digits === null || dv === undefined || dv === null) return null;
  return Rut.tryParse(`${String(digits)}-${String(dv).trim()}`)?.canonical ?? null;
};

function monthlyUrl(side: BteSide, rut: Rut, periodo: Periodo, pagina: number): string {
  const anio = String(periodo.year).padStart(4, '0');
  const mes = String(periodo.month).padStart(2, '0');
  return (
    `${HOSTS.bheCgi}/${MENSUAL_CGI[side]}?cbanoinformemensual=${anio}` +
    `&cbmesinformemensual=${mes}&rut_arrastre=${String(rut.body)}&dv_arrastre=${rut.dv}` +
    `&pagina_solicitada=${pagina}`
  );
}

/** Split a flat `arr_informe_mensual` map (`<campo>_<i>`) into per-row records keyed by the
 *  1-based row index, ascending. Each record is `{ <campo>: value }` — the input to
 *  `projectBoleta` (NOT surfaced; BTE exposes no `raw`). */
function rowsByIndex(arr: Record<string, unknown>): Record<string, unknown>[] {
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const [key, value] of Object.entries(arr)) {
    const m = /^(.+)_(\d+)$/.exec(key);
    if (!m) continue;
    const field = m[1]!;
    const i = Number(m[2]);
    let row = byIndex.get(i);
    if (!row) {
      row = {};
      byIndex.set(i, row);
    }
    row[field] = value;
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
}

// Curate ONLY the named tax fields — no `raw` (BUG-1): the row mixes own-identity PII
// (EMITIDAS `usuemisor`, RECIBIDAS self receptor-name) with counterparty data, so we read the
// known tax fields by alias and surface NOTHING else (cf. F22's no-raw posture).
function projectBoleta(row: Record<string, unknown>): BteBoleta {
  return {
    folio: asMonto(aliasGet(row, ALIASES.folio)),
    fecha: asStr(aliasGet(row, ALIASES.fecha)),
    contraparteRut: canonicalRut(aliasGet(row, ALIASES.rutDigits), aliasGet(row, ALIASES.dv)),
    contraparteNombre: asStr(aliasGet(row, ALIASES.nombre)),
    totalHonorarios: asMonto(aliasGet(row, ALIASES.totalHonorarios)),
    honorariosLiquidos: asMonto(aliasGet(row, ALIASES.honorariosLiquidos)),
    retencionEmisor: asMonto(aliasGet(row, ALIASES.retencionEmisor)),
    retencionReceptor: asMonto(aliasGet(row, ALIASES.retencionReceptor)),
    estado: estadoLabel(aliasGet(row, ALIASES.estado)),
    fechaAnulacion: asStr(aliasGet(row, ALIASES.fechaAnulacion)),
    socProfesional: boolSiNo(aliasGet(row, ALIASES.socProfesional)),
  };
}

function parseTotales(meta: Record<string, unknown>): BteTotales {
  return {
    honorarios: asMonto(meta['suma_honorarios']),
    retencionEmisor: asMonto(meta['suma_retencion_emisor']),
    retencionReceptor: asMonto(meta['suma_retencion_receptor']),
    liquido: asMonto(meta['suma_liquido']),
  };
}

type InlineMap = Record<string, string> | null;

/** GET a report CGI and read its inline maps from the HTML. A GET that lands back on the login
 *  host means the cookies-only session is dead: `requestText` raises `SessionExpiredError`
 *  (the driver's URL-based check, ADR-027); this first GET IS the liveness test (withSession
 *  does not pre-probe). */
async function fetchPage(
  session: PortalSession,
  url: string,
): Promise<{ meta: InlineMap; rows: InlineMap }> {
  const { body } = await session.requestText(url, { method: 'GET' });
  return {
    meta: readInlineMap(body, 'xml_values'),
    rows: readInlineMap(body, 'arr_informe_mensual'),
  };
}

/** Monthly BHE detail for one (período, side), session-keyed. Walks `pagina_solicitada` from 0,
 *  paced via `pace` (ADR-004), de-duping by folio+counterparty; stops at `total_boletas`, a
 *  no-new-rows page, or `MAX_PAGINAS`. An empty month is a clean 0-boleta result, NOT an error;
 *  a non-report / cross-RUT page (no `xml_values`) on page 0 is a `BteError`. `session` must be a
 *  live PortalSession acquired via `withSession`.
 *
 *  `signal` bounds the walk (ADR-031): checked before each request and before and after each
 *  pause, never during a request, so the page in flight always completes; a cut throws
 *  `AbortedError`, never a partial month. `onPagina` counts the pages read, for the receipt. */
export async function fetchBteMensual(
  session: PortalSession,
  params: { rut: Rut; periodo: Periodo; side: BteSide },
  pace: () => Promise<void>,
  opts: {
    signal?: AbortSignal | undefined;
    onPagina?: () => void;
    /** Read page 0 only: its META carries the month totals, so `alertas` needs no walk (#245).
     *  `boletas` then holds the first page's rows only. */
    soloTotales?: boolean;
  } = {},
): Promise<BteMensual> {
  const { rut, periodo, side } = params;
  const { signal } = opts;
  const boletas: BteBoleta[] = [];
  const seen = new Set<string>();
  let totalBoletas: number | null = null;
  let totales: BteTotales = {
    honorarios: null,
    retencionEmisor: null,
    retencionReceptor: null,
    liquido: null,
  };

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    if (pagina > 0) {
      checkAborted(signal); // a cut never waits out the pause (ADR-031)
      await pace(); // pace each extra page (ADR-004); the task binds the rps
    }
    checkAborted(signal);
    const { meta, rows } = await fetchPage(session, monthlyUrl(side, rut, periodo, pagina));
    opts.onPagina?.();
    if (meta === null) {
      // No report on this page. On page 0 the (RUT, período) has no informe — a non-report /
      // cross-RUT page (BteError, ADR-004). On a later page it just means we walked past the end.
      if (pagina === 0) {
        throw new BteError(
          `El SII no entregó el informe de boletas de honorarios para ${periodo.formatted} ` +
            `(${side.toLowerCase()}). Verifica la sesión y el período.`,
        );
      }
      break;
    }
    if (pagina === 0) {
      totalBoletas = asMonto(meta['total_boletas']);
      totales = parseTotales(meta);
    }
    let added = 0;
    for (const row of rows === null ? [] : rowsByIndex(rows)) {
      const boleta = projectBoleta(row);
      const key = `${boleta.folio ?? '?'}|${boleta.contraparteRut ?? '?'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      boletas.push(boleta);
      added++;
    }
    if (opts.soloTotales) break;
    if (totalBoletas !== null && boletas.length >= totalBoletas) break;
    if (added === 0) break; // no new rows → end (also the empty-month exit)
  }

  return {
    rut: rut.canonical,
    periodo: periodo.formatted,
    side,
    totalBoletas,
    totales,
    boletas,
  };
}
