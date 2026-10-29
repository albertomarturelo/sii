// Bienes raíces — typed facade over Mi SII's « Bienes raíces » panel (ADR-032). First-hand
// observed, no third-party library (ADR-004); wire contract in docs/sii-contract/bienes-raices.md.
//
// The home's accordion POSTs `opc=34&VIEW=1&rnd=<random>` to `CViewCarta.cgi` (Mi SII's
// `callMessageBBRR`, `misii/js/misii.min.js`, read 2026-10-28) and gets JSON from the SDI service
// `…serviciosecontribuciones…PropiedadesApplicationService/getPropiedades`: the predios whose
// contribuciones the RUT pays (owned or not), each with a map of its UNPAID cuotas. Reached with
// `requestForm` (the CGI takes a form, which `requestJson` does not send), browser-free.
//
// Auth: SESSION-KEYED (ADR-005) — the request carries no RUT. A missing session does NOT bounce:
// the CGI answers `200 {"codigoResp":-2,"glosaRespuesta":"Error: Autenticacion"}` (observed
// 2026-10-28), so that body is the login wall here, never an empty list.
//
// PII: the row carries the dirección and the owner's name. Curated, NO `raw`; the name and the
// map keys (`<RUT>-<rol>`) are dropped (ADR-032).
import { z } from 'zod';
import { HOSTS } from '../config/index.js';
import {
  BienesRaicesError,
  NetworkError,
  NotAuthenticatedError,
  SessionExpiredError,
} from '../errors/index.js';
import type { PortalSession } from '../seams/index.js';

/** One unpaid cuota of contribuciones, as Mi SII lists it. Fields as SII's own client reads them
 *  (`getCuotas` / `formateaGrilla`, misii.min.js, read 2026-10-28). */
export interface CuotaContribucion {
  readonly anio: number | null;
  readonly semestre: number | null;
  /** The cuota's number within the año (SII's grid prints `<anio>-<cuota>`). */
  readonly cuota: number | null;
  /** SII's `condicion`, verbatim. */
  readonly condicion: string | null;
  /** SII's own rule (`callMessageBBRR`): `condicion == "VENCIDA"`; every other cuota is vigente. */
  readonly vencida: boolean;
  /** YYYY-MM-DD, or null when SII's value is in neither format its own client accepts. */
  readonly fechaVencimiento: string | null;
  /** SII's `totalPago` in pesos, or null when it is not a readable amount. */
  readonly totalPago: number | null;
}

/** A predio whose contribuciones the session's RUT pays, with its unpaid cuotas. */
export interface Predio {
  /** SII's rol, `<manzana>-<predio>` as SII prints it. Unique within its comuna. */
  readonly rol: string;
  readonly comuna: { readonly codigo: number; readonly nombre: string | null };
  readonly manzana: number;
  readonly predio: number;
  /** PII: the predio's address. */
  readonly direccion: string | null;
  readonly destino: string | null;
  /** SII's `propietario`: the RUT is the registered owner. null when SII did not say. */
  readonly propietario: boolean | null;
  readonly cuotas: readonly CuotaContribucion[];
  readonly cuotasVencidas: number;
  readonly cuotasVigentes: number;
}

const OPC_BIENES_RAICES = '34';
// `codigoResp` -2 is how the CGI answers a request without a session (observed 2026-10-28).
const CODIGO_SIN_SESION = -2;

// --- Wire shapes (zod-at-the-boundary, ADR-011) ---------------------------------------
// Success: `{ data: { "<RUT>-<rol>": {…} } | null, metaData: { namespace, errors, … } }`.
// Failure: `{ codigoResp, glosaRespuesta }`. `.loose()` keeps unobserved fields.
const Row = z.record(z.string(), z.unknown());
const Envelope = z
  .object({
    data: z.record(z.string(), Row).nullable().optional(),
    metaData: z.object({ errors: z.unknown().optional() }).loose().nullable().optional(),
    codigoResp: z.number().optional(),
    glosaRespuesta: z.string().nullable().optional(),
  })
  .loose();

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const asStr = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};
const asInt = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};
const pad = (s: string): string => s.padStart(2, '0');

/** The two formats SII's own `dateOrderKey` accepts (misii.min.js, read 2026-10-28):
 *  `YYYY-MM-DD…` and `D[-/]M[-/]YYYY`. Anything else, or a date that does not exist ⇒ null. */
export function fechaVencimientoIso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const dmy = iso ? null : /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(s);
  const [y, m, d] = iso
    ? [iso[1]!, iso[2]!, iso[3]!]
    : dmy
      ? [dmy[3]!, pad(dmy[2]!), pad(dmy[1]!)]
      : [];
  if (!y || !m || !d) return null;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}

/** `totalPago`: a number as is; an es-CL string (`"$ 12.345"`, `"12.345"`, `"12345"`) parsed;
 *  anything else ⇒ null. SII's grid prints the value untouched, so both forms are plausible. */
export function montoPesos(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/\$/g, '').replace(/\s/g, '');
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(s)) return null;
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

function curateCuota(row: unknown): CuotaContribucion {
  const c = isObj(row) ? row : {};
  const condicion = asStr(c['condicion']);
  return {
    anio: asInt(c['agno']),
    semestre: asInt(c['semestre']),
    cuota: asInt(c['cuota']),
    condicion,
    vencida: condicion?.toUpperCase() === 'VENCIDA',
    fechaVencimiento: fechaVencimientoIso(c['fechaVencimiento']),
    totalPago: montoPesos(c['totalPago']),
  };
}

function curatePredio(row: Record<string, unknown>): Predio {
  const comuna = asInt(row['comuna']);
  const manzana = asInt(row['manzana']);
  const predio = asInt(row['predio']);
  if (comuna === null || manzana === null || predio === null) {
    // The rol is the predio's identity (and the alertas id): without it the shape moved.
    throw new BienesRaicesError(
      'Scraper roto: un predio de Mi SII (Bienes raíces) no trae comuna, manzana y predio ' +
        'numéricos; el SII cambió la forma de la respuesta.',
    );
  }
  // An object keyed by an unobserved key; SII's client reads only the values.
  const raw = row['cuotas'];
  const cuotas = (isObj(raw) ? Object.values(raw) : []).map(curateCuota);
  const vencidas = cuotas.filter((c) => c.vencida).length;
  const propietario = row['propietario'];
  return {
    rol: asStr(row['rol']) ?? `${manzana}-${predio}`,
    comuna: { codigo: comuna, nombre: asStr(row['descripcionComuna']) },
    manzana,
    predio,
    direccion: asStr(row['direccion']),
    destino: asStr(row['destino']),
    propietario: typeof propietario === 'boolean' ? propietario : null,
    cuotas,
    cuotasVencidas: vencidas,
    cuotasVigentes: cuotas.length - vencidas,
  };
}

/** `metaData.errors`: null / `[]` when fine. Anything else is SII's business error, verbatim. */
function siiErrors(errors: unknown): string | null {
  if (errors === null || errors === undefined) return null;
  const list = Array.isArray(errors) ? errors : [errors];
  if (list.length === 0) return null;
  return list
    .map((e) =>
      isObj(e) ? (asStr(e['descripcion']) ?? asStr(e['message']) ?? JSON.stringify(e)) : String(e),
    )
    .join('; ');
}

/** `POST CViewCarta.cgi opc=34` — the predios the session's RUT pays, with their unpaid cuotas.
 *  `data: null` / `{}` is a legitimate "no predios". */
export async function fetchPredios(session: PortalSession): Promise<readonly Predio[]> {
  let body: string;
  try {
    ({ body } = await session.requestForm(HOSTS.miSiiCarta, {
      // `rnd` is a cache-buster in SII's own call; sent the same way.
      form: { opc: OPC_BIENES_RAICES, VIEW: '1', rnd: String(Math.random()) },
    }));
  } catch (e) {
    if (e instanceof NotAuthenticatedError || e instanceof NetworkError) throw e;
    throw new BienesRaicesError(
      `Mi SII (Bienes raíces) no respondió: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new BienesRaicesError(
      `Scraper roto: Mi SII (Bienes raíces) no respondió JSON: «${body.slice(0, 80)}».`,
    );
  }
  const env = Envelope.safeParse(json);
  if (!env.success) {
    throw new BienesRaicesError(
      'Scraper roto: la respuesta de Mi SII (Bienes raíces) no tiene la forma observada.',
    );
  }
  const { data, metaData, codigoResp, glosaRespuesta } = env.data;
  if (codigoResp === CODIGO_SIN_SESION) {
    throw new SessionExpiredError(
      `Mi SII respondió «${glosaRespuesta ?? 'sin glosa'}»: la sesión no es válida. ` +
        'Vuelve a iniciar sesión (`sii auth login`).',
    );
  }
  if (codigoResp !== undefined && codigoResp !== 0 && data == null) {
    throw new BienesRaicesError(glosaRespuesta ?? `Mi SII respondió codigoResp ${codigoResp}.`);
  }
  const err = siiErrors(metaData?.errors);
  if (err) throw new BienesRaicesError(err);
  if (data === undefined && metaData === undefined) {
    throw new BienesRaicesError(
      'Scraper roto: la respuesta de Mi SII (Bienes raíces) no trae `data` ni `metaData`.',
    );
  }
  return Object.values(data ?? {}).map(curatePredio);
}
