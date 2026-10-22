// In-house GWT-RPC codecs (ADR-020). Protocol 5 below serves the SISPAD peticiones read;
// protocol 7 at the end of the file serves rfiInternet, the F29 submit transport (ADR-029
// amendment). No third-party GWT library — the request template and the response object-graph reader are derived
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
import type { PortalSession } from '../seams/index.js';

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

// ── Protocol 7 (rfiInternet) ─────────────────────────────────────────────────
// Observed 2026-10-19 on www4.sii.cl/rfiInternet (permutation 543D42AD…, spike #138; wire
// contract: sii-contract/f29.md § Submit). Unlike SISPAD's protocol 5 above, rfiInternet speaks
// protocol 7, and the F29 submit has to WRITE object graphs, not only read them:
//   request  = 7|0|N|<N escaped strings>|<payload, forward>|
//              payload = moduleBase, policy, service, method (string refs), param count,
//                        param type signatures (string refs), param values
//   response = //OK[<payload, read backwards>, [strings], flags, 7] — a JS literal, not JSON:
//              a long string arrives split as "…"+"…", a long array as […].concat([…],…)
// Every value is schema-directed by CLASS NAME (`rfi-schema.ts`, derived from the permutation).
// A node carries its class name only: the signature's CRC rotates on SII recompile, so the
// encoder resolves it from the live permutation (`loadGwtPermutation`), never from a constant.
// Leaves: int/short/boolean are numbers (a boolean is 1/0, as observed), a double a number, a
// long GWT's base64 token kept verbatim, a string a string or null.

/** A protocol-7 object: its class name and its values in the class's layout order. For a Java
 *  array (`[L…;`, `[I`) `values` holds the elements. Mutable on purpose: the submit edits a
 *  validated `Borrador` before sending it back (ADR-029 amendment). */
export interface Gwt7Node {
  readonly cls: string;
  values: Gwt7Value[];
}
/** A value in a protocol-7 graph. A collection (`L`) is an array of values, a map (`M`) an array
 *  of `[key, value]` pairs; the class layout says which. */
export type Gwt7Value = null | string | number | Gwt7Node | Gwt7Value[];

/** One parameter of a call: its DECLARED type (a class name, or a primitive code `I`/`Z`/`J`…)
 *  and its value. A `java.lang.String` parameter is a bare string; anything else declared by
 *  class is an object node. */
export interface Gwt7Param {
  readonly type: string;
  readonly value: Gwt7Value;
}
export interface Gwt7Call {
  readonly moduleBase: string;
  /** The service's serialization-policy strong-name, from the permutation. */
  readonly policy: string;
  /** The service interface, e.g. `cl.sii.sdi.dim.rfi.web.client.service.FormularioFacade`. */
  readonly service: string;
  readonly method: string;
  readonly params: readonly Gwt7Param[];
}
/** Field layouts by class name, one op char per stream op (see `rfi-schema.ts`). */
export interface Gwt7Layouts {
  readonly write: Readonly<Record<string, string>>;
  readonly read: Readonly<Record<string, string>>;
}

const STRING_CLASS = 'java.lang.String';
// A primitive parameter or array element, by its JVM code.
const PRIMITIVE_OP: Readonly<Record<string, string>> = {
  I: 'i',
  Z: 'z',
  S: 'h',
  B: 'i',
  C: 'i',
  J: 'l',
  D: 'd',
  F: 'd',
};
const gwtClass = (sig: string): string => sig.split('/')[0]!;
// A Java array's element op. A `String[]` element is a bare string reference, not a String
// object (observed in SdiAAInfoUsuario's response, 2026-10-19); other `[L…;` / `[[…` elements are
// objects; a primitive array's elements are leaves.
const arrayElementOp = (cls: string): string | undefined =>
  cls === '[Ljava.lang.String;'
    ? 's'
    : cls[1] === 'L' || cls[1] === '['
      ? 'o'
      : PRIMITIVE_OP[cls[1]!];
const GWT7_ROTO = 'No se pudo interpretar el formulario de SII (scraper roto)';

// The boxes GWT's JRE caches in `valueOf`, with the range it caches (GWT 2.x `Boolean`,
// `Byte`, `Short`, `Integer`, `Character` emulation). `Long` is left out: its value travels as
// a base64 token and no shared Long has been observed.
const BOX_CACHE: Readonly<Record<string, (n: number) => boolean>> = {
  'java.lang.Boolean': () => true,
  'java.lang.Byte': () => true,
  'java.lang.Short': (n) => n >= -128 && n <= 127,
  'java.lang.Integer': (n) => n >= -128 && n <= 127,
  'java.lang.Character': (n) => n >= 0 && n <= 127,
};
/** The identity key of a box the client's `valueOf` would share, or null. */
function cachedBoxKey(v: Gwt7Node): string | null {
  const cached = BOX_CACHE[v.cls];
  const n = v.values[0];
  if (cached === undefined || v.values.length !== 1 || typeof n !== 'number') return null;
  return cached(n) ? `${v.cls}:${n}` : null;
}

/** The protocol-7 codec over one set of layouts and one permutation's signatures. `fail` builds
 *  the error the caller's surface raises (the F29 facade passes `F29Error`). */
export class Gwt7Codec {
  constructor(
    private readonly layouts: Gwt7Layouts,
    private readonly sigs: Readonly<Record<string, string>>,
    private readonly fail: (message: string) => Error,
  ) {}

  /** Build the `text/x-gwt-rpc` body for `call`. A class missing from the layouts or the
   *  permutation, or a value that does not fit its layout, throws: nothing is guessed. */
  encodeRequest(call: Gwt7Call): string {
    const table: string[] = [];
    const index = new Map<string, number>();
    const out: string[] = [];
    const seen = new Map<Gwt7Node, number>();
    // In the client, a JS string IS its value, so GWT's identity map treats two String objects
    // with the same text as one object and writes the second as a back-reference (observed:
    // the browser's validation request shares them; without this the layout re-encodes ~11 KB
    // larger). Other objects keep reference identity.
    const seenStrings = new Map<string, number>();
    // The client's JRE boxes through `valueOf`, which hands out ONE instance per value for
    // Boolean, and for Byte / Short / Integer / Character inside its cache (-128..127; 0..127
    // for Character). The deserializers use `valueOf` too, so two equal small boxes the browser
    // re-sends are one object, written once and then back-referenced. Observed (#161): the
    // browser's `findVersionBorradorById` shares one Integer between the Formulario and the
    // contribuyente, and one Boolean across the Formulario's flags; without this the request
    // has the same values but different bytes.
    const seenBoxes = new Map<string, number>();
    let count = 0;
    const ref = (s: string | null): string => {
      if (s === null) return '0';
      let i = index.get(s);
      if (i === undefined) {
        table.push(s);
        i = table.length;
        index.set(s, i);
      }
      return String(i);
    };
    const where = (cls: string, k: number): string => `${cls}[${k}]`;
    const leaf = (op: string, v: Gwt7Value, at: string): void => {
      if (op === 's') {
        if (v !== null && typeof v !== 'string') throw this.err(`${at} debe ser string`);
        out.push(ref(v));
      } else if (op === 'l') {
        if (typeof v !== 'string') throw this.err(`${at} debe ser long (token base64)`);
        out.push(v);
      } else if (op === 'i' || op === 'z' || op === 'h' || op === 'd') {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw this.err(`${at} debe ser número`);
        out.push(String(v));
      } else throw this.err(`op desconocida ${op}`);
    };
    const object = (v: Gwt7Value, at: string): void => {
      if (v === null) {
        out.push('0');
        return;
      }
      if (typeof v !== 'object' || Array.isArray(v)) throw this.err(`${at} debe ser objeto`);
      const text = v.cls === STRING_CLASS && typeof v.values[0] === 'string' ? v.values[0] : null;
      const box = cachedBoxKey(v);
      const back =
        text !== null ? seenStrings.get(text) : box !== null ? seenBoxes.get(box) : seen.get(v);
      if (back !== undefined) {
        out.push(String(-(back + 1)));
        return;
      }
      if (text !== null) seenStrings.set(text, count);
      if (box !== null) seenBoxes.set(box, count);
      seen.set(v, count++);
      out.push(ref(this.sig(v.cls)));
      if (v.cls.startsWith('[')) {
        out.push(String(v.values.length));
        const op = arrayElementOp(v.cls);
        if (op === undefined) throw this.err(`arreglo desconocido ${v.cls}`);
        v.values.forEach((x, k) =>
          op === 'o' ? object(x, where(v.cls, k)) : leaf(op, x, where(v.cls, k)),
        );
        return;
      }
      const ops = this.layout('write', v.cls);
      if (v.values.length !== ops.length) {
        throw this.err(`${v.cls} tiene ${v.values.length} valores; su esquema, ${ops.length}`);
      }
      [...ops].forEach((op, k) => {
        const x = v.values[k]!;
        const at = where(v.cls, k);
        if (op === 'o') object(x, at);
        else if (op === 'L') {
          const list = this.list(x, at);
          out.push(String(list.length));
          list.forEach((item, j) => object(item, `${at}[${j}]`));
        } else if (op === 'M') {
          const entries = this.list(x, at);
          out.push(String(entries.length));
          entries.forEach((e, j) => {
            const pair = this.list(e, `${at}{${j}}`);
            if (pair.length !== 2) throw this.err(`${at}{${j}} debe ser [clave, valor]`);
            object(pair[0]!, `${at}{${j}}.k`);
            object(pair[1]!, `${at}{${j}}.v`);
          });
        } else leaf(op, x, at);
      });
    };

    for (const s of [call.moduleBase, call.policy, call.service, call.method]) out.push(ref(s));
    out.push(String(call.params.length));
    for (const p of call.params) out.push(ref(PRIMITIVE_OP[p.type] ? p.type : this.sig(p.type)));
    call.params.forEach((p, k) => {
      const at = `${call.method}#${k}`;
      const prim = PRIMITIVE_OP[p.type];
      if (prim) leaf(prim, p.value, at);
      else if (p.type === STRING_CLASS) leaf('s', p.value, at);
      else object(p.value, at);
    });
    return ['7', '0', String(table.length), ...table.map(escapeGwt7), ...out].join('|') + '|';
  }

  /** Parse a protocol-7 request body back into a call (class names, no CRCs). The inverse of
   *  `encodeRequest`; used to verify the encoder, and to read a captured call. */
  decodeRequest(text: string): Gwt7Call {
    const tok = splitGwt7Tokens(text);
    if (tok[0] !== '7') throw this.err(`protocolo ${String(tok[0])}, se esperaba 7`);
    const n = Number(tok[2]);
    const strings = tok.slice(3, 3 + n);
    let p = 3 + n;
    const seen: Gwt7Node[] = [];
    const next = (): string => {
      if (p >= tok.length) throw this.err('fin de datos inesperado');
      return tok[p++]!;
    };
    const int = (): number => {
      const t = next();
      if (!/^-?\d+$/.test(t)) throw this.err(`se esperaba un entero, llegó "${t.slice(0, 12)}"`);
      return Number(t);
    };
    const str = (): string | null => {
      const t = int();
      if (t === 0) return null;
      const s = strings[t - 1];
      if (s === undefined) throw this.err('referencia de string inválida');
      return s;
    };
    const leaf = (op: string): Gwt7Value => {
      if (op === 's') return str();
      if (op === 'l') return next();
      if (op === 'd') {
        const d = Number(next());
        if (!Number.isFinite(d)) throw this.err('se esperaba un double');
        return d;
      }
      return int();
    };
    const object = (): Gwt7Value => {
      const t = int();
      if (t === 0) return null;
      if (t < 0) {
        const back = seen[-t - 1];
        if (back === undefined) throw this.err('referencia inválida');
        return back;
      }
      const sig = strings[t - 1];
      if (sig === undefined || !isSig(sig)) throw this.err('se esperaba una firma de tipo');
      const node: Gwt7Node = { cls: gwtClass(sig), values: [] };
      seen.push(node);
      this.readInto(node, 'write', object, leaf, int);
      return node;
    };
    const head = [str(), str(), str(), str()];
    if (head.some((h) => h === null)) throw this.err('cabecera incompleta');
    const types: string[] = [];
    const count = int();
    for (let k = 0; k < count; k++) {
      const t = str();
      if (t === null) throw this.err('tipo de parámetro nulo');
      types.push(PRIMITIVE_OP[t] ? t : gwtClass(t));
    }
    const params = types.map((type): Gwt7Param => {
      const prim = PRIMITIVE_OP[type];
      return { type, value: prim ? leaf(prim) : type === STRING_CLASS ? str() : object() };
    });
    if (p !== tok.length) throw this.err(`datos sobrantes (${tok.length - p})`);
    const [moduleBase, policy, service, method] = head as [string, string, string, string];
    return { moduleBase, policy, service, method, params };
  }

  /** Decode a `//OK[…]` response into its root value, with the READ layouts. `returns` is the
   *  method's DECLARED return type: GWT writes a `java.lang.String` or primitive return bare
   *  (`//OK[1,["…"],0,7]`), a `void` (`V`) as nothing (`//OK[[],0,7]`), anything else as an
   *  object. A `//EX[…]` is SII refusing the call: its
   *  message is raised verbatim (ADR-004). Anything else is "scraper roto"; never retried. */
  decodeResponse(text: string, returns?: string): Gwt7Value {
    const body = text.trimStart();
    if (body.startsWith('//EX')) throw this.fail(gwt7ExceptionMessage(body));
    if (!body.startsWith('//OK')) throw this.err('la respuesta no es //OK');
    const { payload, strings } = this.envelope(body);
    let p = payload.length - 1;
    const seen: Gwt7Node[] = [];
    const tok = (): number | string => {
      if (p < 0) throw this.err('fin de datos inesperado');
      return payload[p--]!;
    };
    const int = (): number => {
      const t = tok();
      if (typeof t !== 'number') throw this.err('se esperaba un número');
      return t;
    };
    const leaf = (op: string): Gwt7Value => {
      if (op === 's') {
        const t = int();
        return t > 0 ? (strings[t - 1] ?? null) : null;
      }
      if (op === 'l') {
        const t = tok();
        if (typeof t !== 'string') throw this.err('se esperaba un long');
        return t;
      }
      return int();
    };
    const object = (): Gwt7Value => {
      const t = int();
      if (t === 0) return null;
      if (t < 0) {
        const back = seen[-t - 1];
        if (back === undefined) throw this.err('referencia inválida');
        return back;
      }
      const sig = strings[t - 1];
      if (sig === undefined || !isSig(sig)) throw this.err('se esperaba una firma de tipo');
      const node: Gwt7Node = { cls: gwtClass(sig), values: [] };
      seen.push(node);
      this.readInto(node, 'read', object, leaf, int);
      return node;
    };
    const prim = returns === undefined ? undefined : PRIMITIVE_OP[returns];
    const root =
      returns === 'V' ? null : prim ? leaf(prim) : returns === STRING_CLASS ? leaf('s') : object();
    if (p !== -1) throw this.err('datos sobrantes');
    return root;
  }

  // Shared by both readers: fill `node` per its class (array, or layout ops).
  private readInto(
    node: Gwt7Node,
    side: 'write' | 'read',
    object: () => Gwt7Value,
    leaf: (op: string) => Gwt7Value,
    int: () => number,
  ): void {
    if (node.cls.startsWith('[')) {
      const n = int();
      const op = arrayElementOp(node.cls);
      if (op === undefined) throw this.err(`arreglo desconocido ${node.cls}`);
      for (let k = 0; k < n; k++) node.values.push(op === 'o' ? object() : leaf(op));
      return;
    }
    for (const op of this.layout(side, node.cls)) {
      if (op === 'o') node.values.push(object());
      else if (op === 'L') {
        const n = int();
        const list: Gwt7Value[] = [];
        for (let k = 0; k < n; k++) list.push(object());
        node.values.push(list);
      } else if (op === 'M') {
        const n = int();
        const entries: Gwt7Value[] = [];
        for (let k = 0; k < n; k++) entries.push([object(), object()]);
        node.values.push(entries);
      } else node.values.push(leaf(op));
    }
  }

  private envelope(body: string): { payload: (number | string)[]; strings: string[] } {
    let arr: unknown;
    try {
      arr = parseJsLiteral(body.slice(4));
    } catch {
      throw this.err('literal inválido');
    }
    if (!Array.isArray(arr) || arr.length < 3 || arr[arr.length - 1] !== 7) {
      throw this.err('sobre de respuesta inesperado');
    }
    const strings = arr[arr.length - 3] as unknown;
    if (!Array.isArray(strings) || strings.some((s) => typeof s !== 'string')) {
      throw this.err('sin tabla de strings');
    }
    const payload = arr.slice(0, arr.length - 3) as unknown[];
    if (payload.some((t) => typeof t !== 'number' && typeof t !== 'string')) {
      throw this.err('datos con forma inesperada');
    }
    return { payload: payload as (number | string)[], strings: strings as string[] };
  }

  private layout(side: 'write' | 'read', cls: string): string {
    const ops = this.layouts[side][cls];
    if (ops === undefined) throw this.err(`tipo sin esquema: ${cls}`);
    return ops;
  }
  private sig(cls: string): string {
    const sig = this.sigs[cls];
    if (sig === undefined) throw this.err(`tipo sin firma en la permutación: ${cls}`);
    return sig;
  }
  private list(v: Gwt7Value, at: string): Gwt7Value[] {
    if (!Array.isArray(v)) throw this.err(`${at} debe ser una lista`);
    return v;
  }
  private err(detail: string): Error {
    return this.fail(`${GWT7_ROTO} (${detail})`);
  }
}

// The client's string escaping, observed in the permutation (the writer's quoting fns): NUL,
// '|' and '\' always, plus a user-agent-dependent set of ranges written as \uXXXX. The WebKit
// set reproduces the captured Chromium requests byte for byte; the server reads any \uXXXX.
const GWT7_ESCAPE =
  /[\u0000|\\\u0300-\u03ff\u0590-\u05FF\u0600-\u06ff\u0730-\u074A\u07eb-\u07f3\u0940-\u0963\u0980-\u09ff\u0a00-\u0a7f\u0b00-\u0b7f\u0e00-\u0e7f\u0f00-\u0fff\u1900-\u194f\u1a00-\u1a1f\u1b00-\u1b7f\u1cda-\u1cdc\u1dc0-\u1dff\u1f00-\u1fff\u2000-\u206f\u20d0-\u20ff\u2100-\u214f\u2300-\u23ff\u2a00-\u2aff\u3000-\u303f\uaab2-\uaab4\uD800-\uFFFF]/g;

function escapeGwt7(s: string): string {
  return s.replace(GWT7_ESCAPE, (ch) => {
    const c = ch.charCodeAt(0);
    if (c === 0) return '\\0';
    if (c === 0x5c) return '\\\\';
    if (c === 0x7c) return '\\!';
    return '\\u' + c.toString(16).padStart(4, '0');
  });
}

function splitGwt7Tokens(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\') {
      const n = text[++i];
      if (n === 'u') {
        cur += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16));
        i += 4;
      } else cur += n === '!' ? '|' : n === '0' ? '\u0000' : (n ?? '');
    } else if (ch === '|') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** Parse the JS literal of a protocol-7 response: arrays, numbers, '…' / "…" strings (with
 *  \xNN, \uNNNN and the usual escapes), plus GWT's two splits for large payloads: "…"+"…" and
 *  […].concat([…],…). Exported for tests. */
export function parseJsLiteral(src: string): unknown {
  let i = 0;
  const ws = (): void => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };
  const fail = (what: string): never => {
    throw new Error(`${what} at ${i}`);
  };
  const ESC: Readonly<Record<string, string>> = {
    n: '\n',
    t: '\t',
    r: '\r',
    b: '\b',
    f: '\f',
    v: '\v',
    '0': '\0',
  };
  const string = (): string => {
    const q = src[i++]!;
    let s = '';
    while (src[i] !== q) {
      if (i >= src.length) fail('unterminated string');
      if (src[i] === '\\') {
        const n = src[i + 1]!;
        if (n === 'x') {
          s += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16));
          i += 4;
        } else if (n === 'u') {
          s += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
          i += 6;
        } else {
          s += ESC[n] ?? n;
          i += 2;
        }
      } else s += src[i++];
    }
    i++;
    ws();
    if (src[i] === '+') {
      i++;
      ws();
      if (src[i] !== '"' && src[i] !== "'") fail('bad string concatenation');
      return s + string();
    }
    return s;
  };
  const value = (): unknown => {
    ws();
    const ch = src[i];
    if (ch === '[') {
      i++;
      let arr: unknown[] = [];
      ws();
      if (src[i] === ']') i++;
      else {
        for (;;) {
          arr.push(value());
          ws();
          if (src[i] === ',') i++;
          else if (src[i] === ']') {
            i++;
            break;
          } else fail('bad array');
        }
      }
      ws();
      while (src.startsWith('.concat(', i)) {
        i += 8;
        for (;;) {
          const part = value();
          if (!Array.isArray(part)) fail('concat of a non-array');
          arr = arr.concat(part as unknown[]);
          ws();
          if (src[i] === ',') i++;
          else if (src[i] === ')') {
            i++;
            break;
          } else fail('bad concat');
        }
        ws();
      }
      return arr;
    }
    if (ch === '"' || ch === "'") return string();
    const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 40));
    if (!m) return fail('bad token');
    i += m[0].length;
    return Number(m[0]);
  };
  const v = value();
  ws();
  if (i !== src.length) fail('trailing data');
  return v;
}

// A protocol-7 `//EX` carries a serialized exception: its human message is in the string table,
// among the entries that are not type signatures. Joined verbatim (ADR-004).
function gwt7ExceptionMessage(body: string): string {
  try {
    const arr = parseJsLiteral(body.slice(4));
    const st = Array.isArray(arr) ? (arr[arr.length - 3] as unknown) : undefined;
    if (Array.isArray(st)) {
      const msgs = st.filter(
        (s): s is string => typeof s === 'string' && s.length > 0 && !isSig(s) && /\s/.test(s),
      );
      if (msgs.length) return `SII rechazó la operación: ${msgs.join(' | ')}`;
    }
  } catch {
    /* fall through */
  }
  return 'SII rechazó la operación (error de servicio).';
}

/** True when a protocol-7 response is GWT refusing the request's serialization policy or a
 *  type signature: the trigger to re-read the permutation once (self-heal, ADR-020). The server
 *  refuses before invoking the method, so nothing ran. */
export function isGwt7PolicyError(text: string): boolean {
  const body = text.trimStart();
  return (
    body.startsWith('//EX') &&
    body.includes('com.google.gwt.user.client.rpc.IncompatibleRemoteServiceException')
  );
}

// ── Permutation (policy hashes + signatures), read at runtime ──────────────────
/** What the core reads from a live permutation: its strong-name (the `X-GWT-Permutation`
 *  header), each service's serialization-policy strong-name, and every type signature. */
export interface GwtPermutation {
  readonly strongName: string;
  /** Service entry point (e.g. `formularioFacade`) → policy strong-name. */
  readonly policies: Readonly<Record<string, string>>;
  /** Class name → full type signature (with the CRC this deploy uses). */
  readonly sigs: Readonly<Record<string, string>>;
}

// Each service proxy is built as `X.call(this, <moduleBase fn>(), '<entryPoint>', '<policy>', …)`
// and every type signature is a `<var>='<class>/<crc>'` constant (observed in 543D42AD…,
// 2026-10-19). Reading both from the JS needs no knowledge of the obfuscated names.
const PROXY_RE = /\.call\(this,[\w$]+\(\),'([\w$]+)','([0-9A-F]{32})'/g;
const SIG_RE = /[\w$]+='([a-zA-Z[][\w.$;[]*\/\d+)'/g;

/** Extract the policy strong-names and the type signatures from a permutation's JS. */
export function parseGwtPermutation(strongName: string, js: string): GwtPermutation {
  const policies: Record<string, string> = {};
  for (const m of js.matchAll(PROXY_RE)) policies[m[1]!] ??= m[2]!;
  const sigs: Record<string, string> = {};
  for (const m of js.matchAll(SIG_RE)) sigs[gwtClass(m[1]!)] ??= m[1]!;
  return { strongName, policies, sigs };
}

/** Where a GWT module lives and which service a caller talks to. */
export interface GwtModuleRef {
  /** e.g. `https://www4.sii.cl/rfiInternet/` (trailing slash, as GWT sends it). */
  readonly moduleBase: string;
  /** The bootstrap that lists the permutations, e.g. `rfi.nocache.js`. */
  readonly nocache: string;
  /** The service entry point, e.g. `formularioFacade`. */
  readonly entryPoint: string;
}

const HEX32 = /\b[0-9A-F]{32}\b/g;
// Process-wide, like the peticiones hash: the permutation belongs to SII's deploy, not to a user.
const permutations = new Map<string, GwtPermutation>();

/** The module's permutation, from the cache or fetched (nocache.js → each listed permutation's
 *  `.cache.html`, the first that declares `ref.entryPoint`). Both are authenticated GETs.
 *  `refresh` bypasses the cache: the self-heal after a policy refusal. */
export async function loadGwtPermutation(
  session: PortalSession,
  ref: GwtModuleRef,
  fail: (message: string) => Error,
  refresh = false,
): Promise<GwtPermutation> {
  const key = `${ref.moduleBase}|${ref.entryPoint}`;
  const cached = permutations.get(key);
  if (cached && !refresh) return cached;
  const nocache = await session.requestText(`${ref.moduleBase}${ref.nocache}`, { method: 'GET' });
  for (const name of new Set(nocache.body.match(HEX32) ?? [])) {
    const js = await session.requestText(`${ref.moduleBase}${name}.cache.html`, { method: 'GET' });
    const perm = parseGwtPermutation(name, js.body);
    if (perm.policies[ref.entryPoint]) {
      permutations.set(key, perm);
      return perm;
    }
  }
  throw fail(
    `No se encontró la política de serialización de ${ref.entryPoint} en el JS de SII (scraper roto).`,
  );
}

/** Forget every cached permutation (tests). */
export function clearGwtPermutations(): void {
  permutations.clear();
}

/** POST one protocol-7 call and return the raw response text (the caller decodes it). `build`
 *  gets the permutation, so the policy and the signatures always come from the same deploy. On
 *  a policy/signature refusal the permutation is re-read ONCE and the call rebuilt and resent;
 *  `heal: false` turns that off. */
export async function postGwt7(
  session: PortalSession,
  ref: GwtModuleRef,
  build: (perm: GwtPermutation) => string,
  fail: (message: string) => Error,
  opts: { heal?: boolean } = {},
): Promise<string> {
  const send = async (perm: GwtPermutation): Promise<string> => {
    const resp = await session.requestText(`${ref.moduleBase}${ref.entryPoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/x-gwt-rpc; charset=utf-8',
        'X-GWT-Module-Base': ref.moduleBase,
        'X-GWT-Permutation': perm.strongName,
      },
      body: build(perm),
    });
    return resp.body;
  };
  const text = await send(await loadGwtPermutation(session, ref, fail));
  if (opts.heal === false || !isGwt7PolicyError(text)) return text;
  const healed = await send(await loadGwtPermutation(session, ref, fail, true));
  // Still refused with a fresh permutation: our layouts or the extraction are stale, not SII's
  // deploy — a broken scraper, never a business message to pass on.
  if (isGwt7PolicyError(healed)) {
    throw fail(
      `No se pudo usar la política de serialización de ${ref.entryPoint} tras releer la permutación de SII (scraper roto).`,
    );
  }
  return healed;
}
