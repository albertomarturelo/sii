// SYNTHETIC rfiInternet layouts for tests: a handful of campos, formulas, cells and rules built by
// hand in the shape the real layout has (positions observed 2026-10-19). No captured value.
import type { Gwt7Node, Gwt7Value } from '../gwt.js';

export const P = 'cl.sii.sdi.difm.rcs.web.client.formulario.';

export const n = (cls: string, values: Gwt7Value[]): Gwt7Node => ({ cls, values });
export const s = (v: string): Gwt7Node => n('java.lang.String', [v]);
export const map = (entries: [string, Gwt7Value][]): Gwt7Node =>
  n('java.util.HashMap', [entries.map(([k, v]) => [s(k), v])]);
export const list = (items: Gwt7Value[]): Gwt7Node => n('java.util.ArrayList', [items]);

// Expresion: [args, c (operator / name / constant), d (left), e (right), f (type)]
export const ex = (
  op: string,
  type: number,
  left: Gwt7Node | null = null,
  right: Gwt7Node | null = null,
): Gwt7Node => n(`${P}metadata.Expresion`, [null, op, left, right, type]);
export const int = (v: string): Gwt7Node => ex(v, 1);
export const text = (v: string): Gwt7Node => ex(`'${v}'`, 4);
export const bool = (v: 'TRUE' | 'FALSE'): Gwt7Node => ex(v, 8);
export const ref = (codigo: string, type = 65): Gwt7Node => ex(`$cod${codigo}`, type);
export const op = (o: string, l: Gwt7Node, r: Gwt7Node | null = null, type = 0): Gwt7Node =>
  ex(o, type, l, r);

export interface CampoSpec {
  codigo: string;
  value?: string;
  formula?: Gwt7Node;
  tipo?: string;
  maxLen?: number;
  decimales?: number;
  ceroVisible?: string;
}
export function campo(c: CampoSpec): Gwt7Node {
  const md: Gwt7Value[] = new Array<Gwt7Value>(25).fill(null);
  md[4] = c.codigo;
  md[9] = c.formula ?? null;
  md[11] = `cod${c.codigo}`;
  md[13] = c.maxLen ?? 18;
  md[17] = c.decimales ?? 0;
  md[19] = c.tipo ?? 'ENTERO';
  md[23] = c.ceroVisible ?? '';
  return n(`${P}instance.Campo`, [n(`${P}metadata.CampoMetadata`, md), null, c.value ?? '']);
}
// Cell: [b, c, d, e (ref), f (widget), g, i (id), j (visible), k, n (css), o (width)]
export const cell = (ref: string, widget: string, id = '', width = '130px'): Gwt7Node =>
  n(`${P}layout.Cell`, [
    1,
    1,
    '',
    ref,
    widget,
    '',
    id,
    widget === 'TEXTBOX' ? 'FALSE' : 'TRUE',
    1,
    'tabla_td_fixed_c_right',
    width,
  ]);
// Regla: [b (expr), c (name), d (groups), e (message), f (kind)]
export const regla = (
  expr: Gwt7Node,
  nombre: string,
  tipo = 3,
  grupos: string[] = [],
): [string, Gwt7Node] => [
  nombre,
  n(`${P}metadata.Regla`, [
    expr,
    nombre,
    list(grupos.map(s)),
    `Regla ${nombre} no se cumple.`,
    tipo,
  ]),
];

export function layout(
  campos: CampoSpec[],
  opts: { cells?: Gwt7Node[]; reglas?: [string, Gwt7Node][]; params?: [string, Gwt7Value][] } = {},
): { root: Gwt7Node; get: (codigo: string) => Gwt7Node } {
  const nodes = campos.map(campo);
  const form: Gwt7Value[] = new Array<Gwt7Value>(39).fill(null);
  form[2] = map(nodes.map((c, k) => [`cod${campos[k]!.codigo}`, c]));
  const meta: Gwt7Value[] = new Array<Gwt7Value>(9).fill(null);
  meta[5] = map(opts.reglas ?? []);
  form[17] = n(`${P}metadata.FormularioMetadata`, meta);
  form[21] = map(opts.params ?? []);
  form[31] = list([]);
  const root = n('test.LayoutTO', [n(`${P}instance.Formulario`, form), list(opts.cells ?? [])]);
  return { root, get: (codigo) => nodes[campos.findIndex((c) => c.codigo === codigo)]! };
}
