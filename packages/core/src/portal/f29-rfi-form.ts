// The F29 form interpreter: fills a decoded rfiInternet layout the way SII's own client does
// before validation (ADR-029 amendment, #160). Without it SII validated a borrador missing the
// remanente (77) and the total de créditos (537) as "sin errores".
//
// Everything here is read first-hand from the client's compiled code, permutation
// 543D42AD0EF9E262804F560CE81AF5A6, observed 2026-10-19 (ADR-004). No tax logic is written by
// hand: the formulas are SII's, shipped as data in the layout (`CampoMetadata.n`, an `Expresion`
// AST), and this module only evaluates them.
//   - the evaluator is the client fn `PG(expr, formulario, seccion)`;
//   - a campo with a formula always reads as its formula's result (`rC`), formatted by its type
//     (`jC` → `tJ` ENTERO*, `sJ` DECIMAL*), so a stale stored value never survives;
//   - numbers go through SII's own decimal class (`rK`/`sK`), whose quirks are kept: a result
//     always prints at least one decimal ("5.0"), rounding is half-up on the magnitude, and a
//     division keeps 2 decimals;
//   - the propuesta screen (`QRb`, mode PPTA-F29-COMPLETA) sets the 773 and 778 checkboxes to
//     FALSE when the layout shows them;
//   - a rule (`Regla`) fails when its expression is not TRUE, except kind 1 (`GC`).
// An operator, campo type or shape this module does not know throws "scraper roto"; nothing
// falls back to a silent 0.
import { F29Error } from '../errors/index.js';
import type { Gwt7Node, Gwt7Value } from './gwt.js';

const ROTO = 'No se pudo interpretar el formulario F29 de SII (scraper roto)';
const roto = (detail: string): F29Error => new F29Error(`${ROTO}: ${detail}`);

// ── SII's decimal (rK/sK) ────────────────────────────────────────────────────
/** A number as SII's client holds it: a sign (kept even on zero, as SII does), the magnitude's
 *  digits as an integer, and the count of decimal digits. */
interface SiiNumber {
  readonly neg: boolean;
  readonly units: bigint;
  readonly scale: number;
}

/** Parse like SII's `jK`: an optional sign, digits, at most one '.'. A bare integer gets one
 *  decimal ("5" → 5.0). Anything else is a value the formula cannot compute with. */
export function parseSiiNumber(text: string): SiiNumber {
  if (text.length === 0) throw roto('número vacío');
  let s = text;
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^(\d*)(\.(\d*))?$/.test(s) || s === '' || s === '.')
    throw roto(`número inválido "${text.slice(0, 20)}"`);
  const [int = '', frac = ''] = s.split('.');
  const f = frac === '' ? '0' : frac;
  return { neg, units: BigInt((int === '' ? '0' : int) + f), scale: f.length };
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);
const rescale = (x: SiiNumber, scale: number): bigint => x.units * pow10(scale - x.scale);
const signed = (x: SiiNumber): bigint => (x.neg ? -x.units : x.units);
const fromSigned = (v: bigint, scale: number): SiiNumber => ({
  neg: v < 0n,
  units: v < 0n ? -v : v,
  scale,
});

function add(a: SiiNumber, b: SiiNumber): SiiNumber {
  const scale = Math.max(a.scale, b.scale);
  return fromSigned(
    signed({ ...a, units: rescale(a, scale), scale }) +
      signed({ ...b, units: rescale(b, scale), scale }),
    scale,
  );
}
function subtract(a: SiiNumber, b: SiiNumber): SiiNumber {
  return add(a, { ...b, neg: !b.neg });
}
function multiply(a: SiiNumber, b: SiiNumber): SiiNumber {
  const v = a.units * b.units;
  // SII multiplies magnitudes and multiplies the signs, so a zero can come out negative.
  return { neg: a.neg !== b.neg, units: v, scale: a.scale + b.scale };
}
/** `eK(a, b, 2)`: half-up on the magnitude to 2 decimals. A zero dividend is returned as is. */
function divide(a: SiiNumber, b: SiiNumber, decimals = 2): SiiNumber {
  if (a.units === 0n) return a;
  if (b.units === 0n) throw roto('división por cero');
  const num = a.units * pow10(b.scale + decimals);
  const den = b.units * pow10(a.scale);
  const q = num / den;
  const units = (num % den) * 2n >= den ? q + 1n : q;
  return { neg: a.neg !== b.neg, units, scale: decimals };
}
/** `hK`: the sign first (a negative zero sorts below zero, as in SII), then the magnitude. */
function compare(a: SiiNumber, b: SiiNumber): number {
  if (a.neg !== b.neg) return a.neg ? -1 : 1;
  const scale = Math.max(a.scale, b.scale);
  const d = rescale(a, scale) - rescale(b, scale);
  const m = d === 0n ? 0 : d > 0n ? 1 : -1;
  return a.neg ? -m : m;
}
/** `lK(x, n)`: half-up on the magnitude to `n` decimals; fewer decimals are left as they are. */
function setScale(x: SiiNumber, n: number): SiiNumber {
  if (x.scale <= n) return x;
  const den = pow10(x.scale - n);
  const q = x.units / den;
  return { ...x, units: (x.units % den) * 2n >= den ? q + 1n : q, scale: n };
}
function digits(x: SiiNumber): { int: string; frac: string } {
  const s = x.units.toString().padStart(x.scale + 1, '0');
  return { int: s.slice(0, s.length - x.scale), frac: s.slice(s.length - x.scale) };
}
/** `pK`: SII's string form. The trailing zeros of the decimals go, but one decimal always
 *  stays ("5.0", "12.5"); the sign stays even on zero. */
export function formatSiiNumber(x: SiiNumber): string {
  const { int, frac } = digits(x);
  const f = frac.replace(/0+$/, '');
  return `${x.neg ? '-' : ''}${int}.${f === '' ? '0' : f}`;
}

// ── Layout access (positions read from the deserializers, 2026-10-19) ──────────
// CampoMetadata: f=4 código, n=9 formula, p=11 key, r=13 max length, v=17 decimals, x=19 type,
// B=23 ("0" keeps a computed zero visible).
const MD = {
  codigo: 4,
  formula: 9,
  key: 11,
  maxLen: 13,
  decimales: 17,
  tipo: 19,
  ceroVisible: 23,
} as const;
// Campo: d=0 metadata, g=2 stored value. Expresion: c=1 operator/name, d=2 left, e=3 right,
// f=4 type. Regla: b=0 expression, c=1 name, d=2 groups, e=3 message, f=4 kind.
// Formulario: d=2 campos by key, v=17 metadata, A=21 parameter maps, K=31 multivalued sections.
// FormularioMetadata: g=5 rules by name. layout.Cell: id at 6.
const CAMPO = { meta: 0, value: 2 } as const;
const EXPR = { op: 1, left: 2, right: 3, type: 4 } as const;
const REGLA = { expr: 0, nombre: 1, grupos: 2, mensaje: 3, tipo: 4 } as const;
const FORM = { campos: 2, meta: 17, params: 21, multivalor: 31 } as const;
const FORM_META_RULES = 5;
// layout.Cell: e=3 bound reference, f=4 widget, i=6 id, j=7 visible, n=9 css class, o=10 width.
const CELL = { ref: 3, widget: 4, id: 6, visible: 7, css: 9, width: 10 } as const;

const CLS = {
  formulario: 'cl.sii.sdi.difm.rcs.web.client.formulario.instance.Formulario',
  campo: 'cl.sii.sdi.difm.rcs.web.client.formulario.instance.Campo',
  expresion: 'cl.sii.sdi.difm.rcs.web.client.formulario.metadata.Expresion',
  cell: 'cl.sii.sdi.difm.rcs.web.client.formulario.layout.Cell',
} as const;

function isNode(v: Gwt7Value | undefined): v is Gwt7Node {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function node(v: Gwt7Value, cls: string, what: string): Gwt7Node {
  if (!isNode(v) || v.cls !== cls) throw roto(`${what} no es ${cls.split('.').pop()}`);
  return v;
}
function str(v: Gwt7Value): string | null {
  if (v === null) return null;
  if (typeof v === 'string') return v;
  if (isNode(v) && v.cls === 'java.lang.String' && typeof v.values[0] === 'string')
    return v.values[0];
  throw roto('se esperaba un string');
}
function num(v: Gwt7Value, what: string): number {
  if (typeof v === 'number') return v;
  if (isNode(v) && typeof v.values[0] === 'number') return v.values[0]; // a boxed Integer
  throw roto(`${what} no es un número`);
}
/** A `java.util.HashMap` node's entries as a Map keyed by string. */
function hashMap(v: Gwt7Value, what: string): Map<string, Gwt7Value> {
  if (!isNode(v) || v.cls !== 'java.util.HashMap' || !Array.isArray(v.values[0])) {
    throw roto(`${what} no es un HashMap`);
  }
  const out = new Map<string, Gwt7Value>();
  for (const e of v.values[0]) {
    if (!Array.isArray(e) || e.length !== 2) throw roto(`${what}: entrada inválida`);
    const k = str(e[0]!);
    if (k !== null) out.set(k, e[1]!);
  }
  return out;
}
function findAll(root: Gwt7Value, cls: string): Gwt7Node[] {
  const out: Gwt7Node[] = [];
  const seen = new Set<object>();
  const walk = (v: Gwt7Value): void => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) return v.forEach(walk);
    if (v.cls === cls) out.push(v);
    v.values.forEach(walk);
  };
  walk(root);
  return out;
}

// ── The evaluator (PG) ───────────────────────────────────────────────────────
const TRUE = 'TRUE';
const FALSE = 'FALSE';
// The node's type `f`: 64 + the data type marks a campo reference (`$cod502`); 1 ENTERO,
// 2 DECIMAL, 4 STRING, 8 BOOLEAN, 16/32 dates (OG/NG compare by these).
const CAMPO_REF = new Set([64, 65, 66, 68, 72, 80, 96]);
const isNumType = (f: number): boolean => f === 1 || f === 65 || f === 2 || f === 66;
const isStrType = (f: number): boolean => f === 4 || f === 68;
const isBoolType = (f: number): boolean => f === 8 || f === 72 || f === 128;
const isDateType = (f: number): boolean => f === 16 || f === 32 || f === 80 || f === 96;

// The widgets whose refresh stores the campo's value (observed: TEXTBOX `jL`, CHECKBOX `GK`/`QL`).
// A cell bound to a campo with any other widget is a shape we have not observed: scraper roto.
const WIDGETS = new Set(['TEXTBOX', 'CHECKBOX']);
const UNBOUND_WIDGETS = new Set(['LABEL', 'IMAGE']);

/** `TNf`: trims only when the string starts or ends with whitespace. */
const trim = (s: string): string => s.trim();

class F29Form {
  readonly campos: Map<string, Gwt7Node>;
  private readonly params: Map<string, Gwt7Value>;
  private readonly computed = new Map<Gwt7Node, string>();
  private readonly computing = new Set<Gwt7Node>();

  constructor(
    readonly formulario: Gwt7Node,
    private readonly hoy: Date,
  ) {
    this.campos = new Map(
      [...hashMap(formulario.values[FORM.campos]!, 'Formulario.d')].map(([k, v]) => [
        k,
        node(v, CLS.campo, `campo ${k}`),
      ]),
    );
    this.params = hashMap(formulario.values[FORM.params]!, 'Formulario.A');
    const multi = formulario.values[FORM.multivalor];
    const sections = isNode(multi) && Array.isArray(multi.values[0]) ? multi.values[0] : [];
    if (sections.length > 0) {
      // Multivalued sections evaluate formulas per row (`cE`/`VD`); the F29 has none.
      throw roto('el formulario tiene secciones multivalor');
    }
  }

  campo(key: string): Gwt7Node {
    const c = this.campos.get(key);
    if (!c) throw roto(`no existe el campo ${key}`);
    return c;
  }
  meta(campo: Gwt7Node): Gwt7Node {
    const m = campo.values[CAMPO.meta];
    if (!isNode(m)) throw roto('campo sin metadata');
    return m;
  }
  stored(campo: Gwt7Node): string {
    return str(campo.values[CAMPO.value]!) ?? '';
  }
  set(campo: Gwt7Node, value: string): void {
    campo.values[CAMPO.value] = value;
    this.computed.clear();
  }

  /** `rC`: a campo with a formula reads as its formula's formatted result. */
  value(campo: Gwt7Node): string {
    const f = this.meta(campo).values[MD.formula];
    if (!isNode(f)) return this.stored(campo);
    const hit = this.computed.get(campo);
    if (hit !== undefined) return hit;
    if (this.computing.has(campo)) throw roto(`fórmula circular en ${this.code(campo)}`);
    this.computing.add(campo);
    try {
      const v = this.format(campo, this.eval(f));
      this.computed.set(campo, v);
      return v;
    } finally {
      this.computing.delete(campo);
    }
  }
  code(campo: Gwt7Node): string {
    return str(this.meta(campo).values[MD.codigo]!) ?? '?';
  }

  /** `jC`: format a formula's result by the campo's type. */
  format(campo: Gwt7Node, raw: string): string {
    if (raw === '') return '';
    const md = this.meta(campo);
    const tipo = str(md.values[MD.tipo]!) ?? '';
    const maxLen = num(md.values[MD.maxLen]!, 'largo máximo');
    if (/^ENTERO[01]?$/.test(tipo)) {
      if (raw.indexOf('-') > 0) return raw.slice(0, raw.indexOf('-')); // vJ, as SII does
      const r = setScale(parseSiiNumber(raw), 0);
      const { int } = digits(r);
      if (int.length > maxLen) throw roto(`el campo calculado ${this.code(campo)} excede su largo`);
      return (r.neg ? '-' : '') + int;
    }
    if (/^DECIMAL[01]?$/.test(tipo)) {
      const v = num(md.values[MD.decimales]!, 'decimales');
      const r = setScale(parseSiiNumber(raw), v !== 0 ? v : 2);
      if (digits(r).int.length > maxLen)
        throw roto(`el campo calculado ${this.code(campo)} excede su largo`);
      return formatSiiNumber(r);
    }
    return raw;
  }

  /** `jL`: what a widget's refresh stores — a numeric zero becomes '' unless B is "0". */
  widgetValue(campo: Gwt7Node, v: string): string {
    const md = this.meta(campo);
    const tipo = str(md.values[MD.tipo]!) ?? '';
    if (
      v.length > 0 &&
      /^(ENTERO|DECIMAL)[01]?$/.test(tipo) &&
      str(md.values[MD.ceroVisible]!) !== '0'
    ) {
      const n = Number(v);
      if (Number.isFinite(n) && n === 0) return '';
    }
    return v;
  }

  ref(expr: Gwt7Node): Gwt7Node {
    const name = str(expr.values[EXPR.op]!) ?? '';
    return this.campo(name.slice(1)); // `$cod502` → `cod502`
  }

  eval(expr: Gwt7Value): string {
    if (!isNode(expr) || expr.cls !== CLS.expresion) throw roto('expresión inválida');
    const op = str(expr.values[EXPR.op]!) ?? '';
    const left = expr.values[EXPR.left] ?? null;
    const right = expr.values[EXPR.right] ?? null;
    const type = num(expr.values[EXPR.type]!, 'tipo de expresión');
    const sub = (v: Gwt7Value): Gwt7Node => {
      if (!isNode(v)) throw roto(`${op} sin operando`);
      return v;
    };
    const isTrue = (v: Gwt7Value): boolean => trim(this.eval(v)) === TRUE;

    if (op === '?') {
      const branches = sub(right);
      return isTrue(left)
        ? trim(this.eval(branches.values[EXPR.left]!))
        : trim(this.eval(branches.values[EXPR.right]!));
    }
    if (CAMPO_REF.has(type)) return trim(this.value(this.ref(expr)));
    if (type === 128) throw roto('referencia a regla en una fórmula');
    if (left === null && right === null) {
      if (op === 'FECHA_MES_ACTUAL') return mesActual(this.hoy); // R4f: the browser's YYYYMM
      if (op === 'POS' || op === 'FECHA_DIA_ACTUAL') throw roto(`función sin soporte: ${op}`);
      return type === 4 ? op.slice(1, -1) : trim(op); // a constant ('…' strings lose the quotes)
    }
    switch (op) {
      case '+':
      case '-':
      case '*':
      case '/': {
        const q = this.eval(left);
        const t = right === null ? null : this.eval(right);
        if (q === '' && t === '') return '';
        if (t === null) throw roto(`${op} sin segundo operando`);
        const a = q === '' ? parseSiiNumber('0') : parseSiiNumber(q);
        const b = t === '' ? parseSiiNumber('0') : parseSiiNumber(t);
        const r =
          op === '+'
            ? add(a, b)
            : op === '-'
              ? subtract(a, b)
              : op === '*'
                ? multiply(a, b)
                : divide(a, b);
        return formatSiiNumber(r);
      }
      case '==':
      case '!=': {
        const eq = this.equal(sub(left), sub(right), this.eval(left), this.eval(right));
        return op === '==' ? (eq ? TRUE : FALSE) : eq ? FALSE : TRUE;
      }
      case '<':
      case '>':
      case '<=':
      case '>=': {
        const l = sub(left);
        const r = sub(right);
        const q = this.eval(l);
        const t = this.eval(r);
        const lt = this.less(l, r, q, t);
        if (op === '<') return lt ? TRUE : FALSE;
        if (op === '>=') return lt ? FALSE : TRUE;
        const eq = this.equal(l, r, q, t);
        if (op === '<=') return lt || eq ? TRUE : FALSE;
        return !lt && !eq ? TRUE : FALSE;
      }
      case 'AND':
        return isTrue(left) && isTrue(right) ? TRUE : FALSE;
      case 'OR':
        return isTrue(left) || isTrue(right) ? TRUE : FALSE;
      case '->':
        return !isTrue(left) || isTrue(right) ? TRUE : FALSE;
      case 'NOT':
        return isTrue(left) ? FALSE : TRUE;
      case 'PSTV': {
        const q = this.eval(left);
        return q.indexOf('-') === 0 ? '0' : q;
      }
      case 'ABS': {
        const q = this.eval(left);
        return q.indexOf('-') === 0 ? q.slice(1) : q;
      }
      case 'NEG': {
        const q = this.eval(left);
        return q.indexOf('-') === 0 ? q.slice(1) : '-' + q;
      }
      case 'ISNULO':
        return trim(this.value(this.ref(sub(left)))) === '' ? TRUE : FALSE;
      case 'EXISTE_DATO': {
        // qJ: present when something other than leading zeros is left
        const k = trim(this.eval(left)).replace(/^0+/, '');
        return k !== '' ? TRUE : FALSE;
      }
      case 'ROUND': {
        // SII rounds the fraction alone with Math.round and adds it to the integer part, so a
        // negative x.5 goes up (-12.5 → -11). Kept as observed.
        const q = trim(this.eval(left));
        const k = q.indexOf('.');
        if (k === -1) return q;
        const whole = BigInt(q.slice(0, k) === '-' || q.slice(0, k) === '' ? '0' : q.slice(0, k));
        return (whole + BigInt(Math.round(Number('0' + q.slice(k))))).toString();
      }
      case 'MINL':
      case 'MAXL': {
        if (right === null) return this.eval(left);
        const q = trim(this.eval(left));
        const rn = sub(right);
        if ((str(rn.values[EXPR.op]!) ?? '') === ':') throw roto(`${op} con lista`);
        const t = trim(this.eval(rn));
        const c = compare(
          q === '' ? parseSiiNumber('0') : parseSiiNumber(q),
          t === '' ? parseSiiNumber('0') : parseSiiNumber(t),
        );
        return op === 'MINL' ? (c < 0 ? q : t) : c > 0 ? q : t;
      }
      case 'GET_VALUE': {
        const table = this.params.get(trim(this.eval(left)));
        if (table === undefined) return '';
        const v = hashMap(table, 'tabla de parámetros').get(trim(this.eval(right)));
        return v === undefined ? '' : (str(v) ?? '');
      }
      case 'PROX_PERIODO':
        return shiftPeriodo(trim(this.value(this.ref(sub(left)))), +1);
      case 'AANT_PERIODO':
        return shiftPeriodo(trim(this.value(this.ref(sub(left)))), -2);
      default:
        throw roto(`operador desconocido "${op}"`);
    }
  }

  /** `NG`: equality by the operands' types. */
  private equal(l: Gwt7Node, r: Gwt7Node, q: string, t: string): boolean {
    const lf = num(l.values[EXPR.type]!, 'tipo');
    const rf = num(r.values[EXPR.type]!, 'tipo');
    if (isBoolType(lf) || isBoolType(rf) || isStrType(lf) || isStrType(rf)) return q === t;
    if (isNumType(lf) || isNumType(rf)) {
      return (
        compare(
          q === '' ? parseSiiNumber('0') : parseSiiNumber(q),
          t === '' ? parseSiiNumber('0') : parseSiiNumber(t),
        ) === 0
      );
    }
    if (isDateType(lf) && isDateType(rf)) {
      if (q.length === 0 || t.length === 0) return q.length === t.length;
      return q === t;
    }
    return false;
  }

  /** `OG`: "less than" by the operands' types. */
  private less(l: Gwt7Node, r: Gwt7Node, q: string, t: string): boolean {
    const lf = num(l.values[EXPR.type]!, 'tipo');
    const rf = num(r.values[EXPR.type]!, 'tipo');
    if (isStrType(lf) || isStrType(rf)) return q < t;
    if (isNumType(lf) || isNumType(rf)) {
      return (
        compare(
          q === '' ? parseSiiNumber('0') : parseSiiNumber(q),
          t === '' ? parseSiiNumber('0') : parseSiiNumber(t),
        ) < 0
      );
    }
    if (isDateType(lf) && isDateType(rf)) {
      if (q.length === 0 || t.length === 0) return false;
      return q < t;
    }
    return false;
  }
}

/** `FECHA_MES_ACTUAL`: the client builds YYYYMM from the browser's clock; SII's users are in
 *  Chile, so the month is taken in America/Santiago. */
function mesActual(hoy: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(hoy);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return get('year') + get('month');
}

/** `xJ` (+1 month) and `$I` (-2 months) on a `YYYYMM` or `YYYYMMDD` período; '' if invalid. */
function shiftPeriodo(p: string, months: number): string {
  if (!/^\d{6}(\d{2})?$/.test(p)) return '';
  const y = Number(p.slice(0, 4));
  const m = Number(p.slice(4, 6));
  if (m < 1 || m > 12) return '';
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}${String((total % 12) + 1).padStart(2, '0')}`;
}

/** A rule whose expression did not evaluate to TRUE (SII's own client-side validation). */
export interface F29ReglaFallida {
  readonly nombre: string;
  /** SII's message, verbatim (ADR-004). */
  readonly mensaje: string;
  readonly tipo: number;
}
export interface F29FormFill {
  /** Every campo whose value the fill changed, by código. */
  readonly cambios: readonly {
    readonly codigo: string;
    readonly antes: string;
    readonly despues: string;
  }[];
  readonly reglasFallidas: readonly F29ReglaFallida[];
}

/** Fill the layout `findVersionBorradorById` returned, IN PLACE, as SII's client does before
 *  `getBorradorRfiValidado` in mode PPTA-F29-COMPLETA: the 773/778 checkboxes the screen shows
 *  go to FALSE, then every campo with a formula takes its formula's value. Returns what changed
 *  and the rules that fail. `hoy` is the moment of the fill (a few rules read the current
 *  month); pass the `Clock`'s now. The values are taxpayer data: never log them. */
export function fillF29Form(layout: Gwt7Node, hoy: Date): F29FormFill {
  const form = new F29Form(theFormulario(layout), hoy);
  const before = new Map<Gwt7Node, string>();
  for (const [, c] of form.campos) before.set(c, form.stored(c));
  const after = (c: Gwt7Node): string => form.stored(c);

  // QRb: the propuesta screen sets these checkboxes to FALSE when it shows them.
  const cells = findAll(layout, CLS.cell);
  const cellIds = new Set(cells.map((c) => c.values[CELL.id]));
  for (const [codigo, cell] of [
    ['773', 'celdaCod773_1'],
    ['778', 'celdaCod778_1'],
  ] as const) {
    if (cellIds.has(cell)) form.set(form.campo(`cod${codigo}`), FALSE);
  }

  // The serializer sends a campo's STORED value. The client stores a formula's result only
  // through the widget that shows the campo: its refresh (`jL` TEXTBOX, `GK`/`QL` CHECKBOX)
  // writes the getter's value, and a numeric zero is stored as '' unless the metadata's B is "0".
  // A formula campo no cell shows keeps what the layout brought.
  const shown = new Set<Gwt7Node>();
  for (const cell of cells) {
    const ref = cell.values[CELL.ref];
    const m = typeof ref === 'string' ? /^\$(cod\d+)$/.exec(ref) : null;
    if (!m) continue;
    const widget = String(cell.values[CELL.widget]);
    if (UNBOUND_WIDGETS.has(widget)) continue;
    if (!WIDGETS.has(widget)) throw roto(`widget desconocido ${widget} en ${m[1]}`);
    shown.add(form.campo(m[1]!));
    if (widget === 'TEXTBOX') {
      // wM builds a read-only TEXTBOX (the propuesta view) as a hidden-value field.
      cell.values[CELL.visible] = FALSE;
      cell.values[CELL.css] = 'fw-campoOculto';
      if (cell.values[CELL.width] === '') cell.values[CELL.width] = '125px';
    }
  }
  const values = new Map<Gwt7Node, string>();
  for (const c of shown) {
    if (!isNode(form.meta(c).values[MD.formula])) continue;
    values.set(c, form.widgetValue(c, form.value(c)));
  }
  for (const [c, v] of values) c.values[CAMPO.value] = v;

  const cambios = [...form.campos.values()]
    .filter((c) => (before.get(c) ?? '') !== after(c))
    .map((c) => ({ codigo: form.code(c), antes: before.get(c) ?? '', despues: after(c) }));

  // GC with no group: rules with no group or the DEFAULT group, kind ≠ 1, fail unless TRUE.
  const meta = node(
    form.formulario.values[FORM.meta]!,
    'cl.sii.sdi.difm.rcs.web.client.formulario.metadata.FormularioMetadata',
    'Formulario.v',
  );
  const reglasFallidas: F29ReglaFallida[] = [];
  for (const [nombre, r] of hashMap(meta.values[FORM_META_RULES]!, 'reglas')) {
    if (!isNode(r)) throw roto('regla inválida');
    const tipo = num(r.values[REGLA.tipo]!, 'tipo de regla');
    if (tipo === 1) continue;
    const grupos = r.values[REGLA.grupos];
    const gs = Array.isArray(grupos)
      ? grupos.map((g) => str(g))
      : isNode(grupos) && Array.isArray(grupos.values[0])
        ? grupos.values[0].map((g) => str(g))
        : [];
    if (gs.length > 0 && !gs.includes('DEFAULT')) continue;
    if (trim(form.eval(r.values[REGLA.expr]!)) !== TRUE) {
      reglasFallidas.push({ nombre, mensaje: str(r.values[REGLA.mensaje]!) ?? '', tipo });
    }
  }
  return { cambios, reglasFallidas };
}

/** Evaluate one expression against a filled layout (tests, and the submit's safety checks). */
export function evaluateF29Expresion(layout: Gwt7Node, expr: Gwt7Node, hoy: Date): string {
  return new F29Form(theFormulario(layout), hoy).eval(expr);
}

function theFormulario(layout: Gwt7Node): Gwt7Node {
  const formularios = findAll(layout, CLS.formulario);
  if (formularios.length !== 1) throw roto(`se esperaba un Formulario, hay ${formularios.length}`);
  return formularios[0]!;
}
