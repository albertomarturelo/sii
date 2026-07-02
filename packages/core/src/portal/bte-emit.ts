// BHE EMISSION (write) — the `TMBECN_*` form-POST flow on loa.sii.cl (ADR-017). Wire contract
// captured live 2026-07-02 (own session, a real boleta issued end-to-end); see
// docs/sii-contract/bte.md § Emisión. NOT a third-party library (ADR-004): every field/endpoint
// below is first-hand-observed and cited.
//
// DISTINCT from the read facade (portal/bte.ts, which reads inline JS maps via goto/evaluate):
// emission is a sequence of AUTHENTICATED FORM POSTS returning HTML, so it goes through the
// `PortalSession.requestForm` seam and parses each response's inline `xml_values` from the HTML
// text (single-quoted `xml_values['k'] = 'v';`, observed). SESSION-KEYED (ADR-005): the emisor is
// the session principal (`rut_arrastre` = `rut_autentificado`); the task rejects a representing
// pointer up front.
//
// Flow (state machine `presionaBoton()` in loa.sii.cl/IMT/js/TMBECN_Emision.js):
//   1. GET  TMBECN_ValidaTimbrajeContrib.cgi?modo=1   — validate authorized to emit
//   2. POST TMBECN_PresentaDatosBoleta.cgi            — the emisor form (source of emisor context)
//   3. POST TMBECN_ConfirmaTimbrajeContrib.cgi (33)   — PREVIEW: server computes retención/líquido
//   4. POST TMBECN_BoletaHonorariosElectronica.cgi(24)— ISSUE: assigns cód. de barras (folio)
// `previewBteEmision` runs 1–3 (never issues); `emitBteEmision` runs 1–4.
import { HOSTS } from '../config/index.js';
import { BteError } from '../errors/index.js';
import type { Rut } from '../rut/index.js';
import type { PortalSession, FormRequest } from '../seams/index.js';
import { comunaInRegion, comunaName, isRegion } from './bte-comunas.js';

const CGI = HOSTS.bheCgi;
const VALIDA_URL = `${CGI}/TMBECN_ValidaTimbrajeContrib.cgi?modo=1`;
const PRESENTA_URL = `${CGI}/TMBECN_PresentaDatosBoleta.cgi`;
const CONFIRMA_URL = `${CGI}/TMBECN_ConfirmaTimbrajeContrib.cgi`;
const EMITE_URL = `${CGI}/TMBECN_BoletaHonorariosElectronica.cgi`;
/** The PDF is fetched by código de barras (observed). */
export const pdfUrl = (codBarras: string): string =>
  `${CGI}/TMBCOT_ConsultaBoletaPdf.cgi?txt_codigobarras=${codBarras}`;

/** Who withholds the PPM retención. `RECEPTOR` (the payer, typically a persona jurídica) →
 *  `RETRECEPTOR`; `EMISOR` (the issuer) → `RETCONTRIBUYENTE`. (observed) */
export type BteRetiene = 'RECEPTOR' | 'EMISOR';
const OPT_RETENCION: Record<BteRetiene, string> = {
  RECEPTOR: 'RETRECEPTOR',
  EMISOR: 'RETCONTRIBUYENTE',
};

/** One prestación line: the service glosa + its GROSS amount (retención is server-computed). */
export interface BteLineaEmision {
  readonly glosa: string;
  readonly monto: number;
}

/** The boleta to emit. The EMISOR fields (domicilio, comuna, actividad) are read from the live
 *  form (step 2) — the caller supplies only the receptor + líneas + fecha + who-withholds. */
export interface BteEmisionInput {
  readonly receptor: Rut;
  readonly receptorNombre: string;
  readonly receptorDomicilio: string;
  readonly region: number; // SII region index 1–16
  readonly comuna: number; // SII comuna code (must belong to `region`)
  readonly lineas: readonly BteLineaEmision[]; // 1..4
  readonly fecha: { dia: number; mes: number; anio: number };
  readonly retiene: BteRetiene;
  /** Show the activity detail on the boleta (`rdb_glosa`). Default true. */
  readonly mostrarDetalle?: boolean;
}

/** The server-computed boleta shown at the preview step (retención/líquido). */
export interface BtePreview {
  readonly totalHonorarios: number | null; // Monto_Boleta
  readonly retencion: number | null; // Monto_Retencion
  readonly liquido: number | null; // Monto_Liquido
  readonly porcentajeRetencion: string | null; // PorcentajeRetencion (the year's vigente rate)
  readonly retiene: BteRetiene;
}

/** An issued boleta: the preview values + the código de barras (the boleta's id) + its PDF. */
export interface BteEmitida extends BtePreview {
  readonly codBarras: string;
  readonly pdfUrl: string;
}

// --- HTML parsing (in-house, no third-party lib — ADR-004) ------------------------
// The TMBECN_* responses embed state as `xml_values['key'] = 'value';` (single quotes,
// variable whitespace — observed 2026-07-02). Amounts on the confirm page are wrapped in
// `formatMiles("<n>", ".")` — we read the raw integer argument.

/** Read a single `xml_values['key'] = '...'` value from the response HTML, or null. */
function xmlValue(html: string, key: string): string | null {
  const re = new RegExp(`xml_values\\['${key}'\\]\\s*=\\s*'([^']*)'`);
  return re.exec(html)?.[1] ?? null;
}

/** Read a `xml_values['key'] = formatMiles("<n>", ...)` integer amount from the confirm page. */
function xmlMonto(html: string, key: string): number | null {
  const re = new RegExp(`xml_values\\['${key}'\\]\\s*=\\s*formatMiles\\("(-?\\d+)"`);
  const m = re.exec(html)?.[1];
  return m === undefined ? null : Number(m);
}

/** The `selected` option value of a `<select name="...">`, else its first option, else null.
 *  The emisor's registered domicilio comes from `cbo_domicilio` this way (its value is the id). */
function selectedOption(html: string, selectName: string): string | null {
  const block = new RegExp(
    `<select[^>]*name=["']?${selectName}["'][^>]*>([\\s\\S]*?)</select>`,
    'i',
  ).exec(html)?.[1];
  if (block === undefined) return null;
  const opts = [...block.matchAll(/<option[^>]*value=["']?([^"'>]*)["']?[^>]*>/gi)];
  const sel = opts.find((o) => /\bselected\b/i.test(o[0]));
  return (sel ?? opts[0])?.[1] ?? null;
}

/** SII rejects (login wall handled by the seam) surface as a `#### errorxxx ####` block or an
 *  alert; a page that carries no emisor form / no `xml_values` is a hard failure. */
function assertEmisorForm(html: string, step: string): void {
  if (!html.includes('xml_values[') && !html.includes('formulario')) {
    throw new BteError(
      `El SII no entregó el formulario de emisión de BHE (paso: ${step}). ` +
        'Verifica que estés autorizado a emitir boletas de honorarios y que la sesión esté viva.',
    );
  }
}

const two = (n: number): string => String(n).padStart(2, '0');

// --- Emisor context (read from the step-2 form) -----------------------------------

interface EmisorCtx {
  readonly diaActual: string;
  readonly mesActual: string;
  readonly anioActual: string;
  readonly cboDomicilio: string;
  readonly comuna: string; // emisor comuna text (txt_comuna)
  readonly telefono: string;
  readonly glosaActividad: string;
}

/** Steps 1–2: validate authorization, then POST for the emisor form and read the emisor context
 *  (own domicilio / comuna / actividad / server date). `rut` is the session principal. */
async function loadEmisorForm(
  session: PortalSession,
  rut: Rut,
): Promise<{ html: string; ctx: EmisorCtx }> {
  // 1. Validate the contribuyente is authorized to emit (liveness + auth). The seam turns a dead
  //    session into SessionExpiredError; a non-form body here is a "not authorized" failure.
  await session.requestForm(VALIDA_URL, { method: 'GET' });
  // 2. Request the emisor form from scratch (prellenar empty → a blank boleta).
  const res = await session.requestForm(PRESENTA_URL, {
    form: {
      rut_arrastre: String(rut.body),
      dv_arrastre: rut.dv,
      prellenar: '',
      ult_boleta: '',
      boleta: '',
    },
  });
  const html = res.body;
  assertEmisorForm(html, 'presentaDatos');
  const now = new Date(); // fallback only; the form's server date wins when present
  const ctx: EmisorCtx = {
    diaActual: xmlValue(html, 'dia_actual') ?? two(now.getDate()),
    mesActual: xmlValue(html, 'mes_actual') ?? two(now.getMonth() + 1),
    anioActual: xmlValue(html, 'anio_actual') ?? String(now.getFullYear()),
    cboDomicilio: selectedOption(html, 'cbo_domicilio') ?? '',
    comuna: xmlValue(html, 'comuna_ctr') ?? '',
    telefono: xmlValue(html, 'fono_ctr') ?? '',
    glosaActividad: xmlValue(html, 'glosa_actividad') ?? '',
  };
  return { html, ctx };
}

/** Build the 33-field confirm payload (step 3) from the emisor context + the caller's boleta.
 *  Field names + shape observed 2026-07-02. Only the used prestación lines carry values;
 *  `cantidad_filas_ingreso` is the form capacity (4). */
function buildConfirmForm(
  rut: Rut,
  ctx: EmisorCtx,
  input: BteEmisionInput,
): Record<string, string> {
  const mostrar = input.mostrarDetalle !== false;
  const form: Record<string, string> = {
    dia_actual: ctx.diaActual,
    mes_actual: ctx.mesActual,
    anio_actual: ctx.anioActual,
    rut_arrastre: String(rut.body),
    dv_arrastre: rut.dv,
    sin_destinatario: 'NO',
    OptTipoRetencion: OPT_RETENCION[input.retiene],
    hdn_muestra_glosa: mostrar ? 'si' : 'no',
    hdn_glosa_actividad: ctx.glosaActividad,
    cantidad_filas_ingreso: '4',
    rdb_glosa: mostrar ? 'si' : 'no',
    cbo_domicilio: ctx.cboDomicilio,
    txt_comuna: ctx.comuna,
    txt_telefono: ctx.telefono,
    txt_fax: '',
    cbo_dia_boleta: two(input.fecha.dia),
    cbo_mes_boleta: two(input.fecha.mes),
    cbo_anio_boleta: String(input.fecha.anio),
    txt_rut_destinatario: String(input.receptor.body),
    txt_dv_destinatario: input.receptor.dv,
    txt_nombres_destinatario: input.receptorNombre,
    txt_domicilio_destinatario: input.receptorDomicilio,
    cod_region: String(input.region),
    cbo_comuna: String(input.comuna),
    txt_comuna_destinatario: comunaName(input.region, input.comuna) ?? '',
  };
  for (let i = 1; i <= 4; i++) {
    const linea = input.lineas[i - 1];
    form[`desc_prestacion_${i}`] = linea ? linea.glosa : '';
    form[`valor_prestacion_${i}`] = linea ? String(linea.monto) : '';
  }
  return form;
}

/** Parse the preview (confirm page) computed amounts. */
function parsePreview(html: string, retiene: BteRetiene): BtePreview {
  return {
    totalHonorarios: xmlMonto(html, 'Monto_Boleta'),
    retencion: xmlMonto(html, 'Monto_Retencion'),
    liquido: xmlMonto(html, 'Monto_Liquido'),
    porcentajeRetencion: xmlValue(html, 'PorcentajeRetencion'),
    retiene,
  };
}

/** Steps 1–3: run to the PREVIEW and return the server-computed boleta WITHOUT issuing.
 *  Returns the parsed preview + the confirm HTML + the confirm form (so `emitBteEmision` can build
 *  the issue payload from the same server state). `session` must be a live PortalSession. */
async function runToPreview(
  session: PortalSession,
  rut: Rut,
  input: BteEmisionInput,
): Promise<{ preview: BtePreview; confirmHtml: string; confirmForm: Record<string, string> }> {
  const { ctx } = await loadEmisorForm(session, rut);
  const confirmForm = buildConfirmForm(rut, ctx, input);
  const res = await session.requestForm(CONFIRMA_URL, { form: confirmForm });
  assertEmisorForm(res.body, 'confirmaTimbraje');
  return { preview: parsePreview(res.body, input.retiene), confirmHtml: res.body, confirmForm };
}

/** PREVIEW an emission: run steps 1–3, return the server-computed retención/líquido. NEVER issues.
 *  Local validation of the input happens in the task BEFORE any session (fail fast). */
export async function previewBteEmision(
  session: PortalSession,
  rut: Rut,
  input: BteEmisionInput,
): Promise<BtePreview> {
  const { preview } = await runToPreview(session, rut, input);
  return preview;
}

/** Build the 24-field issue payload (step 4) from the confirm form + the confirm page's state.
 *  Drops the emisor-only + empty-line fields the confirm carried and adds `origen`, the emisor
 *  email, and the recomputed `CantidadFilas` (= number of used lines). (observed 2026-07-02) */
function buildEmitForm(
  confirmForm: Record<string, string>,
  confirmHtml: string,
  input: BteEmisionInput,
): Record<string, string> {
  const nLineas = String(input.lineas.length);
  const emit: Record<string, string> = {
    dia_actual: confirmForm['dia_actual']!,
    cantidad_filas_ingreso: nLineas,
    mes_actual: confirmForm['mes_actual']!,
    anio_actual: confirmForm['anio_actual']!,
    rut_arrastre: confirmForm['rut_arrastre']!,
    dv_arrastre: confirmForm['dv_arrastre']!,
    OptTipoRetencion: confirmForm['OptTipoRetencion']!,
    cbo_domicilio: confirmForm['cbo_domicilio']!,
    cbo_dia_boleta: confirmForm['cbo_dia_boleta']!,
    cbo_mes_boleta: confirmForm['cbo_mes_boleta']!,
    cbo_anio_boleta: confirmForm['cbo_anio_boleta']!,
    txt_rut_destinatario: confirmForm['txt_rut_destinatario']!,
    txt_dv_destinatario: confirmForm['txt_dv_destinatario']!,
    txt_domicilio_destinatario: confirmForm['txt_domicilio_destinatario']!,
    txt_comuna_destinatario: confirmForm['txt_comuna_destinatario']!,
    hdn_muestra_glosa: confirmForm['hdn_muestra_glosa']!,
    hdn_glosa_actividad: confirmForm['hdn_glosa_actividad']!,
    sin_destinatario: confirmForm['sin_destinatario']!,
    // The emisor's email for the copy — the confirm page carries it; empty if absent.
    txt_email_contribuyente: xmlValue(confirmHtml, 'email_contribuyente') ?? '',
    // `origen=SEPTIMO` marks the "confirmar" (issue) step in SII's flow (observed).
    origen: 'SEPTIMO',
    txt_nombres_destinatario: confirmForm['txt_nombres_destinatario']!,
    CantidadFilas: nLineas,
  };
  for (let i = 1; i <= input.lineas.length; i++) {
    emit[`desc_prestacion_${i}`] = confirmForm[`desc_prestacion_${i}`]!;
    emit[`valor_prestacion_${i}`] = confirmForm[`valor_prestacion_${i}`]!;
  }
  return emit;
}

/** ISSUE the boleta: run steps 1–4. Returns the código de barras (the boleta id) + its PDF URL +
 *  the computed amounts. ⚠️ This CREATES a legally-binding document; the task gates it behind an
 *  explicit confirmation and NEVER retries. */
export async function emitBteEmision(
  session: PortalSession,
  rut: Rut,
  input: BteEmisionInput,
): Promise<BteEmitida> {
  const { preview, confirmHtml, confirmForm } = await runToPreview(session, rut, input);
  const emitForm = buildEmitForm(confirmForm, confirmHtml, input);
  const res = await session.requestForm(EMITE_URL, { form: emitForm });
  const codBarras = xmlValue(res.body, 'cod_barras');
  if (codBarras === null) {
    // No código de barras on the result page → the issue did not complete. Surface it, no retry.
    throw new BteError(
      'El SII no confirmó la emisión de la boleta (no se recibió el código de barras). ' +
        'Revisa en el portal si la boleta quedó emitida antes de reintentar.',
    );
  }
  return { ...preview, codBarras, pdfUrl: pdfUrl(codBarras) };
}

// --- Envío por email (optional, post-issue) ---------------------------------------

const PRESENTA_ENVIO_URL = `${CGI}/TMBECN_PresentaDatosEnvio.cgi`;
const ENVIAR_URL = `${CGI}/TMBECN_EnviarBoleta.cgi`;

export interface BteEnvio {
  readonly codBarras: string;
  readonly email: string;
  /** Also copy the emisor (`OptMandaEmailOrigen=SI`). Default true. */
  readonly copiaEmisor?: boolean;
}

/** Email the issued boleta's PDF to the receptor (optional, post-issue). Reuses the código de
 *  barras; the receptor fields are read from the envío-prep page. (observed 2026-07-02) */
export async function enviarBteEmision(
  session: PortalSession,
  envio: BteEnvio,
): Promise<{ enviado: boolean }> {
  const prep = await session.requestForm(PRESENTA_ENVIO_URL, {
    form: { origen: 'OCTAVO', txt_codigo_barra: envio.codBarras },
  });
  const html = prep.body;
  const form: FormRequest['form'] = {
    txt_rut_destinatario: xmlValue(html, 'rut_destinatario') ?? '',
    txt_dv_destinatario: xmlValue(html, 'dv_destinatario') ?? '',
    txt_cod_39: xmlValue(html, 'codigo_inferior') ?? '',
    txt_codigo_barra: envio.codBarras,
    txt_descr_comuna: xmlValue(html, 'desc_comuna') ?? '',
    origen: 'NOVENO',
    txt_nombre_receptor: xmlValue(html, 'nombres_destinatario') ?? '',
    txt_email: envio.email,
    OptMandaEmailOrigen: envio.copiaEmisor === false ? 'NO' : 'SI',
  };
  const res = await session.requestForm(ENVIAR_URL, { form });
  return { enviado: /enviado/i.test(res.body) };
}

// --- Local input validation (before any SII call) ---------------------------------

/** Validate a region/comuna pair against the ported SII table. */
export function assertRegionComuna(region: number, comuna: number): void {
  if (!isRegion(region)) {
    throw new BteError(`Región inválida: ${region} (esperado 1–16, código interno del SII).`);
  }
  if (!comunaInRegion(region, comuna)) {
    throw new BteError(
      `La comuna ${comuna} no pertenece a la región ${region} (usa el código de comuna del SII).`,
    );
  }
}
