// Inline JS maps in legacy SII CGI pages, read from the HTML text with no JS engine (ADR-027,
// amended #222). The BHE report CGIs (`loa.sii.cl/cgi_IMT/TMBCOC_*`) declare
// `xml_values = new Array()` / `arr_informe_mensual = new Array()` and then assign each key as a
// literal statement: `name['key'] = "value";`, with the row amounts wrapped as
// `formatMiles('<n>', …)`. The month's sums start at a bare `0` and each row adds its amount
// with `xml_values['suma_…'] += <n>;` (observed 2026-10-26, recibidas, an empresa session on the
// HTTP driver; docs/sii-contract/bte.md). Replaying those statements in order is what the page's
// top-level script does, so the browser is not needed.

/** One `name['key'] = <rhs>` or `+= <rhs>` statement. `=(?!=)` keeps a comparison (`== 'SI'`)
 *  out. */
const assignmentRe = (name: string): RegExp =>
  new RegExp(`\\b${name}\\s*\\[\\s*(['"])([^'"]*)\\1\\s*\\]\\s*(\\+?)=(?!=)\\s*`, 'g');

// The literal right-hand sides the page writes (observed 2026-10-26). Anything else (an
// expression such as the annual report's `Number(xml_values['…']) + …` totals) leaves the key
// absent rather than holding a guess.
const QUOTED = /^(['"])((?:\\.|(?!\1)[^\\])*)\1/;
const FORMAT_MILES = /^formatMiles\(\s*(['"])(-?\d+)\1/;
const BARE_NUMBER = /^(-?\d+(?:\.\d+)?)\s*(?:;|$|\n)/;

const unescape = (s: string): string => s.replace(/\\(.)/g, '$1');

function literalValue(rhs: string): string | undefined {
  const quoted = QUOTED.exec(rhs);
  if (quoted) return unescape(quoted[2] ?? '');
  const miles = FORMAT_MILES.exec(rhs);
  if (miles) return miles[2]; // the raw integer formatMiles would render with dots
  const bare = BARE_NUMBER.exec(rhs);
  if (bare) return bare[1];
  return undefined;
}

/** The keys a page assigns to the global map `name`, each as the string the page would hold
 *  (`formatMiles('1300000', '.')` → `"1300000"`), replayed in document order like the page's
 *  top-level script: a later assignment replaces an earlier one, and `+= <number>` adds to a
 *  numeric value. A statement this cannot evaluate (an expression, a `+=` on a non-number)
 *  removes the key, since its real value is unknown. Returns null when the page neither declares
 *  the map (`name = new Array()`) nor assigns it: a non-report page, where the browser read the
 *  variable as `undefined`. Never reads the DOM. */
export function readInlineMap(html: string, name: string): Record<string, string> | null {
  const declared = new RegExp(`\\b${name}\\s*=\\s*new\\s+Array\\s*\\(`).test(html);
  const out: Record<string, string> = {};
  let assigned = false;
  const re = assignmentRe(name);
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    assigned = true;
    const key = m[2] ?? '';
    const value = literalValue(html.slice(re.lastIndex, re.lastIndex + 2048));
    if (m[3] !== '+') {
      if (value === undefined) delete out[key];
      else out[key] = value;
      continue;
    }
    const base = out[key];
    const isNum = (s: string | undefined): s is string => s !== undefined && /^-?\d+$/.test(s);
    if (isNum(base) && isNum(value)) out[key] = String(Number(base) + Number(value));
    else delete out[key];
  }
  return declared || assigned ? out : null;
}
