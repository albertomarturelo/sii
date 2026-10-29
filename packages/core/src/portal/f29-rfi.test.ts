import { afterEach, describe, expect, it } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { HOSTS } from '../config/index.js';
import { F29Error, F29RechazoError } from '../errors/index.js';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import { type Gwt7Node, type Gwt7Param, type Gwt7Value, clearGwtPermutations } from './gwt.js';
import {
  RFI_FORMULARIO,
  type RfiCaller,
  abrirFormularioF29,
  callFormularioFacade,
  codigosDeclarados,
  guardarBorradorF29,
  inyectarBorradorF29,
  validarBorradorF29,
  recargosDeclarados,
  verificarBorradorF29,
} from './f29-rfi.js';
import { bool, cell, int, layout, map, op, ref, regla, s } from './__fixtures__/f29-rfi-layout.js';

// SYNTHETIC permutation + responses: one policy, one signature, no captured data.
const PERM = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const POLICY = '33333333333333333333333333333333';
const PERM_JS =
  `function PHc(){Yc.call(this,nge(),'formularioFacade','${POLICY}',VDc)}` +
  `a1='java.lang.String/2004016611';a2='java.lang.Integer/3438268394';`;

function session(answer: string): FakePortalSession {
  return new FakePortalSession({
    requestText: (url, opts) => {
      if (opts?.method === 'GET') return url.endsWith('rfi.nocache.js') ? `x='${PERM}'` : PERM_JS;
      return answer;
    },
  });
}

describe('callFormularioFacade', () => {
  afterEach(() => clearGwtPermutations());

  it('posts to formularioFacade with the live policy and decodes the result', async () => {
    const s = session('//OK[1,["listo"],0,7]');
    const v = await callFormularioFacade(
      s,
      'consultarHijoToken',
      [{ type: 'java.lang.String', value: 'PARAM_X' }],
      { returns: 'java.lang.String' },
    );
    expect(v).toBe('listo');
    expect(s.lastTextRequest?.url).toBe(`${HOSTS.portalApi}/rfiInternet/formularioFacade`);
    expect(s.lastTextRequest?.options?.body).toBe(
      `7|0|6|${RFI_FORMULARIO.moduleBase}|${POLICY}|` +
        'cl.sii.sdi.dim.rfi.web.client.service.FormularioFacade|consultarHijoToken|' +
        'java.lang.String/2004016611|PARAM_X|1|2|3|4|1|5|6|',
    );
  });

  it("raises SII's //EX verbatim as an F29Error", async () => {
    const s = session(
      '//EX[2,1,["cl.sii.sdi.dim.rfi.web.shared.exception.RfiException/1","Sin propuesta"],0,7]',
    );
    await expect(callFormularioFacade(s, 'findAllFormulario', [])).rejects.toThrow(F29RechazoError);
    await expect(callFormularioFacade(s, 'findAllFormulario', [])).rejects.toThrow(
      'SII rechazó la operación: Sin propuesta',
    );
  });
});

describe('callFormularioFacade: what proves a call had no effect', () => {
  afterEach(() => clearGwtPermutations());

  it('a body that is not //EX and does not decode is an F29Error, NOT a rechazo', async () => {
    const s = session('<html>error</html>');
    const e = await callFormularioFacade(s, 'inyectarBorradorRfi', []).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(F29Error);
    expect(e).not.toBeInstanceOf(F29RechazoError);
  });
});

// ── The submit chain (#161), over a fake caller that answers with SYNTHETIC graphs ───────────
const TO = 'cl.sii.sdi.dim.rfi.to.';
const node = (cls: string, values: Gwt7Value[]): Gwt7Node => ({ cls, values });
const box = (cls: string, v: number): Gwt7Node => node(cls, [v]);
const integer = (v: number): Gwt7Node => box('java.lang.Integer', v);
const RUT = Rut.parse('20000042-0'); // synthetic, Mod-11-valid
const PERIODO = Periodo.parse('2026-10');
const HOY = new Date('2026-11-05T12:00:00-03:00');

function formularioRfi(codigo: string): Gwt7Node {
  const v = new Array<Gwt7Value>(28).fill(null);
  v[0] = box('java.lang.Boolean', 0);
  v[10] = codigo;
  v[27] = 0;
  return node(`${TO}Formulario`, v);
}
const xmlCodigo = (tipo: string, codigo: string, valor: string): string =>
  `<Codigos Secuencia="1" tipo="${tipo}"><Codigo>${codigo}</Codigo><Valor>${valor}</Valor>` +
  '<Glosa>X</Glosa></Codigos>';
const xmlFormulario = (codigos: string[]): string =>
  '<?xml version="1.0"?><FormularioRfi><Formulario><ListaCodigos>' +
  codigos.join('') +
  '</ListaCodigos></Formulario></FormularioRfi>';
function borrador(xml: string): Gwt7Node {
  const v = new Array<Gwt7Value>(30).fill(null);
  v[9] = xml;
  v[27] = integer(40);
  v[28] = 'integrity==';
  return node(`${TO}Borrador`, v);
}
/** A propuesta with 504 = 1000 and two formula campos SII shows (77 and 537 = 504). */
function syntheticLayout(): Gwt7Node {
  const { root } = layout(
    [
      { codigo: '504', value: '1000' },
      { codigo: '77', formula: op('+', ref('504'), int('0')) },
      { codigo: '537', formula: ref('504') },
    ],
    { cells: [cell('$cod77', 'TEXTBOX'), cell('$cod537', 'TEXTBOX')] },
  );
  return { ...root, cls: 'cl.sii.sdi.difm.rcs.web.client.to.FormularioLayoutTO' };
}
const XML_OK = xmlFormulario([
  xmlCodigo('D', '504', '1000'),
  xmlCodigo('D', '537', '1000'),
  xmlCodigo('D', '77', '1000'),
  xmlCodigo('R', '91', '0'),
  xmlCodigo('E', '03', '20000042-0'),
  xmlCodigo('N', '8707', '9'),
]);

interface Call {
  method: string;
  params: readonly Gwt7Param[];
}
function fakeCaller(
  over: Partial<Record<string, (params: readonly Gwt7Param[]) => Gwt7Value>> = {},
): { call: RfiCaller; calls: Call[] } {
  const calls: Call[] = [];
  const answers: Record<string, (params: readonly Gwt7Param[]) => Gwt7Value> = {
    consultarHijoToken: () =>
      map([
        ['rut', s('20000042')],
        ['dv', s('0')],
        ['form', s('29')],
        ['periodo', s('202610')],
        ['idBorrador', s('424242')],
      ]),
    getContribuyente: () =>
      node('cl.sii.sdi.dim.rfi.web.client.to.ResultadoRecuperarContribuyenteTo', [
        node('cl.sii.sdi.core.web.shared.to.SdiContribuyenteTo', []),
        null,
        0,
      ]),
    findAllFormulario: () =>
      node(`[L${TO}Formulario;`, [formularioRfi('050'), formularioRfi('029')]),
    findPeriodoHabilitado: () =>
      node(`[L${TO}Periodo;`, [node(`${TO}Periodo`, [integer(2026), integer(10)])]),
    findVersionBorradorById: () => syntheticLayout(),
    crearHijoToken: () => null,
    getBorradorRfiValidado: () => node(`${TO}BorradorRfi`, [borrador(XML_OK), borrador(XML_OK)]),
    guardarBorradorRfiValidado: () => borrador(XML_OK),
    inyectarBorradorRfi: () => box('java.lang.Boolean', 1),
    ...over,
  };
  const call: RfiCaller = (method, params) => {
    calls.push({ method, params });
    const answer = answers[method];
    if (!answer) throw new Error(`unexpected call ${method}`);
    return Promise.resolve(answer(params));
  };
  return { call, calls };
}
const methods = (calls: Call[]): string[] => calls.map((c) => c.method);

describe('validarBorradorF29', () => {
  it('runs the chain to the validation, as the browser does, and reads what SII declares', async () => {
    const { call, calls } = fakeCaller();
    const v = await validarBorradorF29(call, { rut: RUT, periodo: PERIODO, hoy: HOY });
    expect(methods(calls)).toEqual([
      'consultarHijoToken',
      'getContribuyente',
      'findAllFormulario',
      'findPeriodoHabilitado',
      'findVersionBorradorById',
      'crearHijoToken',
      'crearHijoToken',
      'getBorradorRfiValidado',
    ]);
    // The F29 (código "029") is the Formulario sent on, flagged and with tipo 40.
    const form = calls[3]!.params[0]!.value as Gwt7Node;
    expect(form.values[10]).toBe('029');
    const sent = calls[4]!.params;
    expect((sent[0]!.value as Gwt7Node).values[0]).toEqual({
      cls: 'java.lang.Boolean',
      values: [1],
    });
    expect((sent[0]!.value as Gwt7Node).values[27]).toBe(40);
    expect(sent[4]!.value).toEqual(integer(424242));
    expect(calls[1]!.params.map((p) => p.type)).toEqual(['java.lang.Integer', 'java.lang.String']);
    // Only D and R códigos are read; the header (E) and SII-internal (N) are not.
    expect([...v.declarados.keys()].sort()).toEqual(['504', '537', '77']);
    expect(v.total).toBe(0);
    expect(v.campos.find((c) => c.codigo === '77')?.formula).toBe(true);
  });

  it('reads a STRING campo of the layout as text, not as a monto (#235)', async () => {
    // SYNTHETIC: the layout types 922 as STRING (observed 2026-10-19); its value here is made up.
    const xml = xmlFormulario([
      xmlCodigo('D', '504', '1000'),
      xmlCodigo('D', '537', '1000'),
      xmlCodigo('D', '77', '1000'),
      xmlCodigo('D', '922', 'TEXTO 1'),
      xmlCodigo('R', '91', '0'),
    ]);
    const { call } = fakeCaller({
      findVersionBorradorById: () => {
        const { root } = layout(
          [
            { codigo: '504', value: '1000' },
            { codigo: '77', formula: op('+', ref('504'), int('0')) },
            { codigo: '537', formula: ref('504') },
            { codigo: '922', tipo: 'STRING', maxLen: 15 },
          ],
          { cells: [cell('$cod77', 'TEXTBOX'), cell('$cod537', 'TEXTBOX')] },
        );
        return { ...root, cls: 'cl.sii.sdi.difm.rcs.web.client.to.FormularioLayoutTO' };
      },
      getBorradorRfiValidado: () => node(`${TO}BorradorRfi`, [borrador(xml), borrador(xml)]),
    });
    const v = await validarBorradorF29(call, { rut: RUT, periodo: PERIODO, hoy: HOY });
    expect([...v.declarados.keys()].sort()).toEqual(['504', '537', '77']);
    expect([...v.textos.keys()]).toEqual(['922']);
    expect(v.campos.find((c) => c.codigo === '922')?.numerico).toBe(false);
    expect(recargosDeclarados(v)).toEqual(['922']);
  });

  it('takes the sin movimiento route: primitiva layout, tipo 1, its own Periodo (#221)', async () => {
    // SYNTHETIC: the shape of run3 (2026-10-29); SII's enabled list need not hold the período.
    const sinMov = (): Gwt7Node => {
      const { root } = layout([{ codigo: '504' }, { codigo: '8859', tipo: 'STRING' }]);
      return { ...root, cls: 'cl.sii.sdi.difm.rcs.web.client.to.FormularioLayoutTO' };
    };
    const { call, calls } = fakeCaller({
      consultarHijoToken: () =>
        map([
          ['rut', s('20000042')],
          ['dv', s('0')],
          ['periodo', s('202610')],
          ['accionPpta', s('TKN_PPTA-F29-CUSTOMIZADO')],
        ]),
      findPeriodoHabilitado: () =>
        node(`[L${TO}Periodo;`, [node(`${TO}Periodo`, [integer(2026), integer(9)])]),
      findVersionFormularioPrimitivaByPeriodo: () => sinMov(),
      getBorradorRfiValidado: () =>
        node(`${TO}BorradorRfi`, [
          borrador(xmlFormulario([xmlCodigo('D', '89', '0'), xmlCodigo('R', '91', '0')])),
          null,
        ]),
    });
    const v = await validarBorradorF29(call, {
      rut: RUT,
      periodo: PERIODO,
      hoy: HOY,
      ruta: 'sinMovimiento',
    });
    expect(methods(calls)).toContain('findVersionFormularioPrimitivaByPeriodo');
    expect(methods(calls)).not.toContain('findVersionBorradorById');
    const layoutCall = calls.find((c) => c.method === 'findVersionFormularioPrimitivaByPeriodo')!;
    const form = layoutCall.params[0]!.value as Gwt7Node;
    expect(form.values[0]).toEqual({ cls: 'java.lang.Boolean', values: [0] });
    expect(form.values[27]).toBe(1);
    // The Periodo is the flow's, built by the client, not one of SII's enabled months.
    expect((layoutCall.params[1]!.value as Gwt7Node).values).toEqual([integer(2026), integer(10)]);
    expect(layoutCall.params[4]).toEqual({ type: 'java.lang.String', value: 'FMNINT' });
    const validation = calls.find((c) => c.method === 'getBorradorRfiValidado')!;
    expect(validation.params[0]!.value).toEqual(integer(1));
    expect(v.total).toBe(0);
    expect(v.declarados.size).toBe(0);
  });

  it('refuses a flow whose mode is not the one asked for', async () => {
    const { call } = fakeCaller(); // a propuesta flow (it names its idBorrador)
    await expect(
      validarBorradorF29(call, { rut: RUT, periodo: PERIODO, hoy: HOY, ruta: 'sinMovimiento' }),
    ).rejects.toThrow('otro modo');
    const custom = fakeCaller({
      consultarHijoToken: () =>
        map([
          ['rut', s('20000042')],
          ['periodo', s('202610')],
          ['accionPpta', s('TKN_PPTA-F29-CUSTOMIZADO')],
        ]),
    });
    await expect(
      validarBorradorF29(custom.call, { rut: RUT, periodo: PERIODO, hoy: HOY }),
    ).rejects.toThrow('otro modo');
  });

  it('refuses when SII opened the flow for another período', async () => {
    const { call, calls } = fakeCaller({
      consultarHijoToken: () =>
        map([
          ['rut', s('20000042')],
          ['periodo', s('202609')],
          ['idBorrador', s('1')],
        ]),
    });
    await expect(
      validarBorradorF29(call, { rut: RUT, periodo: PERIODO, hoy: HOY }),
    ).rejects.toThrow('otro contribuyente o período');
    expect(methods(calls)).toEqual(['consultarHijoToken']);
  });

  it('refuses a período SII does not enable', async () => {
    const { call } = fakeCaller({
      findPeriodoHabilitado: () =>
        node(`[L${TO}Periodo;`, [node(`${TO}Periodo`, [integer(2026), integer(9)])]),
    });
    await expect(
      validarBorradorF29(call, { rut: RUT, periodo: PERIODO, hoy: HOY }),
    ).rejects.toThrow('SII no habilita el período 2026-10');
  });

  it('is scraper roto when SII offers no Formulario 29', async () => {
    const { call } = fakeCaller({
      findAllFormulario: () => node(`[L${TO}Formulario;`, [formularioRfi('050')]),
    });
    await expect(
      validarBorradorF29(call, { rut: RUT, periodo: PERIODO, hoy: HOY }),
    ).rejects.toThrow('scraper roto');
  });

  it("stops before validating when SII's own rules fail, with SII's message", async () => {
    const { call, calls } = fakeCaller({
      findVersionBorradorById: () => {
        const { root } = layout([{ codigo: '504', value: '1000' }], {
          reglas: [regla(bool('FALSE'), 'R1')],
        });
        return { ...root, cls: 'cl.sii.sdi.difm.rcs.web.client.to.FormularioLayoutTO' };
      },
    });
    await expect(
      validarBorradorF29(call, { rut: RUT, periodo: PERIODO, hoy: HOY }),
    ).rejects.toThrow('Regla R1 no se cumple.');
    expect(methods(calls)).not.toContain('getBorradorRfiValidado');
  });

  it("lets SII's //EX through verbatim", async () => {
    const { call } = fakeCaller({
      getBorradorRfiValidado: () => {
        throw new F29Error('SII rechazó la operación: Periodo cerrado');
      },
    });
    await expect(
      validarBorradorF29(call, { rut: RUT, periodo: PERIODO, hoy: HOY }),
    ).rejects.toThrow('SII rechazó la operación: Periodo cerrado');
  });
});

describe('codigosDeclarados', () => {
  it('reads D and R códigos with a value, drops zeros, never reads E or N', () => {
    const d = codigosDeclarados(
      xmlFormulario([
        xmlCodigo('D', '504', '1000'),
        xmlCodigo('D', '544', '0'),
        xmlCodigo('D', '115', '0.125'),
        xmlCodigo('R', '91', '2500'),
        xmlCodigo('E', '01', 'NOMBRE'),
        xmlCodigo('E', '07', '123'),
        xmlCodigo('N', '8707', '9'),
      ]),
    );
    expect(Object.fromEntries(d.montos)).toEqual({ '504': 1000, '115': 0.125, '91': 2500 });
  });

  it('is scraper roto without códigos or with a non-numeric monto', () => {
    expect(() => codigosDeclarados('<FormularioRfi/>')).toThrow('scraper roto');
    expect(() => codigosDeclarados(xmlFormulario([xmlCodigo('D', '504', 'x')]))).toThrow(
      'scraper roto',
    );
  });

  it('keeps a textual código as text, and only the códigos the layout types as text (#235)', () => {
    const xml = xmlFormulario([
      xmlCodigo('D', '504', '1000'),
      xmlCodigo('D', '922', 'TEXTO 1'),
      xmlCodigo('D', '0915', ''),
    ]);
    const d = codigosDeclarados(xml, new Set(['922', '915']));
    expect(Object.fromEntries(d.montos)).toEqual({ '504': 1000 });
    expect(Object.fromEntries(d.textos)).toEqual({ '922': 'TEXTO 1' });
    // Without the layout's word for it, a word in a D block is still a broken monto.
    expect(() => codigosDeclarados(xml)).toThrow('el valor del código 922');
  });
});

describe('verificarBorradorF29 (the safety rule)', () => {
  const campos = [
    { codigo: '504', valor: '1000', formula: false, numerico: true },
    { codigo: '77', valor: '1000', formula: true, numerico: true },
    { codigo: '537', valor: '1000', formula: true, numerico: true },
    { codigo: '773', valor: 'FALSE', formula: true, numerico: false },
    { codigo: '9', valor: '', formula: true, numerico: true },
  ];
  const propuesta = [{ codigo: '504', valor: 1000 }];

  it('finds nothing when SII declares the propuesta plus what the formulas compute', () => {
    const declarados = new Map([
      ['504', 1000],
      ['77', 1000],
      ['537', 1000],
    ]);
    expect(verificarBorradorF29(propuesta, campos, declarados)).toEqual([]);
  });

  it('catches the 2026-09 omission: 77 and 537 missing while 504 > 0', () => {
    expect(verificarBorradorF29(propuesta, campos, new Map([['504', 1000]]))).toEqual([
      { codigo: '77', motivo: 'falta' },
      { codigo: '537', motivo: 'falta' },
    ]);
  });

  it('catches a stale value, a changed value and a formula that contradicts the propuesta', () => {
    const declarados = new Map([
      ['504', 999],
      ['77', 1000],
      ['537', 1000],
      ['543', 5],
    ]);
    expect(verificarBorradorF29(propuesta, campos, declarados)).toEqual([
      { codigo: '504', motivo: 'distinto' },
      { codigo: '543', motivo: 'sobra' },
    ]);
    expect(
      verificarBorradorF29(
        [{ codigo: '77', valor: 5 }],
        campos,
        new Map([
          ['77', 5],
          ['537', 1000],
        ]),
      ),
    ).toEqual([{ codigo: '77', motivo: 'formula_vs_propuesta' }]);
  });
});

describe('verificarBorradorF29: textual códigos (#235)', () => {
  const campos = [
    { codigo: '504', valor: '1000', formula: false, numerico: true },
    { codigo: '922', valor: '', formula: false, numerico: false },
    { codigo: '915', valor: 'A', formula: false, numerico: false },
  ];
  const propuesta = [{ codigo: '504', valor: 1000 }];
  const montos = new Map([['504', 1000]]);

  it('accepts a text the form holds, and flags one SII adds or changes', () => {
    expect(verificarBorradorF29(propuesta, campos, montos, new Map([['915', 'A']]))).toEqual([]);
    expect(verificarBorradorF29(propuesta, campos, montos, new Map([['922', 'X']]))).toEqual([
      { codigo: '922', motivo: 'sobra' },
    ]);
    expect(verificarBorradorF29(propuesta, campos, montos, new Map([['915', 'B']]))).toEqual([
      { codigo: '915', motivo: 'distinto' },
    ]);
  });
});

describe('recargosDeclarados', () => {
  it('lists the recargo block SII declares, monto or text, and nothing else', () => {
    expect(
      recargosDeclarados({
        declarados: new Map([
          ['504', 1000],
          ['94', 1100],
          ['92', 40],
          ['93', 60],
        ]),
        textos: new Map([['922', 'X']]),
      }),
    ).toEqual(['92', '93', '94', '922']);
    expect(recargosDeclarados({ declarados: new Map([['91', 1000]]), textos: new Map() })).toEqual(
      [],
    );
  });
});

describe('guardarBorradorF29 / inyectarBorradorF29', () => {
  it('saves with tipo 41, then files the Borrador SII answered, unchanged', async () => {
    const guardado = borrador(XML_OK);
    const { call, calls } = fakeCaller({ guardarBorradorRfiValidado: () => guardado });
    const b = borrador(XML_OK);
    const r = await guardarBorradorF29(call, b);
    expect((calls[0]!.params[0]!.value as Gwt7Node).values[27]).toEqual(integer(41));
    expect((calls[0]!.params[0]!.value as Gwt7Node).values[28]).toBe('integrity==');
    await inyectarBorradorF29(call, r);
    expect(calls[1]).toEqual({
      method: 'inyectarBorradorRfi',
      params: [{ type: `${TO}Borrador`, value: guardado }],
    });
  });

  it('saves a sin movimiento borrador as SII validated it, tipo unchanged', async () => {
    const { call, calls } = fakeCaller({ guardarBorradorRfiValidado: () => borrador(XML_OK) });
    const b = borrador(XML_OK);
    b.values[27] = integer(1);
    await guardarBorradorF29(call, b, 'sinMovimiento');
    expect((calls[0]!.params[0]!.value as Gwt7Node).values[27]).toEqual(integer(1));
  });

  it('a filing SII does not confirm is an error', async () => {
    const { call } = fakeCaller({ inyectarBorradorRfi: () => box('java.lang.Boolean', 0) });
    await expect(inyectarBorradorF29(call, borrador(XML_OK))).rejects.toThrow(
      'SII no confirmó la presentación',
    );
  });
});

describe('abrirFormularioF29', () => {
  it('opens the URL SII handed over, and fails on a non-200', async () => {
    const ok = new FakePortalSession({ requestText: () => ({ status: 200, body: '<html>' }) });
    await abrirFormularioF29(ok, `${HOSTS.portalApi}/rfiInternet?origen=PROPUESTA`);
    expect(ok.lastTextRequest?.options?.method).toBe('GET');
    const ko = new FakePortalSession({ requestText: () => ({ status: 500, body: '' }) });
    await expect(abrirFormularioF29(ko, `${HOSTS.portalApi}/rfiInternet`)).rejects.toThrow(
      'HTTP 500',
    );
  });
});
