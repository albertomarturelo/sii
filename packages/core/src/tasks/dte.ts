// Public DTE task API the surfaces call (ADR-003) — the WHOLE `dte` artifact (ADR-024):
// `dteAuthorized` (public, login-free, palena — ADR-014) at the bottom, and the MIPYME portal
// surface (borradores + emitidos, empresa-keyed — ADR-023) below this header.
//
// The MIPYME half — BORRADORES ONLY: it creates, lists, previews and deletes DRAFT facturas in the SII's free facturación
// portal. It NEVER signs or emits a DTE (ADR-023): the portal's `mipeGenXMLFirma.cgi` step is
// out of scope, so nothing here can produce a legally-binding document.
//
// EMPRESA-KEYED (ADR-023). Unlike RCV (body-RUT) or F22 (session-keyed), the MIPYME portal has
// its OWN authorization list — the empresas that registered this user as "usuario autorizado",
// read live from `mipeSelEmpresa.cgi`. So `empresa` is validated against THAT list, not the
// operate pointer's operable set, and every task selects the empresa before acting.
//
// PII: a factura is receptor + emisor identity end to end, so rows are CURATED with NO `raw`
// (ADR-004), and the audit receipt carries only the empresa RUT, the borrador id and counts —
// never the receptor, the montos or the item glosas (ADR-006).
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { Rut } from '../rut/index.js';
import { fetchDteAutorizados } from '../portal/dte-public.js';
import type { DteAutorizados } from '../portal/dte-public.js';
import { DteError, SiiError, ValidationError } from '../errors/index.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import {
  FORMA_PAGO,
  MAX_ITEMS,
  TIPOS_DTE,
  fetchBorradores,
  fetchEmitidaPdf,
  fetchEmitidas,
  fetchEmpresas,
  fetchPreviewPdf,
  fillFactura,
  eliminaBorrador,
  grabaBorrador,
  isTipoDte,
  loadBorrador,
  resolveAndSelectEmpresa,
} from '../portal/dte-mipyme.js';
import type {
  DteEmitido,
  DteEmitidosFiltro,
  DteSelectAviso,
  DteBorradorInput,
  DteBorradorRow,
  DteEmpresa,
  DteItem,
  DteTotales,
  FormaPago,
  TipoDte,
} from '../portal/dte-mipyme.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type {
  DteEmitido,
  DteEmitidosFiltro,
  EstadoEmitido,
  DteSelectAviso,
  DteBorradorRow,
  DteEmpresa,
  DteItem,
  DteTotales,
  FormaPago,
  TipoDte,
} from '../portal/dte-mipyme.js';
export { TIPOS_DTE, MAX_ITEMS } from '../portal/dte-mipyme.js';
export type { DteAutorizados, DteAutorizado } from '../portal/dte-public.js';

/** How far `dtePdf` walks the emitted listing when it is addressed by SII's internal
 *  `codigo`, which has no server-side filter (a `folio` does, so it needs one page). Bounded so
 *  a wrong codigo costs a known number of round trips, not an unbounded crawl (ADR-004). */
const MAX_PAGINAS_EMITIDAS = 20;

/** Inter-call pace (ms) between consecutive POSTs to SII. The MIPYME CGIs are the legacy,
 *  session-stateful kind and were observed to start timing out under a fast sequence, so this
 *  floors at 1000 ms rather than deriving a smaller value from `rateLimitRps`. Writes are NEVER
 *  retried (ADR-004); see `readOnlyRetry` for the read-only exception. */
const PACE_MS = 1000;
const pacingMs = (): number => Math.max(PACE_MS, Math.round(1000 / DEFAULT_SETTINGS.rateLimitRps));

/** A transport failure that never reached SII's application layer — the connection timed out or
 *  was reset. Deliberately NOT status-derived:
 *
 *  * **429 is excluded.** CONVENTIONS is explicit — "Never retry after a SII rate-limit / block.
 *    It is server-side and timed; surface the message verbatim and stop." A 429 IS that signal,
 *    so retrying it is the forbidden behaviour, not an exception this module gets to make.
 *  * **5xx is excluded too**, because at this layer there is no status code to key off: the
 *    seams surface transport failures as `Error`, and sniffing `\b5\d{2}\b` out of prose would
 *    retry any message that happens to contain a three-digit number. Matching on prose is
 *    fragile, so the check keys off Playwright's structured `TimeoutError` name plus the two
 *    connection-level codes Node puts in `message`.
 *
 *  Anything that reached SII — a business rejection, a validation failure, an unexpected HTML
 *  body, a dead session — is surfaced immediately (ADR-004). */
function isTransportFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e instanceof SiiError) return false; // reached SII: never retried
  return e.name === 'TimeoutError' || /ECONNRESET|ECONNREFUSED|socket hang up/i.test(e.message);
}

/** Retry a READ-ONLY call at most twice, and ONLY on a transport failure (above). Never on a
 *  write, a validation error, or anything SII answered. Backoff is exponential with jitter so
 *  concurrent callers do not resonate; the jitter is derived from the `Clock` seam rather than
 *  a nondeterministic source, so the core stays deterministic under a fake clock (ADR-003). */
async function readOnlyRetry<T>(runtime: Runtime, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isTransportFailure(e) || attempt === 2) throw e;
      const jitter = runtime.clock.now().getTime() % 250;
      await runtime.clock.sleep(PACE_MS * 2 ** attempt + jitter);
    }
  }
  throw lastError;
}

function audit(runtime: Runtime, action: string, result: string, extra: Partial<AuditEntry>): void {
  recordAudit(runtime, { action, result, ...extra });
}

/** What a surface passes in. Everything is validated LOCALLY here, before any session. */
export interface DteBorradorArgs {
  readonly empresa: string; // emisor RUT (Mod-11 checked locally)
  readonly tipoDte?: number; // default 33
  readonly fechaEmision?: string; // YYYY-MM-DD, default today
  readonly ciudadEmisor: string;
  readonly receptor: {
    readonly rut: string;
    readonly razonSocial: string;
    readonly direccion: string;
    readonly comuna: string;
    readonly ciudad: string;
    readonly giro: string;
    readonly contacto?: string;
  };
  readonly items: readonly DteItem[];
  readonly formaPago?: FormaPago; // default 'credito'
  /** Set to UPDATE an existing borrador in place; omit to create a new one. */
  readonly borradorId?: string;
}

/** The result of saving a borrador: SII's own totals plus the borrador's id. */
export interface DteBorradorSaved {
  readonly id: string | null;
  readonly empresa: DteEmpresa;
  readonly tipoDte: TipoDte;
  readonly tipoDteDesc: string;
  readonly actualizado: boolean;
  readonly totales: DteTotales;
  /** <select> fields where SII kept its own option; each lists the options it offers. */
  readonly avisos: readonly DteSelectAviso[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const todayIso = (runtime: Runtime): string => {
  const d = runtime.clock.now();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function assertTipo(tipo: number | undefined): TipoDte {
  const t = tipo ?? 33;
  if (!isTipoDte(t)) {
    throw new ValidationError(
      `Tipo de DTE no soportado: ${t}. Disponibles: ${Object.entries(TIPOS_DTE)
        .map(([k, v]) => `${k} (${v})`)
        .join(', ')}.`,
    );
  }
  return t;
}

/** Validate + normalize into the facade's input. Throws BEFORE any SII call so a malformed
 *  document never costs a round trip (the Mod-11-before-submit rule, ADR-004). */
function validate(
  runtime: Runtime,
  args: DteBorradorArgs,
): {
  empresa: Rut;
  tipoDte: TipoDte;
  input: Omit<DteBorradorInput, 'empresa'>;
} {
  const empresa = Rut.parse(args.empresa);
  const receptor = Rut.parse(args.receptor.rut);
  const tipoDte = assertTipo(args.tipoDte);
  const fechaEmision = args.fechaEmision ?? todayIso(runtime);
  if (!ISO_DATE.test(fechaEmision)) {
    throw new ValidationError(`Fecha de emisión inválida: "${fechaEmision}" (formato YYYY-MM-DD).`);
  }
  if (args.ciudadEmisor.trim() === '') {
    // SII leaves this blank on the form yet its own validator demands it (observed 2026-09-08).
    throw new ValidationError(
      'Falta la ciudad del emisor: el SII la exige pero no la trae precargada en el formulario.',
    );
  }
  if (args.items.length === 0 || args.items.length > MAX_ITEMS) {
    throw new ValidationError(`La factura necesita entre 1 y ${MAX_ITEMS} líneas de detalle.`);
  }
  args.items.forEach((it, i) => {
    const n = i + 1;
    if (it.nombre.trim() === '') throw new ValidationError(`Línea ${n}: falta el nombre del ítem.`);
    if (!Number.isFinite(it.cantidad) || it.cantidad <= 0) {
      throw new ValidationError(`Línea ${n}: cantidad debe ser un número positivo.`);
    }
    if (!Number.isInteger(it.precioUnitario) || it.precioUnitario <= 0) {
      throw new ValidationError(`Línea ${n}: precio unitario debe ser un entero positivo.`);
    }
    const d = it.descuentoPct;
    if (d !== undefined && (!Number.isFinite(d) || d < 0 || d >= 100)) {
      throw new ValidationError(`Línea ${n}: descuento debe estar entre 0 y 99 (%).`);
    }
  });
  const formaPago = args.formaPago ?? 'credito';
  if (!(formaPago in FORMA_PAGO)) {
    throw new ValidationError(
      `Forma de pago inválida: "${formaPago}" (usa ${Object.keys(FORMA_PAGO).join(', ')}).`,
    );
  }
  return {
    empresa,
    tipoDte,
    input: {
      tipoDte,
      fechaEmision,
      ciudadEmisor: args.ciudadEmisor.trim(),
      receptor: {
        rut: String(receptor.body),
        dv: receptor.dv,
        razonSocial: args.receptor.razonSocial,
        direccion: args.receptor.direccion,
        comuna: args.receptor.comuna,
        ciudad: args.receptor.ciudad,
        giro: args.receptor.giro,
        ...(args.receptor.contacto ? { contacto: args.receptor.contacto } : {}),
      },
      items: args.items,
      formaPago,
      ...(args.borradorId ? { borradorId: args.borradorId } : {}),
    },
  };
}

/** The empresas this user may invoice for in the MIPYME portal — the live authorized list.
 *  Read-only; this is what a surface offers when the user has not picked an `--empresa`. */
export async function dteEmpresas(
  runtime: Runtime,
  args: { tipoDte?: number } = {},
): Promise<DteEmpresa[]> {
  const tipoDte = assertTipo(args.tipoDte);
  try {
    // The retry wraps the READ only. Wrapping `withSession` would tear down and rebuild the
    // browser context on every attempt — and, worse, replay `mipeSelEmpresa.cgi`, which is
    // server-side session state, not a read.
    const res = await withSession(runtime, (session) =>
      readOnlyRetry(runtime, () =>
        fetchEmpresas(session, tipoDte, () => runtime.clock.sleep(pacingMs())),
      ),
    );
    audit(runtime, 'dte_empresas', 'ok', { count: res.length });
    return res;
  } catch (e) {
    audit(runtime, 'dte_empresas', 'failed', {});
    throw e;
  }
}

/** The saved borradores of `empresa`. Curated rows, no `raw` (they are receptor PII). */
export async function dteBorradorList(
  runtime: Runtime,
  args: { empresa: string; tipoDte?: number },
): Promise<{ empresa: DteEmpresa; borradores: DteBorradorRow[] }> {
  const empresa = Rut.parse(args.empresa);
  const tipoDte = assertTipo(args.tipoDte);
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session) => {
      const emp = await resolveAndSelectEmpresa(session, empresa, tipoDte, () =>
        runtime.clock.sleep(pacingMs()),
      );
      await runtime.clock.sleep(pacingMs());
      // retry the READ only — never the empresa selection, which mutates session state
      return {
        empresa: emp,
        borradores: await readOnlyRetry(runtime, () => fetchBorradores(session)),
      };
    });
    audit(runtime, 'dte_borrador_list', 'ok', {
      rut: empresa.canonical,
      count: res.borradores.length,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'dte_borrador_list', 'failed', { rut: empresa.canonical });
    throw e;
  }
}

/** Create (or, with `borradorId`, update) a borrador. The document is validated by SII's OWN
 *  client-side validator first, so a rejection surfaces SII's Spanish message verbatim and
 *  costs no write. The new id is resolved by diffing the borradores list around the save —
 *  `mipeGrabaBorrador.cgi` returns only a confirmation page (observed). */
export async function dteBorradorSave(
  runtime: Runtime,
  args: DteBorradorArgs,
): Promise<DteBorradorSaved> {
  const { empresa, tipoDte, input } = validate(runtime, args);
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session) => {
      const emp = await resolveAndSelectEmpresa(session, empresa, tipoDte, () =>
        runtime.clock.sleep(pacingMs()),
      );
      const before = input.borradorId ? [] : (await fetchBorradores(session)).map((b) => b.id);
      await runtime.clock.sleep(pacingMs());
      const filled = await fillFactura(session, emp, { ...input, empresa: emp.rut });
      await runtime.clock.sleep(pacingMs());
      await grabaBorrador(session, filled); // a WRITE — never retried (ADR-004)
      await runtime.clock.sleep(pacingMs());
      const id = input.borradorId
        ? input.borradorId
        : ((await fetchBorradores(session)).find((b) => !before.includes(b.id))?.id ?? null);
      return {
        id,
        empresa: emp,
        tipoDte,
        tipoDteDesc: TIPOS_DTE[tipoDte],
        actualizado: input.borradorId !== undefined,
        totales: filled.totales,
        avisos: filled.avisos,
      };
    });
    // Audit the WRITE with identifiers only — never the receptor, montos or glosas (ADR-006).
    audit(runtime, 'dte_borrador_save', 'ok', {
      rut: empresa.canonical,
      borradorId: res.id,
      tipoDte,
      items: input.items.length,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'dte_borrador_save', 'failed', { rut: empresa.canonical, tipoDte });
    throw e; // never retried after a SII error (ADR-004)
  }
}

/** Delete a borrador. Irreversible on SII's side, so the surfaces gate it behind a confirm. */
export async function dteBorradorDelete(
  runtime: Runtime,
  args: { empresa: string; borradorId: string; tipoDte?: number },
): Promise<{ empresa: DteEmpresa; borradorId: string; tipoDte: TipoDte; eliminado: true }> {
  const empresa = Rut.parse(args.empresa);
  // `tipoDte` is only a HINT here: the listing knows each borrador's real type, and deleting is
  // the one irreversible operation — navigating with the wrong PTDC_CODIGO would fail
  // confusingly. So resolve it from the listing and only fall back to the argument.
  const hinted = assertTipo(args.tipoDte);
  if (!/^\d+$/.test(args.borradorId)) {
    throw new ValidationError(`Id de borrador inválido: "${args.borradorId}" (son dígitos).`);
  }
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session) => {
      const emp = await resolveAndSelectEmpresa(session, empresa, hinted, () =>
        runtime.clock.sleep(pacingMs()),
      );
      await runtime.clock.sleep(pacingMs());
      const row = (await fetchBorradores(session)).find((b) => b.id === args.borradorId);
      if (!row) {
        throw new DteError(
          `El borrador ${args.borradorId} no existe en ${emp.rut}. Revisa \`dte borrador list\`.`,
        );
      }
      const tipoDte = isTipoDte(row.tipoDte) ? row.tipoDte : hinted;
      await runtime.clock.sleep(pacingMs());
      const filled = await loadBorrador(session, emp, tipoDte, args.borradorId);
      await runtime.clock.sleep(pacingMs());
      await eliminaBorrador(session, filled); // a WRITE — never retried (ADR-004)
      return { empresa: emp, borradorId: args.borradorId, tipoDte, eliminado: true as const };
    });
    audit(runtime, 'dte_borrador_delete', 'ok', {
      rut: empresa.canonical,
      borradorId: args.borradorId,
      tipoDte: res.tipoDte,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'dte_borrador_delete', 'failed', {
      rut: empresa.canonical,
      borradorId: args.borradorId,
    });
    throw e;
  }
}

/** A produced document, as the ADR-022 contract requires: a DESCRIPTOR, never the bytes. The
 *  PDF is PII-dense (both parties' identity + the amounts), so it must not enter the LLM's
 *  context — the caller reads the file from disk. */
export interface DtePreviewDoc {
  readonly path: string;
  readonly archivo: string;
  readonly bytes: number;
  readonly contentType: 'application/pdf';
  readonly totales: DteTotales;
  readonly empresa: DteEmpresa;
  readonly tipoDte: TipoDte;
  readonly avisos: readonly DteSelectAviso[];
}

/** The "Validar y visualizar" PDF of a document that has NOT been emitted — stamped
 *  "VISTA PREVIA / DOCUMENTO NO VALIDO", no folio. Builds the document from `args` (an existing
 *  borrador can be re-previewed by passing its `borradorId`), fetches SII's PDF and writes it
 *  through the `FileSink` seam. `directorio` is REQUIRED: the pure core cannot know `$HOME`,
 *  so each surface applies its own default (ADR-022). */
export async function dtePreviewPdf(
  runtime: Runtime,
  args: DteBorradorArgs & { directorio: string },
): Promise<DtePreviewDoc> {
  const { empresa, tipoDte, input } = validate(runtime, args);
  const files = runtime.files;
  if (!files) {
    throw new DteError(
      'Este runtime no tiene un FileSink configurado, así que no puede escribir el PDF. ' +
        'Usa `createNodeRuntime()` o inyecta `files`.',
    );
  }
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session) => {
      const emp = await resolveAndSelectEmpresa(session, empresa, tipoDte, () =>
        runtime.clock.sleep(pacingMs()),
      );
      await runtime.clock.sleep(pacingMs());
      const filled = await fillFactura(session, emp, { ...input, empresa: emp.rut });
      await runtime.clock.sleep(pacingMs());
      const bytes = await fetchPreviewPdf(session, filled, () => runtime.clock.sleep(pacingMs()));
      // SII's own Content-Disposition is generic and carries no receptor/fecha, so compose the
      // name here (ADR-022): deterministic, so re-previewing refreshes in place.
      const archivo = `borrador-${tipoDte}-${empresa.canonical}-${input.fechaEmision}-${
        input.receptor.rut
      }.pdf`;
      const path = await files.write(args.directorio, archivo, bytes);
      return {
        path,
        archivo,
        bytes: bytes.length,
        contentType: 'application/pdf' as const,
        totales: filled.totales,
        empresa: emp,
        tipoDte,
        avisos: filled.avisos,
      };
    });
    audit(runtime, 'dte_preview_pdf', 'ok', {
      rut: empresa.canonical,
      tipoDte,
      bytes: res.bytes,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'dte_preview_pdf', 'failed', { rut: empresa.canonical, tipoDte });
    throw e;
  }
}

// --- Documentos emitidos (read-only; ADR-023's boundary is untouched) ----------------

/** The DTEs already EMITTED by `empresa`. Read-only — nothing here issues or signs.
 *
 *  `tipoDte` does NOT filter the listing (use `tipoDoc` for that). It only picks the `OPCION`
 *  of the chooser GET, i.e. which destination `mipeSelEmpresa.cgi` is asked to forward to.
 *  Empresa selection is SESSION state independent of that destination, so any wired value
 *  scopes the session identically — but it is load-bearing on the single-empresa path, where
 *  SII answers a launcher that jumps to whatever `OPCION` named (#95). Kept explicit rather
 *  than hidden, and defaulted to 33. */
export async function dteEmitidos(
  runtime: Runtime,
  args: { empresa: string; tipoDte?: number } & DteEmitidosFiltro,
): Promise<{ empresa: DteEmpresa; documentos: DteEmitido[] }> {
  const empresa = Rut.parse(args.empresa);
  const tipoDte = assertTipo(args.tipoDte);
  if (args.receptor !== undefined) Rut.parse(args.receptor); // Mod-11 before any session
  for (const [k, v] of [
    ['desde', args.desde],
    ['hasta', args.hasta],
  ] as const) {
    if (v !== undefined && !ISO_DATE.test(v)) {
      throw new ValidationError(`--${k} inválida: "${v}" (formato YYYY-MM-DD).`);
    }
  }
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session) => {
      const emp = await resolveAndSelectEmpresa(session, empresa, tipoDte, () =>
        runtime.clock.sleep(pacingMs()),
      );
      await runtime.clock.sleep(pacingMs());
      const { empresa: _drop, tipoDte: _t, ...filtro } = args;
      // retry the READ only — never the empresa selection, which mutates session state
      return {
        empresa: emp,
        documentos: await readOnlyRetry(runtime, () => fetchEmitidas(session, filtro)),
      };
    });
    audit(runtime, 'dte_emitidos', 'ok', {
      rut: empresa.canonical,
      count: res.documentos.length,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'dte_emitidos', 'failed', { rut: empresa.canonical });
    throw e;
  }
}

/** A downloaded emitted document — a DESCRIPTOR, never the bytes (ADR-022 / ADR-006). */
export interface DteEmitidoDoc {
  readonly path: string;
  readonly archivo: string;
  readonly bytes: number;
  readonly contentType: 'application/pdf';
  readonly empresa: DteEmpresa;
  readonly documento: DteEmitido;
}

/** Download an ALREADY EMITTED document as a PDF, addressed by its `folio` (what a human has)
 *  or by SII's internal `codigo`. The folio is resolved through the listing, so a wrong folio
 *  fails with a clear message instead of an opaque SII page. `directorio` is REQUIRED — the
 *  pure core cannot know `$HOME`; each surface applies its own default (ADR-022).
 *
 *  A `folio` is resolved by asking SII to filter on it, so it is found whatever page it lives
 *  on. A `codigo` (SII's internal id) has no server-side filter, so the listing is WALKED page
 *  by page — paced via `Clock.sleep`, bounded, and the not-found error says how far it looked.
 *  `tipoDte` is the chooser's `OPCION`, not a filter — see `dteEmitidos`. */
export async function dtePdf(
  runtime: Runtime,
  args: {
    empresa: string;
    folio?: number;
    codigo?: string;
    tipoDte?: number;
    directorio: string;
  },
): Promise<DteEmitidoDoc> {
  const empresa = Rut.parse(args.empresa);
  const tipoDte = assertTipo(args.tipoDte);
  if (args.folio === undefined && args.codigo === undefined) {
    throw new ValidationError('Indica el folio del documento (o su código interno).');
  }
  if (args.folio !== undefined && (!Number.isInteger(args.folio) || args.folio <= 0)) {
    throw new ValidationError(`Folio inválido: "${args.folio}" (entero positivo).`);
  }
  const files = runtime.files;
  if (!files) {
    throw new DteError(
      'Este runtime no tiene un FileSink configurado, así que no puede escribir el PDF. ' +
        'Usa `createNodeRuntime()` o inyecta `files`.',
    );
  }
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session) => {
      const emp = await resolveAndSelectEmpresa(session, empresa, tipoDte, () =>
        runtime.clock.sleep(pacingMs()),
      );
      await runtime.clock.sleep(pacingMs());
      let doc: DteEmitido | undefined;
      let paginas = 0;
      let listadoAgotado = false;
      const folio = args.folio;
      if (folio !== undefined) {
        // SII filters on the folio server-side, so one page is enough whatever page it is on.
        doc = (await readOnlyRetry(runtime, () => fetchEmitidas(session, { folio }))).find(
          (d) => d.folio === folio,
        );
      } else {
        // `codigo` has no server-side filter — walk the listing, paced (ADR-004), bounded.
        let previa = '';
        for (let pagina = 1; pagina <= MAX_PAGINAS_EMITIDAS; pagina += 1) {
          if (pagina > 1) await runtime.clock.sleep(pacingMs());
          const page = await readOnlyRetry(runtime, () => fetchEmitidas(session, { pagina }));
          paginas = pagina;
          doc = page.find((d) => d.codigo === args.codigo);
          if (doc) break;
          // Stop on an empty page OR on a page identical to the previous one. A legacy CGI may
          // CLAMP an out-of-range `NUM_PAG` to the last page rather than emptying it, and this
          // one's behaviour past the end is NOT observed — without this guard a wrong codigo
          // would re-scan the same rows until the bound, hammering SII (ADR-004).
          const firma = page.map((d) => d.codigo).join(',');
          if (page.length === 0 || firma === previa) {
            listadoAgotado = true;
            break;
          }
          previa = firma;
        }
      }
      if (!doc) {
        throw new DteError(
          args.folio !== undefined
            ? `No se encontró un documento emitido con folio ${args.folio} en ${emp.rut}. ` +
                'Revisa `dte emitidos`.'
            : `No se encontró un documento emitido con código ${args.codigo} en ${emp.rut} ` +
                (listadoAgotado
                  ? `tras recorrer el listado completo (${paginas} página(s)). `
                  : `tras revisar ${paginas} página(s), el tope del recorrido — si conoces el ` +
                    'folio, búscalo con `--folio`, que el SII filtra server-side. ') +
                'Revisa `dte emitidos`.',
        );
      }
      await runtime.clock.sleep(pacingMs());
      const bytes = await fetchEmitidaPdf(session, doc.codigo);
      // SII's Content-Disposition is just `<rut>.pdf` — carries no folio, so compose the name
      // here (ADR-022): deterministic, so re-downloading refreshes in place.
      const archivo = `dte-${doc.folio ?? doc.codigo}-${empresa.canonical}-${
        doc.fecha ?? 'sin-fecha'
      }.pdf`;
      const path = await files.write(args.directorio, archivo, bytes);
      return {
        path,
        archivo,
        bytes: bytes.length,
        contentType: 'application/pdf' as const,
        empresa: emp,
        documento: doc,
      };
    });
    audit(runtime, 'dte_pdf', 'ok', {
      rut: empresa.canonical,
      folio: res.documento.folio,
      bytes: res.bytes,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'dte_pdf', 'failed', { rut: empresa.canonical, folio: args.folio ?? null });
    throw e;
  }
}

// --- DTE autorizados (PUBLIC, login-free — ADR-014) --------------------------------------

interface DteAuthorizedArgs {
  /** RUT to query (e.g. "12345670-K") — any RUT; public consulta. Mod-11-validated. */
  readonly rut: string;
}

export async function dteAuthorized(
  runtime: Runtime,
  args: DteAuthorizedArgs,
): Promise<DteAutorizados> {
  const rut = Rut.parse(args.rut); // fail fast on a bad RUT — no request issued
  const start = runtime.clock.now().getTime();
  try {
    const res = await fetchDteAutorizados(runtime.portal, rut);
    // Both authorized and not-authorized are valid outcomes → result "ok". Audit records
    // rut=<subject> with NO rutAuth: there is no authenticated principal (ADR-014).
    recordAudit(runtime, {
      action: 'dte_autorizados',
      result: 'ok',
      rut: res.rut,
      autorizado: res.autorizado,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    recordAudit(runtime, { action: 'dte_autorizados', result: 'failed', rut: rut.canonical });
    throw e;
  }
}
