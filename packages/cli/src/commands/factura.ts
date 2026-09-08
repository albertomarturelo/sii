// `sii factura …` — facturas del Portal MIPYME (sistema de facturación gratuito del SII).
// Thin calls into @albertomarturelo/sii-core tasks (ADR-003).
//
// BORRADORES ONLY (ADR-023): this command can create, listar, previsualizar y eliminar
// borradores. NO emite documentos — firmar/emitir queda fuera de alcance a propósito.
//
// EMPRESA-KEYED: `--empresa` se valida contra la lista viva del portal (`sii factura empresas`),
// que es su propio dominio de valores — no el puntero `operate`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import {
  MAX_ITEMS,
  facturaBorradorDelete,
  facturaBorradorList,
  facturaBorradorSave,
  facturaEmpresas,
  facturaPreviewPdf,
  formatMoney as money,
  formatRut as fmtRut,
  type FacturaBorradorArgs,
  type FacturaItem,
  type FacturaSelectAviso,
  type FormaPago,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { DOCUMENTOS_DIR } from '@albertomarturelo/sii-core/node';
import { emit, out } from '../io.js';

/** The document payload, as a JSON file or `-` for STDIN. Keys are the Spanish snake_case the
 *  user works in; they are mapped to the task's camelCase args here (the surface's job). */
interface FacturaJson {
  empresa?: string;
  tipo_dte?: number;
  fecha_emision?: string;
  ciudad_emisor?: string;
  forma_pago?: string;
  borrador_id?: string;
  receptor?: {
    rut?: string;
    razon_social?: string;
    direccion?: string;
    comuna?: string;
    ciudad?: string;
    giro?: string;
    contacto?: string;
  };
  items?: {
    nombre?: string;
    descripcion?: string;
    cantidad?: number;
    unidad?: string;
    precio_unitario?: number;
    descuento_pct?: number;
  }[];
}

/** `--tipo` used to be `(v) => Number(v)`, so `--tipo abc` became NaN and every call site's
 *  `opts.tipo ? …` guard silently fell back to 33 (`--tipo 0` too). Reject the bad value here so
 *  the user is told, and pass the parsed number through unconditionally — `assertTipo` in the
 *  core owns which types are supported. */
const parseTipo = (v: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--tipo inválido: "${v}" (un código de DTE entero, p. ej. 33 o 34).`);
  }
  return n;
};

const tipoOpt = (tipo?: number): { tipoDte?: number } =>
  tipo === undefined ? {} : { tipoDte: tipo };

const FORMAS: Record<string, FormaPago> = {
  contado: 'contado',
  credito: 'credito',
  crédito: 'credito',
  sin_costo: 'sin_costo',
};

function readJson(path: string): FacturaJson {
  const raw = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw) as FacturaJson;
  } catch (e) {
    throw new Error(`JSON inválido en ${path === '-' ? 'STDIN' : path}: ${(e as Error).message}`);
  }
}

const req = <T>(v: T | undefined, campo: string): T => {
  if (v === undefined || v === null || v === '') throw new Error(`Falta "${campo}" en el JSON.`);
  return v;
};

/** Map the user's JSON (+ CLI overrides) onto the task args. */
function toArgs(
  doc: FacturaJson,
  opts: { empresa?: string; ciudad?: string; fecha?: string; borrador?: string },
): FacturaBorradorArgs {
  const r = doc.receptor ?? {};
  const items = doc.items ?? [];
  if (items.length === 0) throw new Error('El JSON no trae "items".');
  if (items.length > MAX_ITEMS) throw new Error(`Máximo ${MAX_ITEMS} líneas de detalle.`);
  const formaRaw = (doc.forma_pago ?? 'credito').toLowerCase();
  const formaPago = FORMAS[formaRaw];
  if (!formaPago) {
    throw new Error(`forma_pago inválida: "${doc.forma_pago}" (contado | credito | sin_costo).`);
  }
  const empresa = opts.empresa ?? doc.empresa;
  const borradorId = opts.borrador ?? doc.borrador_id;
  return {
    empresa: req(empresa, 'empresa'),
    ...(doc.tipo_dte !== undefined ? { tipoDte: doc.tipo_dte } : {}),
    ...((opts.fecha ?? doc.fecha_emision)
      ? { fechaEmision: (opts.fecha ?? doc.fecha_emision) as string }
      : {}),
    ciudadEmisor: req(opts.ciudad ?? doc.ciudad_emisor, 'ciudad_emisor'),
    receptor: {
      rut: req(r.rut, 'receptor.rut'),
      razonSocial: req(r.razon_social, 'receptor.razon_social'),
      direccion: req(r.direccion, 'receptor.direccion'),
      comuna: req(r.comuna, 'receptor.comuna'),
      ciudad: req(r.ciudad, 'receptor.ciudad'),
      giro: req(r.giro, 'receptor.giro'),
      ...(r.contacto ? { contacto: r.contacto } : {}),
    },
    items: items.map((it, i): FacturaItem => {
      const n = `items[${i}]`;
      return {
        nombre: req(it.nombre, `${n}.nombre`),
        ...(it.descripcion ? { descripcion: it.descripcion } : {}),
        cantidad: req(it.cantidad, `${n}.cantidad`),
        ...(it.unidad ? { unidad: it.unidad } : {}),
        precioUnitario: req(it.precio_unitario, `${n}.precio_unitario`),
        ...(it.descuento_pct ? { descuentoPct: it.descuento_pct } : {}),
      };
    }),
    formaPago,
    ...(borradorId ? { borradorId } : {}),
  };
}

/** SII renders some receptor fields as <select>. When the requested value matches no option it
 *  keeps its own, so show what it chose AND the options it offers — otherwise the caller has no
 *  way to know the valid values. */
function printAvisos(avisos: readonly FacturaSelectAviso[]): void {
  for (const a of avisos) {
    out(`  aviso: ${a.campo} — el SII no ofrece "${a.solicitado}"; usó "${a.usado}".`);
    out(`         opciones: ${a.opciones.join(' | ')}`);
  }
}

export function registerFactura(program: Command, runtime: Runtime): void {
  const factura = program
    .command('factura')
    .description(
      'Facturas del Portal MIPYME (facturación gratuita del SII). SOLO borradores — no emite.',
    );

  factura
    .command('empresas')
    .description('Empresas para las que estás autorizado a facturar en el Portal MIPYME.')
    .option('--tipo <n>', 'Tipo de DTE (33 factura, 34 exenta).', parseTipo)
    .action(async (opts: { tipo?: number }) => {
      const res = await facturaEmpresas(runtime, tipoOpt(opts.tipo));
      emit(res, () => {
        for (const e of res) out(`  ${e.rut}  ${e.nombre}`);
        out(`${res.length} empresa(s).`);
      });
    });

  const borrador = factura.command('borrador').description('Borradores de factura.');

  borrador
    .command('list')
    .description('Borradores guardados de una empresa (de TODOS los tipos de DTE).')
    .requiredOption('--empresa <rut>', 'RUT de la empresa emisora.')
    .option(
      '--tipo <n>',
      'Tipo de DTE con el que se abre el portal (33/34). NO filtra el listado; usa --solo-tipo.',
      parseTipo,
    )
    .option('--solo-tipo <n>', 'Muestra sólo los borradores de este tipo de DTE.', parseTipo)
    .action(async (opts: { empresa: string; tipo?: number; soloTipo?: number }) => {
      const listed = await facturaBorradorList(runtime, {
        empresa: opts.empresa,
        ...tipoOpt(opts.tipo),
      });
      // The portal scopes by empresa, not by DTE type, so filtering is ours to do.
      const res =
        opts.soloTipo === undefined
          ? listed
          : { ...listed, borradores: listed.borradores.filter((b) => b.tipoDte === opts.soloTipo) };
      emit(res, () => {
        out(`Borradores de ${res.empresa.rut} — ${res.empresa.nombre}`);
        if (res.borradores.length === 0) {
          out('Sin borradores guardados.');
          return;
        }
        for (const b of res.borradores) {
          out(
            `  id=${b.id}  ${b.fecha ?? '—'}  ${b.receptorRut ? fmtRut(b.receptorRut) : '—'}  ` +
              `${b.receptorNombre ?? ''}  total=${money(b.total)}`,
          );
        }
        out(`${res.borradores.length} borrador(es).`);
      });
    });

  borrador
    .command('save')
    .description('Crea (o actualiza con --borrador) un borrador desde un JSON. No emite nada.')
    .argument('<json>', 'Ruta al JSON del documento, o "-" para leer STDIN.')
    .option('--empresa <rut>', 'RUT emisor (sobrescribe el del JSON).')
    .option('--ciudad <ciudad>', 'Ciudad del emisor (el SII la exige y no la precarga).')
    .option('--fecha <YYYY-MM-DD>', 'Fecha de emisión (por defecto: hoy).')
    .option('--borrador <id>', 'Actualiza ESTE borrador en vez de crear uno nuevo.')
    .action(
      async (
        json: string,
        opts: { empresa?: string; ciudad?: string; fecha?: string; borrador?: string },
      ) => {
        const res = await facturaBorradorSave(runtime, toArgs(readJson(json), opts));
        emit(res, () => {
          out(
            `${res.actualizado ? 'Borrador actualizado' : 'Borrador creado'}: id=${res.id ?? '—'}`,
          );
          out(`  ${res.tipoDteDesc} — ${res.empresa.rut} ${res.empresa.nombre}`);
          out(
            `  neto=${money(res.totales.neto)}  IVA=${money(res.totales.iva)}  ` +
              `total=${money(res.totales.total)}`,
          );
          printAvisos(res.avisos);
        });
      },
    );

  borrador
    .command('delete')
    .description('Elimina un borrador. Irreversible: exige --confirm con el mismo id.')
    .argument('<id>', 'Id del borrador (columna id de `borrador list`).')
    .requiredOption('--empresa <rut>', 'RUT de la empresa emisora.')
    .option(
      '--tipo <n>',
      'Tipo de DTE. Opcional: se toma del propio borrador; sólo es un respaldo.',
      parseTipo,
    )
    .option('--confirm <id>', 'Repite el id para confirmar el borrado.')
    .action(async (id: string, opts: { empresa: string; tipo?: number; confirm?: string }) => {
      // Double-entry of the load-bearing value, like `bte emit` (ADR-017).
      if (opts.confirm !== id) {
        throw new Error(
          `Para eliminar el borrador ${id} repite el id: --confirm ${id}. Nada fue eliminado.`,
        );
      }
      const res = await facturaBorradorDelete(runtime, {
        empresa: opts.empresa,
        borradorId: id,
        ...tipoOpt(opts.tipo),
      });
      emit(res, () =>
        out(`Borrador ${res.borradorId} (DTE ${res.tipoDte}) eliminado de ${res.empresa.rut}.`),
      );
    });

  factura
    .command('preview')
    .description('Descarga el PDF de vista previa ("Validar y visualizar"). NO emite el DTE.')
    .argument('<json>', 'Ruta al JSON del documento, o "-" para leer STDIN.')
    .option('--empresa <rut>', 'RUT emisor (sobrescribe el del JSON).')
    .option('--ciudad <ciudad>', 'Ciudad del emisor (el SII la exige y no la precarga).')
    .option('--fecha <YYYY-MM-DD>', 'Fecha de emisión (por defecto: hoy).')
    .option('--borrador <id>', 'Previsualiza a partir de este borrador.')
    .option('--out <dir>', 'Carpeta destino.', join(DOCUMENTOS_DIR, 'factura'))
    .action(
      async (
        json: string,
        opts: { empresa?: string; ciudad?: string; fecha?: string; borrador?: string; out: string },
      ) => {
        const res = await facturaPreviewPdf(runtime, {
          ...toArgs(readJson(json), opts),
          directorio: opts.out,
        });
        emit(res, () => {
          out(`Vista previa (DOCUMENTO NO VÁLIDO, sin folio) — ${res.empresa.nombre}`);
          out(`  ${res.path} (${res.bytes} bytes)`);
          out(
            `  neto=${money(res.totales.neto)}  IVA=${money(res.totales.iva)}  ` +
              `total=${money(res.totales.total)}`,
          );
        });
      },
    );
}
