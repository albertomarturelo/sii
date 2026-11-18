// Pure parser for the Mi SII landing's inline `DatosCntrNow` object (ADR-027). The HTTP
// PortalDriver cannot run page JS, so the identity read moves off `session.evaluate` to an
// extract-and-parse over the raw HTML — the object ships as an inline JS literal, which a
// plain `fetch` already receives (observed 2026-10-17; CONVENTIONS "prefer inline structured
// data over DOM scraping"). DOM-free so it is unit-testable in Node.
import { z } from 'zod';

/** The curated subset of `DatosCntrNow.contribuyente` the auth flows read (identity + email).
 *  Validated with zod at this boundary (ADR-011); unobserved fields pass through. */
const DatosCntr = z
  .object({
    contribuyente: z
      .object({
        rut: z.union([z.number(), z.string()]).optional(),
        dv: z.string().optional(),
        razonSocial: z.string().nullish(),
        nombres: z.string().nullish(),
        apellidoPaterno: z.string().nullish(),
        apellidoMaterno: z.string().nullish(),
        eMail: z.string().nullish(),
        // The F29 obligation window and deadline regime (`alertas`, ADR-030). Observed
        // 2026-10-23 on an empresa: `"2026-03-26 00:00:00.0"`, `null`, `"S"`. `.catch(null)`,
        // like `atributos`: another type on some account loses the window (unknown, never
        // "not obligated"), never the identity read the login depends on (#214).
        fechaInicioActividades: z.string().nullish().catch(null),
        fechaTerminoGiro: z.string().nullish().catch(null),
        autorizadoDeclararDia20: z.string().nullish().catch(null),
      })
      .loose()
      .optional(),
    // The account's SII registrations (`alertas` reads the tax regime off it, #208). Observed
    // 2026-10-23: `{ atrCodigo: "14D1", descAtrCodigo: "REGIMEN PRO PYME GENERAL (14D)",
    // fechaInicio: "26-03-2026", fechaTermino: null, eliminado: null, … }`. Entries also carry
    // the own RUT and, under `NOTI`, the notification email in `valor`, so only the code, its start
    // and the end markers are curated. `.catch(null)`: a changed shape loses the regime, never the
    // identity read the login depends on.
    atributos: z
      .array(
        z
          .object({
            atrCodigo: z.string().nullish(),
            fechaInicio: z.string().nullish(),
            fechaTermino: z.unknown().optional(),
            eliminado: z.unknown().optional(),
          })
          .loose(),
      )
      .nullish()
      .catch(null),
  })
  .loose();

export type DatosCntr = z.infer<typeof DatosCntr>;

const MARKER = 'DatosCntrNow';

/** Extract, parse and validate the `DatosCntrNow` object from the Mi SII HTML, or `null` when
 *  it is absent / unparseable (a dead session bounced to the login page has no such object —
 *  the caller treats `null` as "not authenticated", mirroring the old `evaluate` returning
 *  null). The object is located by its name, then the first `{` after the `=` is matched to its
 *  balanced `}` (string-aware), so trailing page script never confuses the boundary. */
export function parseDatosCntrNow(html: string): DatosCntr | null {
  const literal = extractObjectLiteral(html, MARKER);
  if (literal === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(literal);
  } catch {
    return null;
  }
  const result = DatosCntr.safeParse(parsed);
  return result.success ? result.data : null;
}

/** From the first occurrence of `<name>` followed by `=`, return the balanced `{…}` object
 *  literal that follows (string- and escape-aware), or null. Only `"`-delimited strings occur
 *  in SII's JSON-shaped literal; braces inside them are ignored. */
function extractObjectLiteral(source: string, name: string): string | null {
  const nameAt = source.indexOf(name);
  if (nameAt < 0) return null;
  const eq = source.indexOf('=', nameAt + name.length);
  if (eq < 0) return null;
  const open = source.indexOf('{', eq);
  if (open < 0) return null;

  let depth = 0;
  let inString = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\')
        i++; // skip the escaped char
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null; // unbalanced — treat as absent
}

// --- The account's tax regime (#257) ---------------------------------------------------------
// One derivation for `alertas` (its F29 window) and `whoami` (the curated `regimen`), so the two
// can never disagree. Every function here is TOTAL: an odd value reads as unknown (`null`),
// never as an error, because `whoami` is the identity read (#214).

/** The account's tax regime as SII holds it in `DatosCntrNow`. Unknown stays `null`: a consumer
 *  storing the fact must not get an assumed default (`alertas` applies its own). */
export interface RegimenTributario {
  /** `fechaInicioActividades` as YYYY-MM-DD. */
  readonly inicioActividades: string | null;
  /** `fechaTerminoGiro` as YYYY-MM-DD. */
  readonly terminoGiro: string | null;
  /** YYYY-MM: the month F29 is due every month from, i.e. the later of the inicio de actividades
   *  and the start of an observed primera-categoría regime. `null` when either is unknown or no
   *  such regime is in force. */
  readonly obligadoF29Desde: string | null;
  /** `true`: segunda categoría only (SII's `SGPE` registration says so). `false`: a
   *  primera-categoría regime is in force. `null`: neither is proven, or `atributos` was not
   *  read; an unrecognised `SGPE` text (e.g. both categories) is `null` too. */
  readonly segundaCategoria: boolean | null;
  /** The F29 due day: `autorizadoDeclararDia20` `"S"` ⇒ 20, `"N"` ⇒ 12, anything else `null`. */
  readonly diaF29: 12 | 20 | null;
}

type Atributo = NonNullable<DatosCntr['atributos']>[number];

// SII's FAQ: F29 is mandatory every month, sin movimiento included, for "todos aquellos
// contribuyentes afectos a la Ley de Impuestos a las Ventas y Servicios" from the « Inicio de
// Actividades en la primera categoría » (preguntas_frecuentes/impuestos_mensuales/
// 001_130_1051.htm and 001_130_1053.htm, updated 05/06/2025, read 2026-10-23), until the término
// de giro (001_130_2312.htm). The `atributos` codes of a primera-categoría regime, as observed:
// only exact codes, a new one joins with its citation. A persona with only honorarios has an
// inicio de actividades too but none of these (observed 2026-10-23: `NOTI`, `SGPE`).
const REGIMEN_PRIMERA_CATEGORIA = new Set([
  '14D1', // « REGIMEN PRO PYME GENERAL (14D) », observed 2026-10-23 on an empresa
]);

// Segunda categoría owes no F29 « sin movimiento » (preguntas_frecuentes/impuestos_mensuales/
// 001_130_1154.htm, read 2026-10-29); it owes the F29 of a month whose boletas carry retención del
// emisor (ayudas/nuevos_contribuyentes/boleta-honorarios.html, read 2026-10-29). SII registers the
// category in the `SGPE` atributo's `valor`, observed 2026-10-23 on a honorarios-only persona as
// « Tipo contribuyente=1 y Categoría Contribuyente = 2 » (re-observed 2026-11-18, #257). Only that
// exact category counts: « = 1 y 2 » or any other text is unknown. `valor` is read for SGPE only:
// under NOTI it is the email. SII's own `valor` carries three U+001A where the « í » goes, and two
// spaces before the « y » (observed 2026-10-29, live #245). That is in SII's body, not a decoding
// artefact: a TextDecoder never yields U+001A (an undecodable byte becomes U+FFFD, #224). So
// whatever stands for the accent is accepted; the anchor on « = 2 » keeps « = 1 y 2 » out.
const SEGUNDA_CATEGORIA = /Categor\S*a\s+Contribuyente\s*=\s*2\s*$/i;

/** YYYY-MM-DD for a real calendar date, else null. */
function fecha(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** `"2026-03-26 00:00:00.0"` (observed) ⇒ `"2026-03-26"`; anything else ⇒ null. */
function fechaContribuyente(s: string | null | undefined): string | null {
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim()) : null;
  return m ? fecha(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** An atributo's `fechaInicio`, `"26-03-2026"` (observed) ⇒ `"2026-03-26"`; else null. */
function fechaAtributo(s: unknown): string | null {
  const m = typeof s === 'string' ? /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim()) : null;
  return m ? fecha(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** An atributo still in force: no end date, not deleted. */
const activo = (a: Atributo): boolean => a.fechaTermino == null && a.eliminado == null;

const primeraCategoria = (a: Atributo): boolean =>
  REGIMEN_PRIMERA_CATEGORIA.has(a.atrCodigo?.trim() ?? '') && activo(a);

/** The later of the inicio and the start of an observed primera-categoría regime, as YYYY-MM: an
 *  account that moved from honorarios into the regime owed nothing before it (#209 review).
 *  Either one unknown ⇒ null. */
function obligadoF29Desde(inicio: string | null, atributos: readonly Atributo[]): string | null {
  if (!inicio) return null; // no lower bound: "due every month" would reach before the account
  const desde = atributos.filter(primeraCategoria).map((a) => fechaAtributo(a.fechaInicio));
  const fechas = desde.filter((f): f is string => f !== null);
  // An active regime whose start does not parse is not proof of when the obligation began.
  if (fechas.length === 0 || fechas.length < desde.length) return null;
  const regimen = fechas.reduce((a, b) => (a < b ? a : b)); // ISO dates sort as strings
  return (regimen < inicio ? inicio : regimen).slice(0, 7);
}

function segundaCategoria(atributos: readonly Atributo[] | null | undefined): boolean | null {
  if (!atributos) return null; // not read: unknown, never "no"
  if (atributos.some(primeraCategoria)) return false;
  const sgpe = atributos.some((a) => {
    const valor = a['valor'];
    return (
      a.atrCodigo?.trim() === 'SGPE' &&
      activo(a) &&
      typeof valor === 'string' &&
      SEGUNDA_CATEGORIA.test(valor)
    );
  });
  return sgpe ? true : null;
}

/** The regime, derived from the `DatosCntrNow` the caller already read: no request. */
export function regimenTributario(datos: DatosCntr | null): RegimenTributario {
  const c = datos?.contribuyente;
  const inicio = fechaContribuyente(c?.fechaInicioActividades);
  const dia = typeof c?.autorizadoDeclararDia20 === 'string' ? c.autorizadoDeclararDia20 : '';
  const flag = dia.trim().toUpperCase();
  return {
    inicioActividades: inicio,
    terminoGiro: fechaContribuyente(c?.fechaTerminoGiro),
    obligadoF29Desde: obligadoF29Desde(inicio, datos?.atributos ?? []),
    segundaCategoria: segundaCategoria(datos?.atributos),
    // `"S"` observed 2026-10-23 (empresa) and 2026-11-18 (persona, #257).
    diaF29: flag === 'S' ? 20 : flag === 'N' ? 12 : null,
  };
}
