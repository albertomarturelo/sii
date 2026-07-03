// In-house GWT-RPC codec for the SISPAD peticiones read (ADR-020). No third-party GWT
// library — the request template and the response object-graph reader are derived
// first-hand from the compiled permutation (strong-name A477…, module sispadinternet,
// GWT 2.0.3, observed 2026-07-03); the per-type field schema lives in `gwt-schema.ts`.
// Full wire contract: docs/sii-contract/peticiones.md.
//
// Transport shape: a `text/x-gwt-rpc` POST returns `//OK[…]` (success) or `//EX[…]`
// (a serialized business exception). The `[…]` is a JSON array laid out as
//   [ …payload ints…, [stringTable], flags, version ]
// read by DECREMENTING an index from the end (GWT emits the payload reversed). A value
// is resolved by its position's declared TYPE (schema-directed), never guessed:
//   readInt   -> one raw token
//   readLong  -> two tokens; value = a + b  (GWT splits high·2³² + low)
//   readString-> one token: >0 => stringTable[t-1], else null
//   readObject-> one token: 0 => null, <0 => back-reference, >0 => stringTable[t-1] is a
//                type signature; instantiate (adds to the seen list BEFORE its fields, so
//                cycles resolve) then run that class's field ops.
// Boxed leaves and collections resolve through the same schema (Integer="i", Timestamp=
// "li", ArrayList/Vector="L", …); object/primitive arrays are handled by the "[" prefix.
import { GWT_SCHEMA } from './gwt-schema.js';
import { PeticionesError } from '../errors/index.js';

/** A decoded GWT object-graph node. `sig` is the wire type signature; `fields` holds the
 *  ordered field values (scalars, nested nodes, or null); `items` holds collection
 *  elements (for `ArrayList`/`Vector`) or array elements. */
export interface GwtNode {
  readonly sig: string;
  readonly fields: GwtValue[];
  readonly items?: GwtValue[];
}
export type GwtValue = string | number | GwtNode | null;

// The reader builds nodes mutably (a node joins `seen` before its fields/items are read,
// so back-references resolve); callers see the readonly `GwtNode` view.
interface MutableNode {
  sig: string;
  fields: GwtValue[];
  items?: GwtValue[];
}

/** True when `v` is a decoded object node (not a scalar/null). */
export function isNode(v: GwtValue): v is GwtNode {
  return typeof v === 'object' && v !== null;
}

const isSig = (s: string): boolean => s.startsWith('[') || /\/\d+$/.test(s);
const className = (sig: string): string => sig.split('/')[0]!;

// ── Request ──────────────────────────────────────────────────────────────────
// The peticionesUsuario(Integer rut, String token) call. Only the module base, the
// serialization-policy strong-name, the rut and the (unvalidated) token vary; the rest is
// the fixed invocation encoding observed 2026-07-03. String table (7 entries, 1-based):
// [moduleBase, policyHash, service iface, method, Integer sig, String sig, token].
const SERVICE_IFACE =
  'cl.sii.sdi.difsj.sispadinternet.web.client.service.aplicacion.peticion.ServicePeticion';
const INTEGER_SIG = 'java.lang.Integer/3438268394';
const STRING_SIG = 'java.lang.String/2004016611';

/** Build the `text/x-gwt-rpc` body for `peticionesUsuario`. `rut` is the numeric body
 *  (no DV); `token` is a placeholder (the server does not validate it — auth is by the
 *  session cookie + rut, ADR-020). */
export function buildPeticionesRequest(
  moduleBase: string,
  policyHash: string,
  rut: number,
  token: string,
): string {
  return (
    `5|0|7|${moduleBase}|${policyHash}|${SERVICE_IFACE}|peticionesUsuario|` +
    `${INTEGER_SIG}|${STRING_SIG}|${token}|1|2|3|4|2|5|6|5|${rut}|7|`
  );
}

// ── Response ─────────────────────────────────────────────────────────────────
class GraphReader {
  private i: number;
  private readonly seen: MutableNode[] = [];
  constructor(
    private readonly payload: readonly number[],
    private readonly st: readonly string[],
  ) {
    this.i = payload.length - 1;
  }
  done(): boolean {
    return this.i === -1;
  }
  private tok(): number {
    if (this.i < 0) throw new PeticionesError(SCRAPER_ROTO + ' (fin de datos inesperado)');
    return this.payload[this.i--]!;
  }
  private readString(): string | null {
    const t = this.tok();
    return t > 0 ? (this.st[t - 1] ?? null) : null;
  }
  readObject(): GwtValue {
    const t = this.tok();
    if (t === 0) return null;
    if (t < 0) {
      const ref = this.seen[-t - 1];
      if (ref === undefined) throw new PeticionesError(SCRAPER_ROTO + ' (referencia inválida)');
      return ref;
    }
    const sig = this.st[t - 1];
    if (sig === undefined || !isSig(sig)) {
      throw new PeticionesError(
        SCRAPER_ROTO + ` (se esperaba un tipo, llegó "${String(sig).slice(0, 24)}")`,
      );
    }
    const node: MutableNode = { sig, fields: [] };
    this.seen.push(node);
    if (sig.startsWith('[')) {
      this.readArray(sig, node);
      return node;
    }
    const ops = GWT_SCHEMA[className(sig)];
    if (ops === undefined)
      throw new PeticionesError(SCRAPER_ROTO + ` (tipo sin esquema: ${className(sig)})`);
    this.runOps(ops, node);
    return node;
  }
  private readArray(sig: string, node: MutableNode): void {
    const el = sig[1];
    const n = this.tok();
    const items: GwtValue[] = [];
    for (let k = 0; k < n; k++) {
      if (el === 'L' || el === '[') items.push(this.readObject());
      else if (el === 'J')
        items.push(this.tok() + this.tok()); // long[]
      else items.push(this.tok()); // C/I/Z/B/S/D/F -> one raw token
    }
    node.items = items;
  }
  private runOps(ops: string, node: MutableNode): void {
    for (const op of ops) {
      switch (op) {
        case 's':
          node.fields.push(this.readString());
          break;
        case 'i':
        case 'd':
          node.fields.push(this.tok());
          break;
        case 'l':
          node.fields.push(this.tok() + this.tok());
          break;
        case 'o':
          node.fields.push(this.readObject());
          break;
        case 'L': {
          const n = this.tok();
          const items: GwtValue[] = [];
          for (let k = 0; k < n; k++) items.push(this.readObject());
          node.items = items;
          break;
        }
        case 'M': {
          const n = this.tok();
          for (let k = 0; k < n; k++) {
            this.readObject();
            this.readObject();
          }
          break;
        }
        default:
          throw new PeticionesError(SCRAPER_ROTO + ` (op desconocida ${op})`);
      }
    }
  }
}

const SCRAPER_ROTO = 'No se pudo interpretar la respuesta de SII (scraper roto)';

/** Decode a `//OK[…]` GWT-RPC response into its root object-graph node. A `//EX[…]`
 *  business error is surfaced VERBATIM as a `PeticionesError` (ADR-004); any other body
 *  (or a schema mismatch mid-decode) is a loud "scraper roto". */
export function decodeGwtResponse(text: string): GwtValue {
  const body = text.trimStart();
  if (body.startsWith('//EX')) {
    throw new PeticionesError(extractExceptionMessage(body));
  }
  if (!body.startsWith('//OK')) {
    // requestText already maps a LOGIN_HOST bounce to SessionExpiredError, so reaching
    // here with a non-OK/EX body means the wire shape changed — fail loud, never retry.
    throw new PeticionesError(SCRAPER_ROTO + ' (respuesta no es //OK)');
  }
  const arr = parseArray(body);
  const st = arr[arr.length - 3];
  if (!Array.isArray(st)) throw new PeticionesError(SCRAPER_ROTO + ' (sin tabla de strings)');
  const payload = arr.slice(0, arr.length - 3) as number[];
  const reader = new GraphReader(payload, st as string[]);
  const root = reader.readObject();
  if (!reader.done()) throw new PeticionesError(SCRAPER_ROTO + ' (datos sobrantes)');
  return root;
}

/** True when the server rejected the serialization-policy hash — the trigger to
 *  re-source the hash and retry (self-heal, ADR-020). GWT answers a bad/blocked policy
 *  with an IncompatibleRemoteServiceException `//EX`. */
export function isPolicyError(e: unknown): boolean {
  return (
    e instanceof PeticionesError &&
    /IncompatibleRemoteService|policy|blocked|no est[aá] incluid/i.test(e.message)
  );
}

function parseArray(body: string): unknown[] {
  const json = body.slice(body.indexOf('[')); // drop the `//OK` / `//EX` prefix
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) throw new Error('not an array');
    return v;
  } catch {
    throw new PeticionesError(SCRAPER_ROTO + ' (JSON inválido)');
  }
}

// The `//EX` graph is a serialized Throwable; its human message is the string-table
// entry that is neither a type signature nor an empty string. Join the plausible message
// strings so SII's wording reaches the user verbatim (ADR-004).
function extractExceptionMessage(body: string): string {
  try {
    const arr = parseArray(body);
    const st = arr[arr.length - 3];
    if (Array.isArray(st)) {
      const msgs = (st as unknown[]).filter(
        (s): s is string => typeof s === 'string' && s.length > 0 && !isSig(s) && /\s/.test(s),
      );
      if (msgs.length) return `SII rechazó la consulta de peticiones: ${msgs.join(' | ')}`;
    }
  } catch {
    /* fall through */
  }
  return 'SII rechazó la consulta de peticiones (error de servicio).';
}
