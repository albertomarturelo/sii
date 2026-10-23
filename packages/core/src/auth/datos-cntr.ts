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
        // 2026-10-23 on an empresa: `"2026-03-26 00:00:00.0"`, `null`, `"S"`.
        fechaInicioActividades: z.string().nullish(),
        fechaTerminoGiro: z.string().nullish(),
        autorizadoDeclararDia20: z.string().nullish(),
      })
      .loose()
      .optional(),
    // The account's SII registrations (`alertas` reads the tax regime off it, #208). Observed
    // 2026-10-23: `{ atrCodigo: "14D1", descAtrCodigo: "REGIMEN PRO PYME GENERAL (14D)",
    // fechaInicio: "26-03-2026", fechaTermino: null, eliminado: null, … }`. Entries also carry
    // the own RUT and, under `NOTI`, the notification email in `valor`, so only the code and the
    // end markers are curated. `.catch(null)`: a changed shape loses the regime, never the
    // identity read the login depends on.
    atributos: z
      .array(
        z
          .object({
            atrCodigo: z.string().nullish(),
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
