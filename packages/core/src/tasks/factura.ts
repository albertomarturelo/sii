// Public factura (MIPYME) task API the surfaces call (ADR-003). BORRADORES ONLY — this
// surface creates, lists, previews and deletes DRAFT facturas in the SII's free facturación
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
import { FacturaError, ValidationError } from '../errors/index.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import {
  FORMA_PAGO,
  MAX_ITEMS,
  TIPOS_DTE,
  fetchBorradores,
  fetchEmpresas,
  fetchPreviewPdf,
  fillFactura,
  eliminaBorrador,
  grabaBorrador,
  isTipoDte,
  loadBorrador,
  resolveAndSelectEmpresa,
} from '../portal/factura.js';
import type {
  FacturaSelectAviso,
  FacturaBorradorInput,
  FacturaBorradorRow,
  FacturaEmpresa,
  FacturaItem,
  FacturaTotales,
  FormaPago,
  TipoDte,
} from '../portal/factura.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type {
  FacturaSelectAviso,
  FacturaBorradorRow,
  FacturaEmpresa,
  FacturaItem,
  FacturaTotales,
  FormaPago,
  TipoDte,
} from '../portal/factura.js';
export { TIPOS_DTE, MAX_ITEMS } from '../portal/factura.js';

/** Inter-call pace (ms) between consecutive POSTs to SII. The MIPYME CGIs are the legacy,
 *  session-stateful kind and were observed to start timing out under a fast sequence, so this
 *  floors at 1000 ms rather than deriving a smaller value from `rateLimitRps`. Writes are NEVER
 *  retried (ADR-004); see `readOnlyRetry` for the read-only exception. */
const PACE_MS = 1000;
const pacingMs = (): number => Math.max(PACE_MS, Math.round(1000 / DEFAULT_SETTINGS.rateLimitRps));

/** Retry a READ-ONLY call at most twice, and ONLY on a transient transport failure — a timeout,
 *  a 429 or a 5xx. Never on a validation error, an unexpected HTML body, or anything that
 *  writes: those are surfaced immediately (ADR-004). Backoff is exponential with jitter so
 *  concurrent callers do not resonate. */
async function readOnlyRetry<T>(runtime: Runtime, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /timeout|ETIMEDOUT|ECONNRESET|socket hang up|\b(?:429|5\d{2})\b/i.test(msg);
      // A SII business/validation failure or a dead session is NOT transient — fail now.
      if (!transient || e instanceof FacturaError || attempt === 2) throw e;
      await runtime.clock.sleep(PACE_MS * 2 ** attempt + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
}

function audit(runtime: Runtime, action: string, result: string, extra: Partial<AuditEntry>): void {
  recordAudit(runtime, { action, result, ...extra });
}

/** What a surface passes in. Everything is validated LOCALLY here, before any session. */
export interface FacturaBorradorArgs {
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
  readonly items: readonly FacturaItem[];
  readonly formaPago?: FormaPago; // default 'credito'
  /** Set to UPDATE an existing borrador in place; omit to create a new one. */
  readonly borradorId?: string;
}

/** The result of saving a borrador: SII's own totals plus the borrador's id. */
export interface FacturaBorradorSaved {
  readonly id: string | null;
  readonly empresa: FacturaEmpresa;
  readonly tipoDte: TipoDte;
  readonly tipoDteDesc: string;
  readonly actualizado: boolean;
  readonly totales: FacturaTotales;
  /** <select> fields where SII kept its own option; each lists the options it offers. */
  readonly avisos: readonly FacturaSelectAviso[];
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
  args: FacturaBorradorArgs,
): {
  empresa: Rut;
  tipoDte: TipoDte;
  input: Omit<FacturaBorradorInput, 'empresa'>;
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
export async function facturaEmpresas(
  runtime: Runtime,
  args: { tipoDte?: number } = {},
): Promise<FacturaEmpresa[]> {
  const tipoDte = assertTipo(args.tipoDte);
  try {
    const res = await readOnlyRetry(runtime, () =>
      withSession(runtime, (session) => fetchEmpresas(session, tipoDte)),
    );
    audit(runtime, 'factura_empresas', 'ok', { count: res.length });
    return res;
  } catch (e) {
    audit(runtime, 'factura_empresas', 'failed', {});
    throw e;
  }
}

/** The saved borradores of `empresa`. Curated rows, no `raw` (they are receptor PII). */
export async function facturaBorradorList(
  runtime: Runtime,
  args: { empresa: string; tipoDte?: number },
): Promise<{ empresa: FacturaEmpresa; borradores: FacturaBorradorRow[] }> {
  const empresa = Rut.parse(args.empresa);
  const tipoDte = assertTipo(args.tipoDte);
  const start = runtime.clock.now().getTime();
  try {
    const res = await readOnlyRetry(runtime, () =>
      withSession(runtime, async (session) => {
        const emp = await resolveAndSelectEmpresa(session, empresa, tipoDte);
        await runtime.clock.sleep(pacingMs());
        return { empresa: emp, borradores: await fetchBorradores(session) };
      }),
    );
    audit(runtime, 'factura_borrador_list', 'ok', {
      rut: empresa.canonical,
      count: res.borradores.length,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'factura_borrador_list', 'failed', { rut: empresa.canonical });
    throw e;
  }
}

/** Create (or, with `borradorId`, update) a borrador. The document is validated by SII's OWN
 *  client-side validator first, so a rejection surfaces SII's Spanish message verbatim and
 *  costs no write. The new id is resolved by diffing the borradores list around the save —
 *  `mipeGrabaBorrador.cgi` returns only a confirmation page (observed). */
export async function facturaBorradorSave(
  runtime: Runtime,
  args: FacturaBorradorArgs,
): Promise<FacturaBorradorSaved> {
  const { empresa, tipoDte, input } = validate(runtime, args);
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session) => {
      const emp = await resolveAndSelectEmpresa(session, empresa, tipoDte);
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
    audit(runtime, 'factura_borrador_save', 'ok', {
      rut: empresa.canonical,
      borradorId: res.id,
      tipoDte,
      items: input.items.length,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'factura_borrador_save', 'failed', { rut: empresa.canonical, tipoDte });
    throw e; // never retried after a SII error (ADR-004)
  }
}

/** Delete a borrador. Irreversible on SII's side, so the surfaces gate it behind a confirm. */
export async function facturaBorradorDelete(
  runtime: Runtime,
  args: { empresa: string; borradorId: string; tipoDte?: number },
): Promise<{ empresa: FacturaEmpresa; borradorId: string; eliminado: true }> {
  const empresa = Rut.parse(args.empresa);
  const tipoDte = assertTipo(args.tipoDte);
  if (!/^\d+$/.test(args.borradorId)) {
    throw new ValidationError(`Id de borrador inválido: "${args.borradorId}" (son dígitos).`);
  }
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session) => {
      const emp = await resolveAndSelectEmpresa(session, empresa, tipoDte);
      await runtime.clock.sleep(pacingMs());
      const filled = await loadBorrador(session, emp, tipoDte, args.borradorId);
      await runtime.clock.sleep(pacingMs());
      await eliminaBorrador(session, filled); // a WRITE — never retried (ADR-004)
      return { empresa: emp, borradorId: args.borradorId, eliminado: true as const };
    });
    audit(runtime, 'factura_borrador_delete', 'ok', {
      rut: empresa.canonical,
      borradorId: args.borradorId,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'factura_borrador_delete', 'failed', {
      rut: empresa.canonical,
      borradorId: args.borradorId,
    });
    throw e;
  }
}

/** A produced document, as the ADR-022 contract requires: a DESCRIPTOR, never the bytes. The
 *  PDF is PII-dense (both parties' identity + the amounts), so it must not enter the LLM's
 *  context — the caller reads the file from disk. */
export interface FacturaPreviewDoc {
  readonly path: string;
  readonly archivo: string;
  readonly bytes: number;
  readonly contentType: 'application/pdf';
  readonly totales: FacturaTotales;
  readonly empresa: FacturaEmpresa;
  readonly tipoDte: TipoDte;
  readonly avisos: readonly FacturaSelectAviso[];
}

/** The "Validar y visualizar" PDF of a document that has NOT been emitted — stamped
 *  "VISTA PREVIA / DOCUMENTO NO VALIDO", no folio. Builds the document from `args` (an existing
 *  borrador can be re-previewed by passing its `borradorId`), fetches SII's PDF and writes it
 *  through the `FileSink` seam. `directorio` is REQUIRED: the pure core cannot know `$HOME`,
 *  so each surface applies its own default (ADR-022). */
export async function facturaPreviewPdf(
  runtime: Runtime,
  args: FacturaBorradorArgs & { directorio: string },
): Promise<FacturaPreviewDoc> {
  const { empresa, tipoDte, input } = validate(runtime, args);
  const files = runtime.files;
  if (!files) {
    throw new FacturaError(
      'Este runtime no tiene un FileSink configurado, así que no puede escribir el PDF. ' +
        'Usa `createNodeRuntime()` o inyecta `files`.',
    );
  }
  const start = runtime.clock.now().getTime();
  try {
    const res = await withSession(runtime, async (session) => {
      const emp = await resolveAndSelectEmpresa(session, empresa, tipoDte);
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
    audit(runtime, 'factura_preview_pdf', 'ok', {
      rut: empresa.canonical,
      tipoDte,
      bytes: res.bytes,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return res;
  } catch (e) {
    audit(runtime, 'factura_preview_pdf', 'failed', { rut: empresa.canonical, tipoDte });
    throw e;
  }
}
