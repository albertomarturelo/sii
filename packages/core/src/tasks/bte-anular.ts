import { recordAudit } from '../audit/index.js';
import { assertOperatingSelf, withSession } from '../auth/session.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import { BteError } from '../errors/index.js';
import { Periodo } from '../periodo/index.js';
import { anularBte, revisarAnulacionBte } from '../portal/bte-anular.js';
import { fetchBteMensual, type BteBoleta } from '../portal/bte.js';
import { Rut } from '../rut/index.js';
import type { PortalSession, Runtime } from '../seams/index.js';

export interface BteAnularArgs {
  readonly folio: number;
  readonly periodo: string;
  readonly motivo?: number | undefined;
  readonly confirm?: number | undefined;
}

export interface ResultadoAnulacionBte {
  readonly EstadoEjecucion012: 0 | 1 | 2;
  readonly Dato: {
    readonly EstadoFuncional: 'VIG' | 'ANUL' | 'NO_ENCONTRADA' | 'INDETERMINADO' | 'FALLO';
    readonly folio: number | null;
    readonly periodo: string;
    readonly motivo: number | null;
    readonly envioIntentado: boolean;
    readonly fechaBoleta?: string | null;
    readonly fechaAnulacion?: string | null;
    readonly totalHonorarios?: number | null;
    readonly EstadoVerificacion012?: 0 | 1 | 2;
    readonly diagnostico: string;
  };
}

type FolioResult =
  | { EstadoEjecucion012: 0; Dato: BteBoleta | null }
  | { EstadoEjecucion012: 1; Dato: string }
  | { EstadoEjecucion012: 2; Dato: string };

const PACE_MS = Math.round(1000 / DEFAULT_SETTINGS.rateLimitRps);

async function consultarFolio(
  session: PortalSession,
  runtime: Runtime,
  rut: Rut,
  periodo: Periodo,
  folio: number,
): Promise<FolioResult> {
  try {
    const informe = await fetchBteMensual(session, { rut, periodo, side: 'EMITIDAS' }, () =>
      runtime.clock.sleep(PACE_MS),
    );
    const matches = informe.boletas.filter((boleta) => boleta.folio === folio);
    if (
      informe.totalBoletas !== informe.boletas.length ||
      matches.length > 1 ||
      informe.boletas.some((boleta) => boleta.folio === null)
    ) {
      return { EstadoEjecucion012: 1, Dato: 'El informe está incompleto o el folio es ambiguo.' };
    }
    return { EstadoEjecucion012: 0, Dato: matches[0] ?? null };
  } catch (error) {
    return {
      EstadoEjecucion012: 2,
      Dato: error instanceof Error ? error.message : 'Falló la consulta al SII.',
    };
  }
}

/** Preview an issued BHE, or submit a confirmed annulment and independently verify its effect. */
export async function bteAnular(
  runtime: Runtime,
  args: BteAnularArgs,
): Promise<ResultadoAnulacionBte> {
  const { folio, motivo, confirm } = args;
  const periodo = Periodo.tryParse(args.periodo);
  const validFolio = Number.isInteger(folio) && folio > 0 && folio <= 9_999_999_999;
  const base = {
    folio: validFolio ? folio : null,
    periodo: periodo?.canonical ?? args.periodo,
    motivo: motivo ?? null,
    envioIntentado: false,
  };
  const action = confirm === undefined ? 'bte_anular_preview' : 'bte_anular';
  if (
    !validFolio ||
    periodo === null ||
    (motivo !== undefined && motivo !== 1 && motivo !== 2 && motivo !== 3) ||
    (confirm !== undefined && (confirm !== folio || motivo === undefined))
  ) {
    recordAudit(runtime, { action, result: 'invalid', ...(validFolio ? { folio } : {}) });
    return {
      EstadoEjecucion012: 2,
      Dato: {
        ...base,
        EstadoFuncional: 'FALLO',
        diagnostico:
          'Indica un folio y período válidos. Para anular, elige el motivo 1, 2 o 3 y repite el folio en la confirmación.',
      },
    };
  }

  let envioIntentado = false;
  let result: ResultadoAnulacionBte;
  try {
    await assertOperatingSelf(
      runtime,
      () => new BteError('Para anular una boleta debes iniciar sesión como su emisor.'),
    );
    result = await withSession(runtime, async (session, ctx): Promise<ResultadoAnulacionBte> => {
      if (ctx.operatingRut !== ctx.sessionRut) {
        return {
          EstadoEjecucion012: 2,
          Dato: {
            ...base,
            EstadoFuncional: 'FALLO',
            diagnostico: 'La sesión no corresponde al emisor.',
          },
        };
      }
      const rut = Rut.parse(ctx.sessionRut);
      const antes = await consultarFolio(session, runtime, rut, periodo, folio);
      switch (antes.EstadoEjecucion012) {
        case 0:
          break;
        case 1:
          return {
            EstadoEjecucion012: 1,
            Dato: { ...base, EstadoFuncional: 'INDETERMINADO', diagnostico: antes.Dato },
          };
        case 2:
          return {
            EstadoEjecucion012: 2,
            Dato: { ...base, EstadoFuncional: 'FALLO', diagnostico: antes.Dato },
          };
      }

      const boleta = antes.Dato;
      if (boleta === null) {
        return {
          EstadoEjecucion012: 0,
          Dato: {
            ...base,
            EstadoFuncional: 'NO_ENCONTRADA',
            diagnostico: 'El folio no figura en el informe del período.',
          },
        };
      }
      const data = {
        ...base,
        fechaBoleta: boleta.fechaBoleta ?? null,
        fechaAnulacion: boleta.fechaAnulacion,
        totalHonorarios: boleta.totalHonorarios,
      };
      if (boleta.estado === 'ANUL' && boleta.fechaAnulacion) {
        return {
          EstadoEjecucion012: 0,
          Dato: { ...data, EstadoFuncional: 'ANUL', diagnostico: 'El folio ya figura anulado.' },
        };
      }
      if (boleta.estado !== 'VIG' || !boleta.fechaBoleta || !boleta.totalHonorarios) {
        return {
          EstadoEjecucion012: 1,
          Dato: {
            ...data,
            EstadoFuncional: 'INDETERMINADO',
            diagnostico: 'El informe no acredita la vigencia, fecha o monto del folio.',
          },
        };
      }
      if (motivo === undefined) {
        return {
          EstadoEjecucion012: 0,
          Dato: {
            ...data,
            EstadoFuncional: 'VIG',
            diagnostico: 'El folio está vigente. Indica el motivo para abrir la revisión del SII.',
          },
        };
      }

      await runtime.clock.sleep(PACE_MS);
      const revision = await revisarAnulacionBte(session, rut, boleta, motivo);
      switch (revision.EstadoEjecucion012) {
        case 0:
          if (confirm === undefined) {
            return {
              EstadoEjecucion012: 0,
              Dato: { ...data, EstadoFuncional: 'VIG', diagnostico: revision.Dato },
            };
          }
          break;
        case 1:
          return {
            EstadoEjecucion012: 1,
            Dato: { ...data, EstadoFuncional: 'INDETERMINADO', diagnostico: revision.Dato },
          };
        case 2:
          return {
            EstadoEjecucion012: 2,
            Dato: { ...data, EstadoFuncional: 'FALLO', diagnostico: revision.Dato },
          };
      }

      await runtime.clock.sleep(PACE_MS);
      envioIntentado = true;
      const envio = await anularBte(session, rut, folio, motivo);
      let diagnostico: string;
      switch (envio.EstadoEjecucion012) {
        case 0:
          diagnostico = envio.Dato;
          break;
        case 1:
          diagnostico = `Resultado del envío indeterminado. ${envio.Dato}`;
          break;
        case 2:
          diagnostico = `Fallo en el envío. ${envio.Dato}`;
          break;
      }

      await runtime.clock.sleep(PACE_MS);
      const despues = await consultarFolio(session, runtime, rut, periodo, folio);
      switch (despues.EstadoEjecucion012) {
        case 0: {
          const verificada = despues.Dato;
          if (
            verificada?.estado === 'ANUL' &&
            verificada.fechaAnulacion &&
            verificada.fechaBoleta === boleta.fechaBoleta &&
            verificada.totalHonorarios === boleta.totalHonorarios
          ) {
            return {
              EstadoEjecucion012: 0,
              Dato: {
                ...data,
                envioIntentado,
                EstadoVerificacion012: 0,
                EstadoFuncional: 'ANUL',
                fechaAnulacion: verificada.fechaAnulacion,
                diagnostico: 'Anulación verificada en el informe de emitidas.',
              },
            };
          }
          diagnostico += ' El informe no acredita la anulación.';
          break;
        }
        case 1:
          diagnostico += ` Verificación incompleta. ${despues.Dato}`;
          break;
        case 2:
          diagnostico += ` Falló la verificación. ${despues.Dato}`;
          break;
      }
      return {
        EstadoEjecucion012: 1,
        Dato: {
          ...data,
          envioIntentado,
          EstadoVerificacion012: despues.EstadoEjecucion012,
          EstadoFuncional: 'INDETERMINADO',
          diagnostico: `${diagnostico} Consulta las emitidas antes de volver a enviar.`,
        },
      };
    });
  } catch (error) {
    if (envioIntentado) {
      result = {
        EstadoEjecucion012: 1,
        Dato: {
          ...base,
          envioIntentado,
          EstadoFuncional: 'INDETERMINADO',
          diagnostico:
            'No se completó la verificación posterior. Consulta las emitidas antes de volver a enviar.',
        },
      };
    } else {
      result = {
        EstadoEjecucion012: 2,
        Dato: {
          ...base,
          EstadoFuncional: 'FALLO',
          diagnostico: error instanceof Error ? error.message : 'Falló la anulación.',
        },
      };
    }
  }

  switch (result.EstadoEjecucion012) {
    case 0:
      recordAudit(runtime, {
        action,
        result: result.Dato.EstadoFuncional,
        folio,
        period: periodo.canonical,
      });
      return result;
    case 1:
      recordAudit(runtime, { action, result: 'unconfirmed', folio, period: periodo.canonical });
      return result;
    case 2:
      recordAudit(runtime, { action, result: 'failed', folio, period: periodo.canonical });
      return result;
  }
}
