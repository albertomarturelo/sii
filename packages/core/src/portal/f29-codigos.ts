// F29 código taxonomy — glosa + signo (+/-/=) + contador group, for the Declaración Mensual
// de IVA. The glosa/signo map is OBSERVED first-hand from the rendered F29 form HTML
// (rfiInternet `cargarHtml`, captured 2026-06-29, prod, own empresa session) — NOT a
// third-party source (ADR-004). It changes when we observe a new código, not when a wire
// changes, so it lives in its own module (mirrors f22-codigos.ts). 157 códigos.
//
// `grupo` is assigned from the form's OWN section structure: each section closes with a
// "=" total (538 TOTAL DÉBITOS, 537 TOTAL CRÉDITOS, 595 SUBTOTAL IMPUESTO DETERMINADO,
// 547 Total Determinado, 91 TOTAL A PAGAR), so códigos are bucketed by the section they
// fall in. An UNKNOWN código (not in this map) groups to 'otros' — surfaced, never hidden
// (anti-allowlist; the lesson from F22 #27). Used to label + group the propuesta códigos
// now (Fase 1) and the presented-form códigos later (Fase 2).

export type F29Grupo = 'debitos' | 'creditos' | 'retenciones' | 'otros' | 'totales';

export interface CodigoF29Meta {
  readonly glosa: string;
  /** Sign in the form: '+' suma, '-' resta, '=' total/subtotal, '' header/sin signo. */
  readonly signo: '+' | '-' | '=' | '';
  readonly grupo: F29Grupo;
}

/** Human labels for each group (the contador reading order). */
export const F29_GRUPO_LABELS: Record<F29Grupo, string> = {
  debitos: 'Débitos (ventas)',
  creditos: 'Créditos (compras)',
  retenciones: 'Retenciones, PPM e impuesto único',
  otros: 'Otros impuestos y ajustes',
  totales: 'Determinación y total a pagar',
};

export const F29_CODIGOS: Record<string, CodigoF29Meta> = {
  '15': { glosa: 'Mes', signo: '', grupo: 'debitos' },
  '1': { glosa: '', signo: '', grupo: 'debitos' },
  '585': { glosa: 'Exportaciones', signo: '', grupo: 'debitos' },
  '586': {
    glosa: 'Ventas y/o Servicios prestados Exentos o No Gravados del giro',
    signo: '',
    grupo: 'debitos',
  },
  '731': {
    glosa: 'Ventas con retención sobre el margen de comercialización (contribuyentes retenidos)',
    signo: '',
    grupo: 'debitos',
  },
  '714': {
    glosa: 'Ventas y/o Serivicios prestados Exentos o No Gravados que no son del giro',
    signo: '',
    grupo: 'debitos',
  },
  '515': {
    glosa:
      'Facturas de Compra recibidas con retención total (contribuyentes retenidos) y Factura de Inicio emitida',
    signo: '',
    grupo: 'debitos',
  },
  '720': {
    glosa: 'Facturas de compra recibidas con retención parcial (Total neto)',
    signo: '',
    grupo: 'debitos',
  },
  '503': {
    glosa: 'Facturas de emitidas por ventas y servicios del giro, o por cuenta de terceros',
    signo: '+',
    grupo: 'debitos',
  },
  '763': {
    glosa: 'Facturas emitidas por la venta de bienes inmuebles afectas a IVA',
    signo: '+',
    grupo: 'debitos',
  },
  '716': {
    glosa:
      'Facturas y Notas de Débitos por ventas y servicios que no son del giro (activo fijo y otros)',
    signo: '+',
    grupo: 'debitos',
  },
  '110': { glosa: 'Boletas', signo: '+', grupo: 'debitos' },
  '758': {
    glosa:
      'Comprobantes o Recibos de Pago generados en transacciones pagadas a través de medios electrónicos',
    signo: '+',
    grupo: 'debitos',
  },
  '512': {
    glosa:
      'Notas de débito emitidas del giro y Notas de Débito recibidas de terceros por retención parcial de cambio de sujeto',
    signo: '+',
    grupo: 'debitos',
  },
  '509': {
    glosa:
      'Notas de Crédito emitidas por Facturas asociadas al giro y Notas de Crédito recibidas de terceros por retención parcial de cambio de sujeto',
    signo: '-',
    grupo: 'debitos',
  },
  '708': {
    glosa: 'Notas de Crédito emitidas por Vales de máquinas autorizadas por el Servicio',
    signo: '-',
    grupo: 'debitos',
  },
  '733': {
    glosa:
      'Notas de Crédito emitidas por ventas y servicios que no son del giro (activo fijo y otros)',
    signo: '-',
    grupo: 'debitos',
  },
  '516': {
    glosa: 'Facturas de Compra recibidas con retención parcial (contribuyentes retenidos)',
    signo: '+',
    grupo: 'debitos',
  },
  '500': {
    glosa:
      'Liquidación y Liquidación Factura recibidas (suma débito; ventas realizadas por terceros)',
    signo: '+',
    grupo: 'debitos',
  },
  '817': {
    glosa:
      'Liquidación y Liquidación Factura emitidas (resta débito; ventas realizadas por cuenta de terceros)',
    signo: '-',
    grupo: 'debitos',
  },
  '154': {
    glosa:
      'Adicionales al Débito Fiscal del mes, originadas en devoluciones excesivas registradas en otros períodos por Art. 27 bis',
    signo: '+',
    grupo: 'debitos',
  },
  '518': {
    glosa:
      'Restitución Adicional por proporción de operaciones exentas y/o no gravadas por concepto Art. 27 bis, inc. 2° (Ley N° 19.738)',
    signo: '+',
    grupo: 'debitos',
  },
  '713': {
    glosa:
      'Reintegro del Impuesto de Timbres y Estampillas, Art 3° Ley N° 20.259 e IVA determinado en el Arrendamiento esporádico de BBRR amoblados',
    signo: '+',
    grupo: 'debitos',
  },
  '738': { glosa: 'Adiciones al Débito por IEPD. Ley 20.765', signo: '+', grupo: 'debitos' },
  '791': {
    glosa:
      'Restitución Adicional por proporción de operaciones exentas y/o no gravadas por concepto Reembolso Remanente CF IVA (Ley 21.256)',
    signo: '+',
    grupo: 'debitos',
  },
  '538': { glosa: 'TOTAL DÉBITOS', signo: '=', grupo: 'debitos' },
  '511': { glosa: 'IVA por documentos electrónicos recibidos', signo: '', grupo: 'creditos' },
  '564': { glosa: 'Internas Afectas', signo: '', grupo: 'creditos' },
  '566': { glosa: 'Importaciones', signo: '', grupo: 'creditos' },
  '584': { glosa: 'Internas exentas, o no gravadas', signo: '', grupo: 'creditos' },
  '519': {
    glosa:
      'Facturas recibidas del giro, Facturas de compras emitidas y Comisión pagada por recepción de liquidación factura',
    signo: '+',
    grupo: 'creditos',
  },
  '761': {
    glosa:
      'Facturas recibidas de Proveedores: Supermercados y Comercios similares, Art.23 Nº4 D.L.825, de 1974 (Ley Nº20.780)',
    signo: '+',
    grupo: 'creditos',
  },
  '765': {
    glosa:
      'Facturas recibidas por Adquisición o Construcción de Bienes Inmuebles, Art.8º transitorio (Ley Nº20.780)',
    signo: '+',
    grupo: 'creditos',
  },
  '524': { glosa: 'Facturas activo fijo', signo: '+', grupo: 'creditos' },
  '527': {
    glosa:
      'Notas de Crédito recibidas y Notas de Crédito emitidas por retención de cambio de sujeto',
    signo: '-',
    grupo: 'creditos',
  },
  '531': {
    glosa: 'Notas de Débito recibidas y Notas de Débito emitidas por retención de cambio de sujeto',
    signo: '+',
    grupo: 'creditos',
  },
  '534': {
    glosa: 'Declaraciones de Ingreso (DIN) importaciones del giro',
    signo: '+',
    grupo: 'creditos',
  },
  '536': {
    glosa: 'Declaraciones de Ingreso (DIN) importaciones activo fijo',
    signo: '+',
    grupo: 'creditos',
  },
  '504': { glosa: 'Remanente Crédito Fiscal mes anterior', signo: '+', grupo: 'creditos' },
  '593': { glosa: 'Devolución Solicitud Art.36 (Exportadores)', signo: '-', grupo: 'creditos' },
  '594': { glosa: 'Devolución Solicitud Art.27 bis (Activo fijo)', signo: '-', grupo: 'creditos' },
  '592': {
    glosa: 'Certificado Imputación Art.27 bis (Activo fijo)',
    signo: '-',
    grupo: 'creditos',
  },
  '539': { glosa: 'Devolución Solicitud Art.3 (Cambio de sujeto)', signo: '-', grupo: 'creditos' },
  '718': {
    glosa:
      'Devolución Solicitud Ley Nº 20.258, por remanente CF IVA, originado en Impuesto específico Petróleo Diésel (Generadoras Eléctricas)',
    signo: '-',
    grupo: 'creditos',
  },
  '790': {
    glosa: 'Devolución Solicitud Reembolso Remanente de Crédito Fiscal IVA',
    signo: '-',
    grupo: 'creditos',
  },
  '164': {
    glosa: 'Monto Reintegrado por Devolución Indebida de Crédito Fiscal D.S. 348 (Exportadores)',
    signo: '+',
    grupo: 'creditos',
  },
  '730': {
    glosa:
      'Recuperación de Impuesto Específico al Petróleo Diésel (Art. 7º Ley 18.502, Arts.1º y 3º D.S. Nº 311/86)',
    signo: '+',
    grupo: 'creditos',
  },
  '743': { glosa: 'Variable', signo: '', grupo: 'creditos' },
  '729': {
    glosa:
      'Recuperación Impuesto Específico Petróleo Diésel soportado por Transportistas de Carga (Art. 2º Ley Nº 19.764)',
    signo: '+',
    grupo: 'creditos',
  },
  '745': { glosa: 'Variable', signo: '', grupo: 'creditos' },
  '523': {
    glosa: 'Crédito del Art.11 Ley 18.211 (correspondiente a Zona Franca de Extensión)',
    signo: '+',
    grupo: 'creditos',
  },
  '712': {
    glosa: 'Crédito por Impuesto de Timbres y Estampillas, Art. 3º Ley Nº 20.259',
    signo: '+',
    grupo: 'creditos',
  },
  '757': {
    glosa:
      'Crédito por IVA restituido a aportantes sin domicilio ni residencia en Chile (Art. 83, del artículo primero Ley 20.712)',
    signo: '+',
    grupo: 'creditos',
  },
  '537': { glosa: 'TOTAL CRÉDITOS', signo: '=', grupo: 'creditos' },
  '77': {
    glosa: 'Remanente de crédito fiscal para el período siguiente',
    signo: '+',
    grupo: 'retenciones',
  },
  '772': { glosa: 'Saldo de IVA postergado en 12 cuotas', signo: '+', grupo: 'retenciones' },
  '777': {
    glosa: 'Monto Total IVA postergado en (6 o 12) cuotas',
    signo: '+',
    grupo: 'retenciones',
  },
  '782': {
    glosa: 'Monto total IVA postergado (Ley 20.780) en (6 o 12) cuotas',
    signo: '+',
    grupo: 'retenciones',
  },
  '784': {
    glosa: 'Monto total IVA postergado (Ley 21.207) en (6 o 12) cuotas',
    signo: '+',
    grupo: 'retenciones',
  },
  '786': {
    glosa: 'Monto total IVA postergado (DIN) en (6 o 12) cuotas',
    signo: '+',
    grupo: 'retenciones',
  },
  '788': {
    glosa: 'Monto total IVA postergado (Tributación Simplificada) en (6 o 12) cuotas',
    signo: '+',
    grupo: 'retenciones',
  },
  '760': {
    glosa:
      'Restitución de devolución por concepto de Art. 27 ter D.L. 825, de 1974, inc. 2º (Ley Nº 20.720)',
    signo: '+',
    grupo: 'retenciones',
  },
  '767': {
    glosa: 'Certificado Imputación Art. 27 ter D.L. 825, de 1974, inc. 1º (Ley Nº 20.720)',
    signo: '+',
    grupo: 'retenciones',
  },
  '50': {
    glosa:
      'Retención Impuesto Primera Categoría por rentas de capitales mobiliarios del Art. 20 Nº 2, según Art. 73 LIR',
    signo: '+',
    grupo: 'retenciones',
  },
  '751': {
    glosa: 'Retención Impuesto Único a los Trabajadores, según Art. 74 Nº 1 LIR',
    signo: '+',
    grupo: 'retenciones',
  },
  '151': {
    glosa:
      'Retención de Impuesto con tasa del 10% sobre las rentas del Art. 42 Nº 2, según Art. 74 Nº 2 LIR',
    signo: '+',
    grupo: 'retenciones',
  },
  '153': {
    glosa:
      'Retención de Impuesto con tasa del 10% sobre las rentas del Art. 48, según Art. 74 Nº 3 LIR',
    signo: '+',
    grupo: 'retenciones',
  },
  '49': {
    glosa:
      'Retención sobre rentas del Art. 42 Nº1 LIR con tasa del 3%, por reintegro del préstamo tasa 0%, según art. 9º letra a) Ley Nº 21.252',
    signo: '+',
    grupo: 'retenciones',
  },
  '155': {
    glosa:
      'Retención sobre rentas del Art. 42 Nº2 LIR con tasa del 3%, por reintegro del préstamo tasa 0%, según art. 7º Ley Nº 21.242 y art. 9º letra b) Ley Nº 21.252',
    signo: '+',
    grupo: 'retenciones',
  },
  '54': {
    glosa: 'Retención a Suplementos, según Art. 74 Nº 5 (tasa 0,5%) LIR',
    signo: '+',
    grupo: 'retenciones',
  },
  '56': {
    glosa: 'Retención por compra de productos mineros, según Art. 74 Nº 6 LIR',
    signo: '+',
    grupo: 'retenciones',
  },
  '588': {
    glosa:
      'Retención sobre rescates y otras cantidades pagadas en cumplimiento de seguros dotales y seguros de vida con ahorro del Nº 3 del artículo 17 de la LIR (tasa 15%)',
    signo: '+',
    grupo: 'retenciones',
  },
  '589': {
    glosa:
      'Retención sobre retiros de Ahorro Previsional Voluntario del Art. 42 bis LIR (tasa 15%)',
    signo: '+',
    grupo: 'retenciones',
  },
  '750': {
    glosa: '1ra Categoría Art. 84 a) y 14 D Nº 3 letra (k) y 8 letra (a) numeral (viii).',
    signo: '+',
    grupo: 'retenciones',
  },
  '156': {
    glosa:
      '1ra Categoría. Art. 84 letra a) y 14 letra D) Nº 3 letra (k) y Nº 8 letra (a) numeral (viii) LIR, con tasa 3%, por reitegro de préstamo tasa 0%, segun art. 9º letra c) Ley Nº 21.252',
    signo: '+',
    grupo: 'retenciones',
  },
  '565': { glosa: 'Mineros Art. 84 a)', signo: '+', grupo: 'retenciones' },
  '700': { glosa: 'Explotador Minero Art. 84 h)', signo: '+', grupo: 'retenciones' },
  '806': { glosa: 'Explotador Minero Royalty Ley 21.591', signo: '+', grupo: 'retenciones' },
  '66': {
    glosa: 'Transportistas acogidos a Renta Presunta, Art. 84, e) y f) (tasa de 0,3%)',
    signo: '+',
    grupo: 'retenciones',
  },
  '721': { glosa: 'Crédito a Imputar', signo: '-', grupo: 'retenciones' },
  '152': { glosa: '2da. Categoría Art. 84, b) (tasa 10%)', signo: '+', grupo: 'retenciones' },
  '157': {
    glosa:
      '2da. Categoría. Art. 84 letra b) LIR con tasa 3%, por reintegro de préstamo tasa 0%, según art. 7º Ley Nº 21.242 y art. 9º letra b) Ley Nº 21.252',
    signo: '+',
    grupo: 'retenciones',
  },
  '70': {
    glosa: 'Taller artesanal Art. 84, c) (tasa de 1,5% o 3%)',
    signo: '+',
    grupo: 'retenciones',
  },
  '766': {
    glosa:
      'Renta Líquida Provisional inciso final de la letra a) del art 84 de la LIR, Ley Nº 21.210',
    signo: '',
    grupo: 'retenciones',
  },
  '595': {
    glosa:
      'SUB TOTAL IMPUESTO DETERMINADO ANVERSO. (Suma de las líneas 49 a 64, columna Impuesto y/o PPM determinado)',
    signo: '=',
    grupo: 'retenciones',
  },
  '529': { glosa: 'Ventas del período', signo: '', grupo: 'otros' },
  '530': { glosa: 'Crédito del período"+"', signo: '', grupo: 'otros' },
  '409': {
    glosa: 'IVA determinado por concepto de Tributación Simplificada',
    signo: '+',
    grupo: 'otros',
  },
  '522': { glosa: 'Letras e), i), l) (tasa 15%)', signo: '+', grupo: 'otros' },
  '526': { glosa: 'Letra j) (tasa 50%)', signo: '+', grupo: 'otros' },
  '113': { glosa: 'Letra j) (tasa 50%)', signo: '+', grupo: 'otros' },
  '28': {
    glosa: 'Crédito de impuesto Adicional Art.37 letra a) b) y c) D.L 825/74',
    signo: '-',
    grupo: 'otros',
  },
  '548': {
    glosa: 'Crédito de impuesto Adicional Art.37 letra a) b) y c) D.L 825/74',
    signo: '-',
    grupo: 'otros',
  },
  '540': { glosa: 'Remanente crédito Art.37 mes anterior D.L.825/74', signo: '-', grupo: 'otros' },
  '541': {
    glosa:
      'Devolución Solicitud Art.36 relativa al impuesto Adicional Art.37 letras a), b), y c) D.L.825/74',
    signo: '+',
    grupo: 'otros',
  },
  '549': {
    glosa: 'Remanente crédito impuestos Art.37 para período siguiente',
    signo: '+',
    grupo: 'otros',
  },
  '577': { glosa: 'Pisco, Licores, Whisky y Aguardiente (tasa 31,5%)', signo: '+', grupo: 'otros' },
  '32': { glosa: 'Vinos, Champaña, Chichas (tasa 20,5%)', signo: '+', grupo: 'otros' },
  '150': { glosa: 'Cervezas (tasa 20,5%)', signo: '+', grupo: 'otros' },
  '146': { glosa: 'Bebidas analcohólicas (tasa 10%)', signo: '+', grupo: 'otros' },
  '752': {
    glosa: 'Bebidas analcohólicas elevado contenido azÚcares (tasa 18%)',
    signo: '+',
    grupo: 'otros',
  },
  '545': { glosa: 'Notas de Débito emitidas', signo: '+', grupo: 'otros' },
  '546': { glosa: 'Notas de Crédito emitidas por Facturas', signo: '-', grupo: 'otros' },
  '710': {
    glosa: 'Notas de Crédito emitidas por Vales de máquinas autorizadas por el Servicio',
    signo: '-',
    grupo: 'otros',
  },
  '602': {
    glosa: 'Notas de Crédito emitidas por Vales de máquinas autorizadas por el Servicio',
    signo: '=',
    grupo: 'otros',
  },
  '575': { glosa: 'Pisco, Licores, Whisky y Aguardiente (tasa 31,5%)', signo: '+', grupo: 'otros' },
  '574': { glosa: 'Vinos, Champaña, Chichas (tasa 20,5%)', signo: '+', grupo: 'otros' },
  '580': { glosa: 'Cervezas (tasa 20,5%)', signo: '+', grupo: 'otros' },
  '582': { glosa: 'Bebidas analcohólicas (tasa 10%)', signo: '+', grupo: 'otros' },
  '753': {
    glosa: 'Bebidas analcohólicas elevado contenido azÚcares (tasa 18%)',
    signo: '+',
    grupo: 'otros',
  },
  '551': { glosa: 'Notas de Débito recibidas', signo: '+', grupo: 'otros' },
  '559': { glosa: 'Notas de Crédito recibidas', signo: '-', grupo: 'otros' },
  '508': { glosa: 'Remanente Crédito Art.42 mes anterior', signo: '+', grupo: 'otros' },
  '533': {
    glosa: 'Devolución Art.36 D.L.825/74 relativas impuesto Art.42',
    signo: '-',
    grupo: 'otros',
  },
  '552': {
    glosa: 'Monto reintegrado devoluciones indebidas de crédito por exportaciones',
    signo: '-',
    grupo: 'otros',
  },
  '603': { glosa: 'Total créditos Art.42 DL 825', signo: '=', grupo: 'otros' },
  '507': {
    glosa: 'Remanente Crédito Impuesto Adic. Art.42 para período siguiente',
    signo: '+',
    grupo: 'otros',
  },
  '556': { glosa: 'IVA anticipado del período', signo: '+', grupo: 'otros' },
  '557': { glosa: 'Remanente del mes anterior', signo: '+', grupo: 'otros' },
  '558': { glosa: 'Devolución del mes anterior', signo: '-', grupo: 'otros' },
  '543': { glosa: 'Total de Anticipo', signo: '=', grupo: 'otros' },
  '573': {
    glosa: 'Remanente Anticipos Cambio Sujeto para período siguiente',
    signo: '-',
    grupo: 'otros',
  },
  '39': {
    glosa: 'IVA total retenido a terceros (tasa Art.14 D.L. 825/74)',
    signo: '+',
    grupo: 'otros',
  },
  '554': { glosa: 'IVA parcial retenido a terceros (según tasa)', signo: '+', grupo: 'otros' },
  '736': { glosa: 'IVA Retenido por notas de crédito emitidas', signo: '-', grupo: 'otros' },
  '597': { glosa: 'Retención del margen de comercialización', signo: '+', grupo: 'otros' },
  '555': { glosa: 'Retención Anticipo de Cambio de Sujeto', signo: '+', grupo: 'otros' },
  '100': {
    glosa:
      'IVA retenido a terceros con retención total en el período (inciso 7° del Art. 3° del D.L. 825)',
    signo: '+',
    grupo: 'otros',
  },
  '101': {
    glosa:
      'Ajustes por concepto de IVA asociado a reversiones y contracargos (disputas) solucionadas en el período.',
    signo: '-',
    grupo: 'otros',
  },
  '102': {
    glosa: 'Valor nominal del remanente de ajuste (código 104 del período anterior).',
    signo: '-',
    grupo: 'otros',
  },
  '103': { glosa: 'Monto neto de IVA retenido en el período.', signo: '=', grupo: 'otros' },
  '104': { glosa: 'Remanente de ajuste para el próximo período.', signo: '=', grupo: 'otros' },
  '811': {
    glosa:
      'IVA total del período por la venta remota de bienes corporales muebles (Art. 3° bis e inciso final del Art. 4°, D.L. 825).',
    signo: '+',
    grupo: 'otros',
  },
  '812': {
    glosa:
      'Ajustes por concepto de IVA asociado a reversiones y contracargos solucionados en el período.',
    signo: '-',
    grupo: 'otros',
  },
  '813': {
    glosa: 'Valor nominal del remanente de ajuste (código [815] del período anterior).',
    signo: '-',
    grupo: 'otros',
  },
  '814': { glosa: 'Monto neto de IVA del período.', signo: '=', grupo: 'otros' },
  '815': { glosa: 'Remanente de ajuste para el próximo período.', signo: '=', grupo: 'otros' },
  '816': {
    glosa:
      'Impuesto sustitutivo retenido por régimen tributario especial a comerciantes de ferias libres (párrafo 7° ter, Título II, LIVS)',
    signo: '=',
    grupo: 'otros',
  },
  '725': { glosa: 'Crédito por Sistemas Solares Térmicos, Ley 20.365', signo: '-', grupo: 'otros' },
  '704': { glosa: 'Imputación del Pago Patente Aguas Ley 20.017/05', signo: '-', grupo: 'otros' },
  '160': { glosa: 'Cotización Adicional Ley 18.566/86', signo: '-', grupo: 'otros' },
  '126': {
    glosa: 'Crédito Especial Empresas Constructoras Art.21 DL 910/75',
    signo: '-',
    grupo: 'otros',
  },
  '572': {
    glosa: 'Recuperación de Peajes Transportistas Pasajeros Ley 19.764/01',
    signo: '-',
    grupo: 'otros',
  },
  '768': { glosa: 'Crédito por desembolsos directos trazabilidad', signo: '-', grupo: 'otros' },
  '547': { glosa: 'Total Determinado', signo: '=', grupo: 'otros' },
  '728': {
    glosa: 'Remanente Crédito por Sistemas Solares Térmicos, Ley 20.365',
    signo: '',
    grupo: 'totales',
  },
  '707': {
    glosa: 'Remanente periodo siguiente Patente Aguas. Ley 20.017/05',
    signo: '',
    grupo: 'totales',
  },
  '73': {
    glosa: 'Remanente Cotización Adicional Ley 18.566/86(tasa Art.14 DL 825/74)',
    signo: '',
    grupo: 'totales',
  },
  '130': {
    glosa: 'Remanente Crédito Especial Empresas Constructoras',
    signo: '',
    grupo: 'totales',
  },
  '591': {
    glosa: 'Remanente Recuperación de Peajes Transportistas Pasajeros Ley 19.764/01',
    signo: '',
    grupo: 'totales',
  },
  '771': {
    glosa: 'Remanente Crédito por desembolsos directos trazabilidad',
    signo: '',
    grupo: 'totales',
  },
  '91': {
    glosa: 'TOTAL A PAGAR DENTRO DEL PLAZO LEGAL (Suma líneas 1 a la 65)',
    signo: '=',
    grupo: 'totales',
  },
  '92': { glosa: 'Más IPC', signo: '+', grupo: 'totales' },
  '93': { glosa: 'Más Intereses y multas', signo: '+', grupo: 'totales' },
  '922': { glosa: 'Condonación', signo: '', grupo: 'totales' },
  '795': { glosa: 'Monto Condonación', signo: '-', grupo: 'totales' },
  '94': { glosa: 'TOTAL A PAGAR CON RECARGO', signo: '=', grupo: 'totales' },
};

/** Glosa for a código, or null when unobserved (then label it by its number). */
export function glosaF29(codigo: string): string | null {
  return F29_CODIGOS[codigo]?.glosa ?? null;
}

/** Group for a código; an unobserved código → 'otros' (surfaced, never hidden). */
export function grupoF29(codigo: string): F29Grupo {
  return F29_CODIGOS[codigo]?.grupo ?? 'otros';
}
