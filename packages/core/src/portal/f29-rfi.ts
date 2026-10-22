// The F29 form app's GWT-RPC transport (rfiInternet `formularioFacade`, protocol 7) — the
// submit chain of the ADR-029 amendment. Observed 2026-10-19 (spike #138; wire contract:
// sii-contract/f29.md § Submit): every call is a cold authenticated POST through
// `PortalSession.requestText`, entered after the propuesta handoff. The policy strong-name and
// the type signatures come from the live permutation (`loadGwtPermutation`), the field layouts
// from `rfi-schema.ts`. The chain itself (which calls, in which order) is #161's.
import { HOSTS } from '../config/index.js';
import { F29Error } from '../errors/index.js';
import type { PortalSession } from '../seams/index.js';
import {
  Gwt7Codec,
  type Gwt7Node,
  type Gwt7Param,
  type Gwt7Value,
  type GwtModuleRef,
  postGwt7,
} from './gwt.js';
import { RFI_READ_LAYOUT, RFI_WRITE_LAYOUT } from './rfi-schema.js';
import type { Periodo } from '../periodo/index.js';
import type { Rut } from '../rut/index.js';
import { type CodigoF29, F29_TIPO_PROPUESTA } from './f29.js';
import { type F29CampoValor, f29CampoValores, fillF29Form } from './f29-rfi-form.js';

/** rfiInternet's module and the form service's entry point (observed 2026-10-19). */
export const RFI_FORMULARIO: GwtModuleRef = {
  moduleBase: `${HOSTS.portalApi}/rfiInternet/`,
  nocache: 'rfi.nocache.js',
  entryPoint: 'formularioFacade',
};
const FORMULARIO_SERVICE = 'cl.sii.sdi.dim.rfi.web.client.service.FormularioFacade';

const f29Error = (message: string): Error => new F29Error(message);

/** Call one `FormularioFacade` method and decode its result. `returns` is the method's declared
 *  return type when it is not an object (`java.lang.String`, a primitive code, `V`). `heal`
 *  (default on) re-reads the permutation once if SII refuses the policy, which it does before
 *  running the method. A `//EX` is raised verbatim as an `F29Error`; never retried. */
export async function callFormularioFacade(
  session: PortalSession,
  method: string,
  params: readonly Gwt7Param[],
  opts: { returns?: string; heal?: boolean } = {},
): Promise<Gwt7Value> {
  let codec: Gwt7Codec | undefined;
  const text = await postGwt7(
    session,
    RFI_FORMULARIO,
    (perm) => {
      codec = new Gwt7Codec(
        { write: RFI_WRITE_LAYOUT, read: RFI_READ_LAYOUT },
        perm.sigs,
        f29Error,
      );
      return codec.encodeRequest({
        moduleBase: RFI_FORMULARIO.moduleBase,
        policy: perm.policies[RFI_FORMULARIO.entryPoint]!,
        service: FORMULARIO_SERVICE,
        method,
        params,
      });
    },
    f29Error,
    opts.heal === undefined ? {} : { heal: opts.heal },
  );
  return codec!.decodeResponse(text, opts.returns);
}

// ── The submit chain (#161, ADR-029 amendment; sii-contract/f29.md § Submit) ─────────────────
// Every step below was rebuilt from the previous responses and compared byte for byte with the
// browser's request on both private captures (run5, run6; 2026-10-21). Values are taxpayer data:
// nothing here logs them, and no error message carries an amount.

/** One `FormularioFacade` call. The chain takes it as a parameter so its tests can answer with
 *  synthetic graphs; production binds it to the session with `rfiCaller`. */
export type RfiCaller = (
  method: string,
  params: readonly Gwt7Param[],
  opts?: { returns?: string },
) => Promise<Gwt7Value>;

export const rfiCaller =
  (session: PortalSession): RfiCaller =>
  (method, params, opts) =>
    callFormularioFacade(session, method, params, opts ?? {});

const CLS = {
  string: 'java.lang.String',
  integer: 'java.lang.Integer',
  boolean: 'java.lang.Boolean',
  hashMap: 'java.util.HashMap',
  formulario: 'cl.sii.sdi.dim.rfi.to.Formulario',
  periodo: 'cl.sii.sdi.dim.rfi.to.Periodo',
  contribuyente: 'cl.sii.sdi.core.web.shared.to.SdiContribuyenteTo',
  resultadoContribuyente: 'cl.sii.sdi.dim.rfi.web.client.to.ResultadoRecuperarContribuyenteTo',
  layout: 'cl.sii.sdi.difm.rcs.web.client.to.FormularioLayoutTO',
  borradorRfi: 'cl.sii.sdi.dim.rfi.to.BorradorRfi',
  borrador: 'cl.sii.sdi.dim.rfi.to.Borrador',
} as const;
/** rfi `Formulario`: 0 a Boolean the client sets before reading the borrador, 10 the form código
 *  (`"029"`), 27 the int tipo de propuesta. */
const FORMULARIO = { flag: 0, codigo: 10, tipo: 27 } as const;
const F29_CODIGO = '029';
/** rfi `Periodo`: [año, mes] as Integers. */
const PERIODO = { anno: 0, mes: 1 } as const;
/** `Borrador`: 9 the FormularioRfi XML SII would file, 27 the tipo (Integer; 40 validated, 41 to
 *  save), 28 an integrity value that is never touched. */
const BORRADOR = { xml: 9, tipo: 27 } as const;
/** `guardarBorradorRfiValidado` takes the validated borrador with its tipo 40 → 41. */
const TIPO_GUARDAR = 41;

const box = (cls: string, v: number): Gwt7Node => ({ cls, values: [v] });
const roto = (what: string): F29Error =>
  new F29Error(`No se pudo interpretar el formulario de SII (scraper roto): ${what}.`);
const isNode = (v: Gwt7Value | undefined): v is Gwt7Node =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
function nodeOf(v: Gwt7Value | undefined, cls: string, what: string): Gwt7Node {
  if (!isNode(v) || v.cls !== cls) throw roto(`${what} no es ${cls.split('.').pop()}`);
  return v;
}
/** A Java array node's elements of class `cls`. */
function arrayOf(v: Gwt7Value, cls: string, what: string): Gwt7Node[] {
  if (!isNode(v) || v.cls !== `[L${cls};`) throw roto(`${what} no es una lista`);
  return v.values.map((x, k) => nodeOf(x, cls, `${what}[${k}]`));
}
const boxed = (v: Gwt7Value | undefined): Gwt7Value | undefined =>
  isNode(v) && v.values.length === 1 ? v.values[0] : v;
/** A HashMap<String, String> (consultarHijoToken's answer) as a plain record. */
function stringMap(v: Gwt7Value, what: string): Map<string, string | null> {
  const m = nodeOf(v, CLS.hashMap, what);
  const entries = m.values[0];
  if (!Array.isArray(entries)) throw roto(what);
  const out = new Map<string, string | null>();
  for (const e of entries) {
    if (!Array.isArray(e) || e.length !== 2) throw roto(what);
    const k = boxed(e[0]);
    const val = boxed(e[1]);
    if (typeof k !== 'string') throw roto(what);
    out.set(k, typeof val === 'string' ? val : null);
  }
  return out;
}

/** Open the form app at the URL `enviarDatosFlujo` answered (a 302 into rfiInternet). A landing
 *  on the login raises `SessionExpiredError` in the seam. */
export async function abrirFormularioF29(session: PortalSession, url: string): Promise<void> {
  const r = await session.requestText(url, { method: 'GET' });
  if (r.status !== 200) {
    throw new F29Error(`SII no abrió el formulario del F29 (HTTP ${r.status}).`);
  }
}

/** What SII validated: the borrador it would file, and the códigos it declares. */
export interface F29BorradorValidado {
  /** The validated `Borrador`, sent back by the submit. Taxpayer data. */
  readonly borrador: Gwt7Node;
  /** The declared códigos (`tipo` D and R) with a non-zero value, by código. */
  readonly declarados: ReadonlyMap<string, number>;
  /** Código 91, TOTAL A PAGAR DENTRO DEL PLAZO, as SII validated it (0 when absent). */
  readonly total: number;
  /** Every campo of the filled form (the interpreter's output). */
  readonly campos: readonly F29CampoValor[];
}

/** Run the form app from the handoff to SII's validation, as the browser does in mode
 *  PPTA-F29-COMPLETA. It stops BEFORE `guardarBorradorRfiValidado`: nothing is filed or saved
 *  past the propuesta's borrador. `hoy` is the moment of the fill (the `Clock`'s now). */
export async function validarBorradorF29(
  call: RfiCaller,
  params: { rut: Rut; periodo: Periodo; hoy: Date },
): Promise<F29BorradorValidado> {
  const { rut, periodo, hoy } = params;
  const periodoYm = `${periodo.year}${String(periodo.month).padStart(2, '0')}`;

  // The flow's parameters, stored by the handoff. idBorrador is new for every flow.
  const hijo = stringMap(
    await call('consultarHijoToken', [{ type: CLS.string, value: 'PARAM_PROPUESTA' }]),
    'consultarHijoToken',
  );
  if (hijo.get('rut') !== String(rut.body) || hijo.get('periodo') !== periodoYm) {
    throw new F29Error(
      'SII abrió el formulario para otro contribuyente o período; no se continuó. ' +
        'Vuelve a intentarlo desde `sii f29 submit`.',
    );
  }
  const idBorrador = Number(hijo.get('idBorrador'));
  if (!Number.isSafeInteger(idBorrador) || idBorrador <= 0) throw roto('idBorrador');

  const resultado = nodeOf(
    await call('getContribuyente', [
      { type: CLS.integer, value: box(CLS.integer, rut.body) },
      { type: CLS.string, value: rut.dv },
    ]),
    CLS.resultadoContribuyente,
    'getContribuyente',
  );
  const contribuyente = nodeOf(resultado.values[0], CLS.contribuyente, 'contribuyente');

  const formulario = arrayOf(
    await call('findAllFormulario', []),
    CLS.formulario,
    'findAllFormulario',
  ).find((f) => f.values[FORMULARIO.codigo] === F29_CODIGO);
  if (formulario === undefined) throw roto('SII no ofrece el Formulario 29');

  const periodoRfi = arrayOf(
    await call('findPeriodoHabilitado', [{ type: CLS.formulario, value: formulario }]),
    CLS.periodo,
    'findPeriodoHabilitado',
  ).find(
    (p) =>
      boxed(p.values[PERIODO.anno]) === periodo.year &&
      boxed(p.values[PERIODO.mes]) === periodo.month,
  );
  if (periodoRfi === undefined) {
    throw new F29Error(`SII no habilita el período ${periodo.formatted} para declarar.`);
  }

  // The client marks the Formulario before it reads the borrador (both captures).
  formulario.values[FORMULARIO.flag] = box(CLS.boolean, 1);
  formulario.values[FORMULARIO.tipo] = F29_TIPO_PROPUESTA;
  const layout = nodeOf(
    await call('findVersionBorradorById', [
      { type: CLS.formulario, value: formulario },
      { type: CLS.periodo, value: periodoRfi },
      { type: CLS.contribuyente, value: contribuyente },
      { type: CLS.contribuyente, value: contribuyente },
      { type: CLS.integer, value: box(CLS.integer, idBorrador) },
    ]),
    CLS.layout,
    'findVersionBorradorById',
  );

  const { reglasFallidas } = fillF29Form(layout, hoy);
  if (reglasFallidas.length > 0) {
    // SII's client stops here and shows its rules' messages; so do we, verbatim, before
    // validating anything.
    throw new F29Error(
      `El formulario no cumple las reglas de SII: ${reglasFallidas.map((r) => r.mensaje).join(' ')}`,
    );
  }
  const campos = f29CampoValores(layout, hoy);

  // The client sets these two flow parameters right before it validates (both captures).
  await call('crearHijoToken', [
    { type: CLS.string, value: 'URL_RETORNO' },
    { type: CLS.string, value: '-' },
  ]);
  await call('crearHijoToken', [
    { type: CLS.string, value: 'ORIGEN' },
    { type: CLS.string, value: 'PROPUESTA' },
  ]);

  const validado = nodeOf(
    await call('getBorradorRfiValidado', [
      { type: CLS.integer, value: box(CLS.integer, F29_TIPO_PROPUESTA) },
      { type: CLS.formulario, value: formulario },
      { type: CLS.periodo, value: periodoRfi },
      { type: CLS.contribuyente, value: contribuyente },
      { type: CLS.contribuyente, value: contribuyente },
      { type: CLS.layout, value: layout },
    ]),
    CLS.borradorRfi,
    'getBorradorRfiValidado',
  );
  // BorradorRfi holds two Borrador; the browser saves the first (run6).
  const borrador = nodeOf(validado.values[0], CLS.borrador, 'BorradorRfi');
  const xml = borrador.values[BORRADOR.xml];
  if (typeof xml !== 'string') throw roto('el borrador no trae el formulario');
  const declarados = codigosDeclarados(xml);
  return { borrador, declarados, total: declarados.get('91') ?? 0, campos };
}

/** The FormularioRfi XML's declared códigos: `<Codigos tipo="D|R"><Codigo>…<Valor>…`. Only D
 *  (montos) and R (the result, 91) are read; E (the header: nombre, RUT, dirección) and N
 *  (SII-internal) are never read. Observed in the validated borrador, 2026-10-19. */
export function codigosDeclarados(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  const bloques = [...xml.matchAll(/<Codigos\b([^>]*)>([\s\S]*?)<\/Codigos>/g)];
  if (bloques.length === 0) throw roto('el borrador no trae códigos');
  for (const m of bloques) {
    const tipo = /\btipo="([A-Z])"/.exec(m[1]!)?.[1];
    if (tipo !== 'D' && tipo !== 'R') continue;
    const codigo = /<Codigo>\s*(\d+)\s*<\/Codigo>/.exec(m[2]!)?.[1];
    const valor = /<Valor>\s*([^<]*?)\s*<\/Valor>/.exec(m[2]!)?.[1] ?? '';
    if (codigo === undefined) throw roto('un código sin número');
    const n = valor === '' ? 0 : Number(valor);
    if (!Number.isFinite(n)) throw roto(`el valor del código ${Number(codigo)}`);
    if (n !== 0) out.set(String(Number(codigo)), n);
  }
  return out;
}

/** Why a código of SII's validated borrador disagrees with what the propuesta implies. */
export type F29MotivoDesacuerdo =
  | 'falta' // the propuesta or a formula gives it a value; the borrador does not declare it
  | 'distinto' // declared with another value
  | 'sobra' // declared, but neither the propuesta nor a formula produces it (a stale value)
  | 'formula_vs_propuesta'; // the formula's value and the propuesta's differ
export interface F29Desacuerdo {
  readonly codigo: string;
  readonly motivo: F29MotivoDesacuerdo;
}

/** ADR-029's safety rule: SII's "no presenta errores" is not proof of completeness. Compare the
 *  códigos SII validated against the propuesta and the formulas' results. Any entry refuses the
 *  submit. Amounts never leave this function. */
export function verificarBorradorF29(
  propuesta: readonly CodigoF29[],
  campos: readonly F29CampoValor[],
  declarados: ReadonlyMap<string, number>,
): F29Desacuerdo[] {
  const out: F29Desacuerdo[] = [];
  const esperado = new Map<string, number>();
  for (const c of campos) {
    if (!c.formula || !/^\d+$/.test(c.codigo) || c.valor.trim() === '') continue;
    const v = Number(c.valor);
    if (Number.isFinite(v) && v !== 0) esperado.set(String(Number(c.codigo)), v);
  }
  for (const c of propuesta) {
    if (!/^\d+$/.test(c.codigo) || c.valor === null || c.valor === 0) continue;
    const codigo = String(Number(c.codigo));
    const f = esperado.get(codigo);
    if (f !== undefined && f !== c.valor) out.push({ codigo, motivo: 'formula_vs_propuesta' });
    esperado.set(codigo, c.valor);
  }
  for (const [codigo, v] of esperado) {
    const d = declarados.get(codigo);
    if (d === undefined) out.push({ codigo, motivo: 'falta' });
    else if (d !== v) out.push({ codigo, motivo: 'distinto' });
  }
  for (const codigo of declarados.keys()) {
    if (!esperado.has(codigo)) out.push({ codigo, motivo: 'sobra' });
  }
  return out.sort((a, b) => Number(a.codigo) - Number(b.codigo));
}

/** Submit, call 1: save the validated borrador with tipo 41. Saves, does NOT file. Returns the
 *  `Borrador` SII answers, which call 2 sends unchanged. */
export async function guardarBorradorF29(call: RfiCaller, borrador: Gwt7Node): Promise<Gwt7Node> {
  borrador.values[BORRADOR.tipo] = box(CLS.integer, TIPO_GUARDAR);
  return nodeOf(
    await call('guardarBorradorRfiValidado', [{ type: CLS.borrador, value: borrador }]),
    CLS.borrador,
    'guardarBorradorRfiValidado',
  );
}

/** Submit, call 2: `inyectarBorradorRfi` FILES the declaración. Called once, never retried. SII
 *  answered `//OK[1,1,["java.lang.Boolean/…"],0,7]` (true) on the filing of 2026-09. */
export async function inyectarBorradorF29(call: RfiCaller, guardado: Gwt7Node): Promise<void> {
  const r = await call('inyectarBorradorRfi', [{ type: CLS.borrador, value: guardado }]);
  if (boxed(r ?? undefined) !== 1) {
    throw new F29Error('SII no confirmó la presentación del F29.');
  }
}
