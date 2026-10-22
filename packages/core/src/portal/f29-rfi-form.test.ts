// SYNTHETIC layouts only: a handful of campos, formulas and rules built by hand in the shape the
// rfiInternet layout has (positions observed 2026-10-19). No captured layout or value is used;
// the real one is checked privately (f29-rfi-form-captures.test.ts).
import { describe, expect, it } from 'vitest';
import { F29Error } from '../errors/index.js';
import type { Gwt7Node, Gwt7Value } from './gwt.js';
import {
  type CampoSpec,
  bool,
  cell,
  ex,
  int,
  layout,
  map,
  n,
  op,
  ref,
  regla,
  s,
  text,
} from './__fixtures__/f29-rfi-layout.js';
import {
  evaluateF29Expresion,
  fillF29Form,
  formatSiiNumber,
  parseSiiNumber,
} from './f29-rfi-form.js';

const HOY = new Date('2026-10-19T12:00:00-03:00');
const evalIn = (campos: CampoSpec[], expr: Gwt7Node, params: [string, Gwt7Value][] = []): string =>
  evaluateF29Expresion(layout(campos, { params }).root, expr, HOY);
const value = (c: Gwt7Node): Gwt7Value => c.values[2]!;

describe("SII's decimal (rK)", () => {
  it('always prints one decimal, drops trailing zeros, keeps the sign', () => {
    expect(formatSiiNumber(parseSiiNumber('5'))).toBe('5.0');
    expect(formatSiiNumber(parseSiiNumber('12.50'))).toBe('12.5');
    expect(formatSiiNumber(parseSiiNumber('007.00'))).toBe('7.0');
    expect(formatSiiNumber(parseSiiNumber('-0'))).toBe('-0.0');
  });

  it.each([
    ['+', '10', '2.5', '12.5'],
    ['-', '2', '5', '-3.0'],
    ['*', '1.5', '4', '6.0'],
    ['/', '10', '3', '3.33'],
    ['/', '2', '3', '0.67'],
    ['/', '1', '8', '0.13'], // 0.125: half-up on the magnitude
    ['/', '-1', '8', '-0.13'],
    ['/', '0', '7', '0.0'], // a zero dividend comes back as it is
  ])('%s: %s, %s → %s', (o, a, b, out) => {
    expect(evalIn([], op(o, int(a), int(b)))).toBe(out);
  });

  it.each([
    ['*', '-5', '0', '-0.0'], // a product multiplies the signs, even on zero
    ['-', '-5', '-5', '-0.0'], // oK: two equal negatives keep the negative sign
    ['-', '5', '5', '0.0'],
    ['-', '3', '5', '-2.0'],
    ['-', '-3', '5', '-8.0'],
    ['-', '3', '-5', '8.0'],
    ['-', '-2', '-5', '3.0'], // SII's digits wrap here; the correct value is returned
    ['-', '-5', '-2', '-3.0'],
    ['+', '5', '-5', '0.0'],
    ['+', '-5', '5', '0.0'],
    ['+', '-5', '-5', '-10.0'],
  ])('signs as SII keeps them: %s %s, %s → %s', (o, a, b, out) => {
    expect(evalIn([], op(o, int(a), int(b)))).toBe(out);
  });

  it('an empty operand counts as zero; two empty operands give empty', () => {
    expect(evalIn([{ codigo: '1' }], op('+', ref('1'), int('4')))).toBe('4.0');
    expect(evalIn([{ codigo: '1' }, { codigo: '2' }], op('+', ref('1'), ref('2')))).toBe('');
  });

  it('a non-numeric operand or a zero divisor is scraper roto, never a silent 0', () => {
    expect(() => evalIn([], op('+', text('abc'), int('1')))).toThrow(
      /scraper roto.*número inválido/,
    );
    expect(() => evalIn([], op('/', int('1'), int('0')))).toThrow(/división por cero/);
  });
});

describe('the evaluator (PG), operator by operator', () => {
  const c = [
    { codigo: '10', value: '100' },
    { codigo: '20', value: '' },
    { codigo: '30', value: 'TRUE', tipo: 'BOOLEAN' },
  ];
  it.each<[string, Gwt7Node, string]>([
    ['campo reference', ref('10'), '100'],
    ['string constant', text('abc'), 'abc'],
    ['?: true branch', op('?', bool('TRUE'), op(':', int('1'), int('2'))), '1'],
    ['?: false branch', op('?', bool('FALSE'), op(':', int('1'), int('2'))), '2'],
    ['== numeric', op('==', ref('10'), int('100.0')), 'TRUE'],
    ['== empty as zero', op('==', ref('20'), int('0')), 'TRUE'],
    ['!= ', op('!=', ref('10'), int('5')), 'TRUE'],
    ['== boolean', op('==', ref('30', 72), bool('TRUE')), 'TRUE'],
    ['< numeric', op('<', int('9'), int('10')), 'TRUE'],
    ['< string', op('<', text('b'), text('a')), 'FALSE'],
    ['<= equal', op('<=', int('10'), int('10')), 'TRUE'],
    ['> ', op('>', int('10'), int('9')), 'TRUE'],
    ['>= ', op('>=', int('9'), int('10')), 'FALSE'],
    ['AND', op('AND', bool('TRUE'), bool('FALSE')), 'FALSE'],
    ['OR', op('OR', bool('FALSE'), bool('TRUE')), 'TRUE'],
    ['-> with a false premise', op('->', bool('FALSE'), bool('FALSE')), 'TRUE'],
    ['NOT', op('NOT', bool('TRUE')), 'FALSE'],
    ['PSTV of a negative', op('PSTV', int('-7')), '0'],
    ['ABS', op('ABS', int('-7')), '7'],
    ['NEG', op('NEG', int('7')), '-7'],
    ['ISNULO', op('ISNULO', ref('20')), 'TRUE'],
    ['EXISTE_DATO of zeros', op('EXISTE_DATO', text('000')), 'FALSE'],
    ['EXISTE_DATO', op('EXISTE_DATO', ref('10')), 'TRUE'],
    ['ROUND half up', op('ROUND', int('2.5')), '3'],
    ['ROUND of a negative .5, as SII does', op('ROUND', int('-12.5')), '-11'],
    ['MINL', op('MINL', int('3'), int('8')), '3'],
    ['MAXL', op('MAXL', int('3'), int('8')), '8'],
    ['GET_VALUE', op('GET_VALUE', text('mapaParametros'), text('P01')), '19'],
    ['GET_VALUE of a missing key', op('GET_VALUE', text('mapaParametros'), text('P99')), ''],
  ])('%s', (_name, expr, out) => {
    expect(evalIn(c, expr, [['mapaParametros', map([['P01', s('19')]])]])).toBe(out);
  });

  it('shifts períodos (PROX_PERIODO +1 month, AANT_PERIODO -2 months)', () => {
    const p = [
      { codigo: '1', value: '202612', tipo: 'DATE_MES' },
      { codigo: '2', value: '202602', tipo: 'DATE_MES' },
    ];
    expect(evalIn(p, op('PROX_PERIODO', ref('1', 96)))).toBe('202701');
    expect(evalIn(p, op('AANT_PERIODO', ref('2', 96)))).toBe('202512');
  });

  it('reads FECHA_MES_ACTUAL from the given moment, in Chile', () => {
    expect(evalIn([], ex('FECHA_MES_ACTUAL', 16))).toBe('202610');
  });

  it('compares dates by text, and empty dates only to empty ones', () => {
    const d = [
      { codigo: '1', value: '202609', tipo: 'DATE_MES' },
      { codigo: '2', value: '', tipo: 'DATE_MES' },
    ];
    expect(evalIn(d, op('<', ref('1', 96), ex('202610', 32)))).toBe('TRUE');
    expect(evalIn(d, op('==', ref('2', 96), ex('', 32)))).toBe('TRUE');
    expect(evalIn(d, op('==', ref('2', 96), ref('1', 96)))).toBe('FALSE');
    expect(evalIn(d, op('<', ref('2', 96), ref('1', 96)))).toBe('FALSE');
  });

  it('== without a right operand is FALSE, as in NG', () => {
    expect(evalIn([], op('==', int('1')))).toBe('FALSE');
  });

  it.each<[string, Gwt7Node, RegExp]>([
    ['a rule reference in a formula', ex('$R1', 128), /referencia a regla/],
    ['+ without a second operand', op('+', int('1')), /\+ sin segundo operando/],
    ['MINL over a list', op('MINL', int('1'), op(':', int('1'), int('2'))), /MINL con lista/],
    ['ROUND of text', op('ROUND', text('a.5')), /ROUND de un valor no numérico/],
  ])('%s is scraper roto', (_name, expr, msg) => {
    expect(() => evalIn([], expr)).toThrow(msg);
  });

  it('needs exactly one Formulario in the layout', () => {
    expect(() => evaluateF29Expresion(n('test.Empty', []), int('1'), HOY)).toThrow(
      /se esperaba un Formulario, hay 0/,
    );
    const one = layout([]).root;
    expect(() =>
      evaluateF29Expresion(n('test.Two', [one.values[0]!, one.values[0]!]), int('1'), HOY),
    ).not.toThrow(); // the same object twice is one Formulario
  });

  it('an unknown operator, a missing campo or a circular formula is scraper roto', () => {
    expect(() => evalIn([], op('XOR', bool('TRUE'), bool('TRUE')))).toThrow(
      /operador desconocido "XOR"/,
    );
    expect(() => evalIn([], ref('404'))).toThrow(/no existe el campo cod404/);
    const loop = [
      { codigo: '1', formula: ref('2') },
      { codigo: '2', formula: ref('1') },
    ];
    expect(() => evalIn(loop, ref('1'))).toThrow(/fórmula circular/);
    expect(() => evalIn([], ex('POS', 1))).toThrow(F29Error);
  });
});

describe('fillF29Form', () => {
  it('stores formula results through the shown widgets, as the client does', () => {
    const { root, get } = layout(
      [
        { codigo: '504', value: '1200' },
        // the propuesta's remanente: 537 = 504 and 77 = 537 (shown, computed, were empty)
        { codigo: '537', formula: op('+', ref('504'), int('0')) },
        { codigo: '77', formula: ref('537') },
        // a stale value whose formula is now zero: stored as '' (B is not "0")
        { codigo: '543', value: '999', formula: op('-', ref('504'), ref('504')) },
        // same, but B = "0" keeps the zero
        { codigo: '544', value: '999', formula: op('-', ref('504'), ref('504')), ceroVisible: '0' },
        // a formula no cell shows keeps what the layout brought
        { codigo: '815', value: '7', formula: int('8') },
        { codigo: '773', tipo: 'BOOLEAN' },
        { codigo: '778', tipo: 'BOOLEAN' },
      ],
      {
        cells: [
          cell('$cod537', 'TEXTBOX'),
          cell('$cod77', 'TEXTBOX', '', ''),
          cell('$cod543', 'TEXTBOX'),
          cell('$cod544', 'TEXTBOX'),
          cell('$cod537.codigo', 'LABEL'),
          cell('$cod773', 'CHECKBOX', 'celdaCod773_1'),
          cell('$cod778', 'CHECKBOX', 'celdaCod778_1'),
        ],
      },
    );
    const { cambios, reglasFallidas } = fillF29Form(root, HOY);
    expect(value(get('537'))).toBe('1200');
    expect(value(get('77'))).toBe('1200');
    expect(value(get('543'))).toBe('');
    expect(value(get('544'))).toBe('0');
    expect(value(get('815'))).toBe('7');
    expect(value(get('773'))).toBe('FALSE');
    expect((get('773').values[0] as Gwt7Node).values[1]).toBe('A'); // TC resets the metadata long
    expect(value(get('778'))).toBe('FALSE');
    expect(cambios.map((c) => c.codigo).sort()).toEqual(['537', '543', '544', '77', '773', '778']);
    expect(reglasFallidas).toEqual([]);
    // the read-only TEXTBOX cells become hidden-value fields; an empty width gets the default
    const cells = (root.values[1] as Gwt7Node).values[0] as Gwt7Node[];
    expect(cells[1]!.values.slice(7)).toEqual(['FALSE', 1, 'fw-campoOculto', '125px']);
    expect(cells[0]!.values[9]).toBe('fw-campoOculto');
    expect(cells[4]!.values[9]).toBe('tabla_td_fixed_c_right'); // a LABEL is left alone
  });

  it('formats a result by the campo type: ENTERO rounds half up, DECIMAL keeps its decimals', () => {
    const { root, get } = layout(
      [
        { codigo: '1', formula: op('/', int('10'), int('4')) }, // 2.5 → 3
        { codigo: '2', formula: op('/', int('10'), int('3')), tipo: 'DECIMAL', decimales: 1 }, // 3.33 → 3.3
        { codigo: '3', formula: int('123456'), maxLen: 3 },
      ],
      { cells: [cell('$cod1', 'TEXTBOX'), cell('$cod2', 'TEXTBOX')] },
    );
    fillF29Form(root, HOY);
    expect(value(get('1'))).toBe('3');
    expect(value(get('2'))).toBe('3.3');
    const tooLong = layout([{ codigo: '3', formula: int('123456'), maxLen: 3 }], {
      cells: [cell('$cod3', 'TEXTBOX')],
    });
    expect(() => fillF29Form(tooLong.root, HOY)).toThrow(/excede su largo/);
  });

  it("returns the rules that are not TRUE, skipping kind 1 and other groups, with SII's message", () => {
    const { root } = layout([{ codigo: '1', value: '5' }], {
      reglas: [
        regla(op('>', ref('1'), int('10')), 'R1'),
        regla(op('>', ref('1'), int('1')), 'R2'),
        regla(op('>', ref('1'), int('10')), 'R3', 1),
        regla(op('>', ref('1'), int('10')), 'R4', 3, ['OTRO']),
        regla(op('>', ref('1'), int('10')), 'R5', 2, ['DEFAULT']),
      ],
    });
    expect(fillF29Form(root, HOY).reglasFallidas).toEqual([
      { nombre: 'R1', mensaje: 'Regla R1 no se cumple.', tipo: 3 },
      { nombre: 'R5', mensaje: 'Regla R5 no se cumple.', tipo: 2 },
    ]);
  });

  it('fails loud on a widget it has not observed, or on multivalued sections', () => {
    const odd = layout([{ codigo: '1' }], { cells: [cell('$cod1', 'LISTBOX')] });
    expect(() => fillF29Form(odd.root, HOY)).toThrow(/widget desconocido LISTBOX en cod1/);
    const multi = layout([]);
    ((multi.root.values[0] as Gwt7Node).values[31] as Gwt7Node).values[0] = [n('test.Seccion', [])];
    expect(() => fillF29Form(multi.root, HOY)).toThrow(/secciones multivalor/);
  });
});
