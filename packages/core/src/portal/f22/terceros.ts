// Información de terceros: the declaraciones juradas third parties filed about the taxpayer
// for an año tributario (employers, banks, AGFs, corredoras…). The F22 propuesta is built from
// them. Observed first-hand 2026-10-21 (spike #184, own persona session, AT 2026): SII's
// "Información de sus ingresos, agentes retenedores y otros" is its own Angular SPA,
// `djconsultarentaui`, over the same SDI envelope as the F22-status app (shared.ts).
// Full contract: docs/sii-contract/f22.md « Terceros ».
//
// The answers are RENDER GRIDS, not named fields: multi-level headers (colspan/rowspan), a RUT
// across three positions, and a column set that differs per DJ. `parseGrid` turns one into rows
// of `{ columna, valor }`, `columna` being the path of header labels above the cell.
//
// SESSION-KEYED (ADR-005) although `getDjDetalle` carries a RUT: under a persona session the
// represented empresa's RUT answered "Acceso no autorizado!" (observed 2026-10-21).
// PII (ADR-006): the column set is per DJ and not provably enumerable, so there is no `raw` and
// the taxpayer's own RUT and name are dropped by VALUE, not by column label.
import { z } from 'zod';
import { HOSTS } from '../../config/index.js';
import { F22Error } from '../../errors/index.js';
import type { Anio } from '../../periodo/index.js';
import type { Rut } from '../../rut/index.js';
import type { PortalSession } from '../../seams/index.js';
import { asNumber, postSdi, rutDigits, type SdiApp } from './shared.js';

const BASE = `${HOSTS.portalApi}/djconsultarentaui/services/data/facadeService`;
const NAMESPACE = 'cl.sii.sdi.lob.renta.djconsultarenta.data.api.interfaces.FacadeService';

/** The SPA sends `metaData.page: null` (observed), unlike `consultaestadof22ui`. */
const TERCEROS_APP: SdiApp = {
  referer: `${HOSTS.portalApi}/djconsultarentaui/internet/`,
  metaPage: true,
};

/** Rows per `getDjDetalle` answer (observed: 10 per page, the last page holds the rest). */
export const TERCEROS_PAGE_SIZE = 10;

/** AT 2026 ⇒ `"202600"`: the año tributario plus `"00"`, sent as a string (observed). */
const periodoOf = (anio: Anio): string => `${anio.canonical}00`;

export type ValorTercero = string | number | null;

/** One logical column of a row: the header-label path and its typed value. */
export interface CampoTercero {
  readonly columna: string;
  readonly valor: ValorTercero;
}

/** One ítem of the resumen: a DJ (four-digit código) or an SII-internal ítem (shorter código,
 *  e.g. `303` "Comparativo F29 y Registro de compra y venta"), with its aggregate rows. */
export interface DeclaracionTercero {
  readonly dj: string;
  readonly titulo: string | null;
  readonly filas: readonly (readonly CampoTercero[])[];
}

/** One row of a DJ's detalle. The columns every detalle carries are named; the rest, which
 *  differ per DJ, are in `campos`. */
export interface FilaTercero {
  readonly folio: string | null;
  readonly declaranteRut: string | null;
  readonly declaranteNombre: string | null;
  readonly fechaPresentacion: string | null; // ISO YYYY-MM-DD
  readonly estado: string | null; // SII's per-row flag, e.g. "No Observada"
  readonly origen: string | null; // e.g. "Tercero"
  readonly campos: readonly CampoTercero[];
}

export interface PaginaTerceros {
  /** The DJ's total row count (`cantRegistros`). A page past the end answers 0. */
  readonly registros: number;
  readonly filas: readonly FilaTercero[];
}

/** The taxpayer's own identity, dropped from every row by value. */
export interface IdentidadPropia {
  readonly rut: Rut;
  /** Razón social / nombre cached at login; null when unknown. */
  readonly nombre: string | null;
}

// --- Wire shape (zod at the boundary, ADR-011) ------------------------------------
const Cell = z
  .object({
    colspan: z.number().nullish(),
    rowspan: z.number().nullish(),
    value: z.union([z.string(), z.number()]).nullish(),
    esParteDeSpan: z.boolean().nullish(),
  })
  .loose();
type Cell = z.infer<typeof Cell>;
const Row = z.object({ fila: z.record(z.string(), Cell), tipoCelda: z.string() }).loose();
type Row = z.infer<typeof Row>;
const Grid = z
  .object({ tabla: z.record(z.string(), Row), cantRegistros: z.number().nullish() })
  .loose();
type Grid = z.infer<typeof Grid>;
const Secciones = z.record(z.string(), z.record(z.string(), Grid));
const Resumen = z
  .array(z.object({ listAgenteRetenedor: Secciones, title: z.string().nullish() }).loose())
  .nullish();
const Detalle = z.object({ listDetalle: Secciones }).loose().nullish();

const roto = (what: string): F22Error =>
  new F22Error(`Scraper roto: ${what} (información de terceros, F22).`);

// --- Values ------------------------------------------------------------------------
/** One title arrived double-encoded (UTF-8 bytes read as Latin-1: `EnajenaciÃ³n`, `NÂ°`)
 *  while the others were clean (observed 2026-10-21). Re-decode only that pattern, and only
 *  when the bytes are valid UTF-8; anything else stays as SII sent it. */
function fixMojibake(s: string): string {
  if (!/[ÃÂ]/.test(s)) return s;
  const codes = [...s].map((ch) => ch.charCodeAt(0));
  if (codes.some((c) => c > 0xff)) return s;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(codes));
  } catch {
    return s;
  }
}

/** A label or text value: re-decoded, `&nbsp;`/U+00A0 as a space, whitespace collapsed;
 *  blank ⇒ null (a blank cell is a legitimately absent value, CONVENTIONS). */
function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = fixMojibake(String(v))
    .replace(/&nbsp;| /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s === '' ? null : s;
}

// es-CL integers/decimals as SII prints montos (`"1.234.567"`, `"0"`, `"12,5"`). A digit
// string with a leading zero is a code, not an amount, so it stays a string.
const ES_CL_NUMBER = /^-?(?:[1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d*|0)(?:,\d+)?$/;
const DD_MM_YYYY = /^(\d{2})-(\d{2})-(\d{4})$/;

function typed(v: unknown): ValorTercero {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = text(v);
  if (s === null) return null;
  const d = DD_MM_YYYY.exec(s);
  if (d) return `${d[3]}-${d[2]}-${d[1]}`;
  return ES_CL_NUMBER.test(s) ? asNumber(s) : s;
}

const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** A name's tokens, order-free: SII prints the same person as "NOMBRE APELLIDO" in one place
 *  and "APELLIDO NOMBRE" in another. */
const nameTokens = (s: string): Set<string> =>
  new Set(
    norm(s)
      .split(/[^a-z]+/)
      .filter((t) => t.length > 1),
  );

/** The informado (the taxpayer) is the "partícipe o aportante" of the fund DJs: observed
 *  2026-10-21 as `Rut Partícipe`, `Nombre o Razón Social del Partícipe o Aportante`,
 *  `RUT del Partícipe o Aportante` and `Código País de Residencia del Partícipe o Aportante`.
 *  Those columns are the taxpayer's own identity, so they are dropped by label. The informante
 *  spells the name its own way (2 of 3 words matched the Mi SII name), so a value match alone
 *  would let it through. */
const OWN_IDENTITY_COLUMN = /\bparticipe\b|\baportante\b/;

// --- The grid ------------------------------------------------------------------------
const byNumber = (a: string, b: string): number => Number(a) - Number(b);

function cellsOf(row: Row): Cell[] {
  const keys = Object.keys(row.fila).sort(byNumber);
  return keys.map((k, i) => {
    const cell = row.fila[k];
    if (Number(k) !== i || cell === undefined) throw roto('una fila con posiciones no contiguas');
    return cell;
  });
}

/** A logical column: a run of positions sharing one header path. A RUT is a run of three
 *  (body | "-" | dv) under one `colspan: 3` header. */
interface Columna {
  readonly path: string;
  readonly start: number;
  readonly width: number;
  readonly rut: boolean;
}

/** Header paths per position. The width comes from the `dato` rows: the first header row can
 *  be a title ("Seccion B: DATOS DE LOS INFORMADOS") whose colspan is `cantidadColumnas`, and
 *  that was observed WIDER than the grid (78 vs 65), so it is skipped, never used for width. */
function columnas(headers: readonly Row[], width: number): Columna[] {
  const rows = headers.map(cellsOf);
  const first = rows[0];
  const isTitle =
    first !== undefined &&
    first.filter((c) => !c.esParteDeSpan && text(c.value) !== null).length === 1 &&
    (first.find((c) => !c.esParteDeSpan)?.colspan ?? 1) > 1;
  const body = isTitle ? rows.slice(1) : rows;

  // Paint each label over its colspan × rowspan rectangle. A null-valued cell (SII emits one
  // under a rowspan, e.g. `null{c3}`) paints nothing.
  const painted: (string | null)[][] = body.map(() => new Array<string | null>(width).fill(null));
  body.forEach((cells, r) => {
    if (cells.length !== width) {
      throw roto(`un encabezado de ${cells.length} posiciones en una grilla de ${width}`);
    }
    cells.forEach((cell, p) => {
      const label = cell.esParteDeSpan ? null : text(cell.value);
      if (label === null) return;
      for (let dr = 0; dr < (cell.rowspan ?? 1) && r + dr < body.length; dr++) {
        for (let dc = 0; dc < (cell.colspan ?? 1) && p + dc < width; dc++) {
          const line = painted[r + dr];
          if (line && line[p + dc] === null) line[p + dc] = label;
        }
      }
    });
  });

  const paths = Array.from({ length: width }, (_, p) => {
    const labels: string[] = [];
    for (const line of painted) {
      const l = line[p];
      if (l !== null && l !== undefined && labels.at(-1) !== l) labels.push(l);
    }
    // The SII-internal ítems carry unlabeled data columns: `303` (Comparativo F29 y Registro de
    // compra y venta) labels only its first one (observed). Name them by position.
    return labels.length === 0 ? `columna ${p + 1}` : labels.join(' › ');
  });

  const out: Columna[] = [];
  for (let p = 0; p < width;) {
    let end = p + 1;
    while (end < width && paths[end] === paths[p]) end++;
    const path = paths[p] ?? '';
    const run = end - p;
    if (run === 3 && /\b(rut|run)\b/i.test(path)) {
      out.push({ path, start: p, width: 3, rut: true });
    } else {
      // A run that is not a RUT keeps each position as its own column, under the same label.
      for (let i = p; i < end; i++) out.push({ path, start: i, width: 1, rut: false });
    }
    p = end;
  }
  return out;
}

/** body | "-" | dv ⇒ `<body>-<DV>`. `0 - 0` is how SII prints an absent RUT (observed). */
function joinRut(cells: readonly Cell[]): string | null {
  const body = text(cells[0]?.value)?.replace(/\./g, '') ?? null;
  const dv = text(cells[2]?.value);
  if (body === null || dv === null || /^0+$/.test(body)) return null;
  return `${body}-${dv.toUpperCase()}`;
}

/** The grid's `dato` rows as `{ columna, valor }` lists, with the taxpayer's own RUT and name
 *  removed by value. A row whose width differs from the others ⇒ "scraper roto"
 *  (CONVENTIONS: an HTML table parser fails loud on an unexpected cell count). */
function parseGrid(grid: Grid, propio: IdentidadPropia): CampoTercero[][] {
  const rows = Object.keys(grid.tabla)
    .sort(byNumber)
    .map((k) => grid.tabla[k])
    .filter((r): r is Row => r !== undefined);
  for (const r of rows) {
    if (r.tipoCelda !== 'cabecera' && r.tipoCelda !== 'dato') {
      throw roto(`una fila de tipo "${r.tipoCelda}"`);
    }
  }
  const datos = rows.filter((r) => r.tipoCelda === 'dato').map(cellsOf);
  const width = datos[0]?.length ?? 0;
  if (width === 0) return [];
  if (datos.some((d) => d.length !== width)) throw roto('filas de distinto ancho');
  const cols = columnas(
    rows.filter((r) => r.tipoCelda === 'cabecera'),
    width,
  );

  const ownRut = propio.rut.canonical;
  const ownBody = String(propio.rut.body);
  const ownName = propio.nombre !== null ? nameTokens(propio.nombre) : null;
  // By value, besides the label rule: the RUT exactly, the name when two of its words match
  // (an informante may drop or misspell one).
  const isOwn = (v: ValorTercero): boolean => {
    if (v === null) return false;
    const s = String(v);
    if (s === ownRut || s.replace(/\./g, '') === ownBody) return true;
    if (ownName === null || ownName.size < 2 || typeof v !== 'string') return false;
    let shared = 0;
    for (const t of nameTokens(v)) if (ownName.has(t)) shared++;
    return shared >= 2;
  };

  return datos.map((cells) =>
    cols
      .filter((c) => !OWN_IDENTITY_COLUMN.test(norm(c.path)))
      .map((c) => ({
        columna: c.path,
        valor: c.rut ? joinRut(cells.slice(c.start, c.start + 3)) : typed(cells[c.start]?.value),
      }))
      .filter((campo) => !isOwn(campo.valor)),
  );
}

// The columns every detalle carries (observed on all of them), matched on the normalized
// header path. `Tipo de Formulario` is the DJ itself, so it is dropped.
const FIJAS = {
  folio: 'folio',
  declaranteRut: 'rut declarante',
  declaranteNombre: 'nombre o razon social declarante',
  fechaPresentacion: 'fecha presentacion',
  estado: 'estado',
  origen: 'origen de la informacion',
} as const;
const OMITIDA = 'tipo de formulario';

function toFila(campos: readonly CampoTercero[]): FilaTercero {
  const fijas: Record<string, string | null> = {};
  const resto: CampoTercero[] = [];
  const keyOf = new Map<string, string>(Object.entries(FIJAS).map(([k, label]) => [label, k]));
  for (const c of campos) {
    const n = norm(c.columna);
    const key = keyOf.get(n);
    if (key !== undefined && !(key in fijas))
      fijas[key] = c.valor === null ? null : String(c.valor);
    else if (n !== OMITIDA) resto.push(c);
  }
  const get = (k: keyof typeof FIJAS): string | null => fijas[k] ?? null;
  return {
    folio: get('folio'),
    declaranteRut: get('declaranteRut'),
    declaranteNombre: get('declaranteNombre'),
    fechaPresentacion: get('fechaPresentacion'),
    estado: get('estado'),
    origen: get('origen'),
    campos: resto,
  };
}

// --- Facades -------------------------------------------------------------------------
/** `getAgenteRetenedor`: one ítem per DJ the taxpayer has information under, with the resumen
 *  grid's aggregates (informantes, montos informados). ONE call. No RUT in the body (observed):
 *  SII reads the session principal. `data: null` / `[]` ⇒ no ítems, not an error. */
export async function fetchF22TercerosResumen(
  session: PortalSession,
  params: { anio: Anio; propio: IdentidadPropia },
): Promise<DeclaracionTercero[]> {
  const env = await postSdi(
    session,
    `${BASE}/getAgenteRetenedor`,
    `${NAMESPACE}/getAgenteRetenedor`,
    { periodo: periodoOf(params.anio) },
    TERCEROS_APP,
  );
  const parsed = Resumen.safeParse(env.data);
  if (!parsed.success) throw roto('el resumen no es una lista de declaraciones');
  const out: DeclaracionTercero[] = [];
  for (const item of parsed.data ?? []) {
    for (const [dj, secciones] of Object.entries(item.listAgenteRetenedor)) {
      out.push({
        dj,
        titulo: text(item.title),
        filas: Object.values(secciones).flatMap((g) => parseGrid(g, params.propio)),
      });
    }
  }
  return out;
}

/** `getDjDetalle`: one page (10 rows) of a DJ. `seccion: "detalle"` is what makes `page`
 *  count: with `""` SII returns page 1 whatever `page` says (observed). `key: 0` and
 *  `tipoConsulta: 2` are the SPA's constants. The body RUT must be the session principal. */
export async function fetchF22TercerosDetalle(
  session: PortalSession,
  params: { rut: Rut; anio: Anio; dj: string; pagina: number; propio: IdentidadPropia },
): Promise<PaginaTerceros> {
  const env = await postSdi(
    session,
    `${BASE}/getDjDetalle`,
    `${NAMESPACE}/getDjDetalle`,
    {
      periodo: periodoOf(params.anio),
      ...rutDigits(params.rut),
      dj: Number(params.dj),
      page: params.pagina,
      key: 0,
      seccion: 'detalle',
      tipoConsulta: 2,
    },
    TERCEROS_APP,
  );
  const parsed = Detalle.safeParse(env.data);
  if (!parsed.success) throw roto('el detalle no trae `listDetalle`');
  // One ítem answered under an EMPTY section key (`listDetalle[""]`), so iterate the keys.
  const grids = Object.values(parsed.data?.listDetalle ?? {}).flatMap((s) => Object.values(s));
  const grid = grids[0];
  if (grid === undefined) return { registros: 0, filas: [] };
  if (grids.length > 1) throw roto(`el detalle trae ${grids.length} grillas`);
  return {
    registros: grid.cantRegistros ?? 0,
    filas: parseGrid(grid, params.propio).map(toFila),
  };
}
