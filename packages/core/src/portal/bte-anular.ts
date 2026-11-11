import { HOSTS } from '../config/index.js';
import { Rut } from '../rut/index.js';
import type { PortalSession } from '../seams/index.js';
import type { BteBoleta } from './bte.js';
import { readInlineMap } from './inline-map.js';

// Observed at https://loa.sii.cl/IMT/js/TMBANU_Anulacion.js on 2026-11-10.
const REVIEW_URL = `${HOSTS.bheCgi}/TMBANU_ConfirmarAnulacion.cgi`;
const SUBMIT_URL = `${HOSTS.bheCgi}/TMBANU_RecepcionAnulacion.cgi`;

type Result =
  | { EstadoEjecucion012: 0; Dato: string }
  | { EstadoEjecucion012: 1; Dato: string }
  | { EstadoEjecucion012: 2; Dato: string };

/** Read the SII review and compare it with the selected issued document. */
export async function revisarAnulacionBte(
  session: PortalSession,
  rut: Rut,
  boleta: BteBoleta,
  motivo: number,
): Promise<Result> {
  try {
    // Observed at https://loa.sii.cl/cgi_IMT/TMBANU_PrevalidaAnulacion.cgi on 2026-11-10.
    const response = await session.requestForm(REVIEW_URL, {
      form: {
        rut_arrastre: String(rut.body),
        dv_arrastre: rut.dv,
        origen: 'SEXTO',
        Txt_BoletaAnular: String(boleta.folio),
        OptCausaAnulacion: String(motivo),
      },
    });
    // Observed at https://loa.sii.cl/cgi_IMT/TMBANU_ConfirmarAnulacion.cgi on 2026-11-10.
    if (
      response.status >= 400 ||
      /No ha sido posible completar su solicitud/i.test(response.body)
    ) {
      return { EstadoEjecucion012: 2, Dato: 'El SII rechazó la revisión de anulación.' };
    }
    const fields = readInlineMap(response.body, 'xml_values');
    if (fields === null || !/\bname\s*=\s*["']BtnConfirmar["']/i.test(response.body)) {
      return {
        EstadoEjecucion012: 1,
        Dato: 'El formulario de revisión del SII no se pudo verificar.',
      };
    }
    const issuer = Rut.tryParse(`${fields['rut_ctr']}-${fields['dv_ctr']}`);
    const fecha = `${fields['dia_atencion']}/${fields['mes_atencion']}/${fields['anio_atencion']}`;
    if (
      issuer?.canonical !== rut.canonical ||
      fields['nro_boleta'] !== String(boleta.folio) ||
      fields['codigo_causa'] !== String(motivo) ||
      fields['anulada'] !== 'N' ||
      fecha !== boleta.fechaBoleta ||
      Number(fields['Monto_Boleta']) !== boleta.totalHonorarios
    ) {
      return {
        EstadoEjecucion012: 1,
        Dato: 'La revisión del SII no coincide con el folio y el motivo solicitados.',
      };
    }
    return { EstadoEjecucion012: 0, Dato: 'El SII mostró la revisión del folio vigente.' };
  } catch (error) {
    return {
      EstadoEjecucion012: 2,
      Dato: error instanceof Error ? error.message : 'Falló la revisión en el SII.',
    };
  }
}

/** Submit the already reviewed annulment. Receiving a response does not establish its effect. */
export async function anularBte(
  session: PortalSession,
  rut: Rut,
  folio: number,
  motivo: number,
): Promise<Result> {
  try {
    // Observed at https://loa.sii.cl/cgi_IMT/TMBANU_ConfirmarAnulacion.cgi on 2026-11-10.
    const response = await session.requestForm(SUBMIT_URL, {
      followRedirects: false,
      form: {
        rut_arrastre: String(rut.body),
        dv_arrastre: rut.dv,
        Txt_CodigoCausa: String(motivo),
        Txt_BoletaAnular: String(folio),
      },
    });
    return {
      EstadoEjecucion012: 0,
      Dato: `El SII devolvió HTTP ${response.status} al enviar la solicitud.`,
    };
  } catch {
    return { EstadoEjecucion012: 1, Dato: 'El envío no devolvió una respuesta verificable.' };
  }
}
