// F22 código taxonomy — the DOMAIN knowledge of the Declaración Anual de Renta form,
// separated from the wire facade (`f22.ts`). These two change for different reasons: the
// facade changes when SII moves an endpoint or alters the envelope; this file changes when
// we observe a new código and classify it. Everything here is derived from first-hand
// observation of real declarations (cited inline) — no third-party legend (ADR-004).
//
// Two responsibilities:
//   1. The PII denylist (`HEADER_CODIGOS`) — which códigos are identity/bank, hence dropped.
//   2. The contador grouping (`groupCodigos`) — how the remaining tax códigos organize into
//      the lines a person reads (ingresos / deducciones / retenciones·PPM·créditos / resultado).

/** One curated código of an F22 grid: the code, its parsed value (sign preserved), and the
 *  official form label SII serves inline. This is the JSON-serializable unit the surfaces
 *  render — pure data, no formatting. */
export interface CodigoF22 {
  readonly codigo: string;
  readonly valor: number | null; // int or fractional; sign preserved
  readonly glosa: string | null; // official form label (SII serves it inline)
}

/** The full grid's non-PII códigos organized into the lines a contador reads (#27), each
 *  sign-preserving. Identity/bank PII is already dropped upstream; these groups ORGANIZE the
 *  rest, with `otros` catching any non-PII código not (yet) mapped — so nothing tax-relevant
 *  is hidden. The union of the SIX equals the flat grid. */
export interface F22Grupos {
  readonly ingresos: readonly CodigoF22[]; // rentas / base imponible / honorarios
  readonly deducciones: readonly CodigoF22[]; // rebajas / gastos / pérdidas
  readonly creditos: readonly CodigoF22[]; // retenciones · PPM · créditos (combined by design)
  // Intermediate IGC/IUSC computation steps (IGC según tabla → subtotal → débito fiscal) — NOT
  // final outcomes, so split out of `resultado` (#28 review): a "subtotal" is not a result.
  readonly calculo: readonly CodigoF22[];
  readonly resultado: readonly CodigoF22[]; // FINAL outcomes: impuesto a pagar / devolución / giro
  readonly otros: readonly CodigoF22[]; // non-PII, not (yet) classified — still shown
}

// HEADER / PII códigos — DROPPED from every curated grid (F22 has no `raw`, so these never
// surface anywhere). Authoritative basis: `codigosFormato.codigosCabecera` (the form skeleton,
// live 2026-06-29) lists the 12 header códigos 1/2/3/5/6/7/8/9/13/14/55/903 (apellidos/RUT/
// nombres/calle/folio/comuna/giro/región?/email + 9,903). To those we add the date/moneda
// metadata (15,53,315,8811) and the bank/identity códigos that live in the BODY, not the
// cabecera: 301/306/780 (banco/cuenta/tipo), 9306 (código de banco), 9920 (dirección origen),
// and 8809 (the RUT again as a bare integer — caught leaking via test MF3). Small + bounded +
// authoritative, so the denylist stays comprehensive (we never allowlist tax códigos — that
// hides real income; see CONVENTIONS).
const HEADER_CODIGOS: ReadonlySet<string> = new Set([
  '1',
  '2',
  '3',
  '5',
  '6',
  '7',
  '8',
  '9',
  '13',
  '14',
  '15',
  '53',
  '55',
  '315',
  '903',
  '8809',
  '8811',
  '301',
  '306',
  '780',
  '9306',
  '9920',
]);

/** Is this código identity/bank PII (must be dropped from every grid)? */
export function isHeaderCodigo(codigo: string): boolean {
  return HEADER_CODIGOS.has(codigo);
}

// Semantic código → group map for the `--full` grid (#27). The grid already dropped PII; these
// groups ORGANIZE the remaining (non-PII) tax códigos — anything not mapped falls through to
// `otros` (VISIBLE, never hidden), so the readback stays COMPLETE. Derived from glosas observed
// LIVE across AT 2023–2026 (own account, 2026-06-29); extend it (move a código from `otros` into
// a group) with an `// observed …` citation as new códigos appear (ADR-004).
const INGRESOS_CODIGOS: ReadonlySet<string> = new Set([
  '110', // Rentas percibidas art 42 Nº2 (honorarios)
  '155', // Rentas de capitales mobiliarios (art 20 Nº2)
  '161', // Rta Art 42 Nº1
  '170', // BASE IMPONIBLE ANUAL DE IUSC o IGC
  '461', // Honorarios Anuales Con Retención
  '467', // Total Honorarios
  '545', // Honorarios Anuales Sin Retención
  '547', // Total Ingresos Brutos
  '618', // Total Rentas y Retenciones
  '645', // CPT positivo final
  '646', // CPT negativo final (par de 645 — surfaced via `otros` live 2026-06-29, AT 2026)
  '1098', // Sueldos, pensiones y otras rentas
  '1813', // enajenación/rescate art 107 (recuadro)
  '1814',
  '1816',
  '1829',
  '1830',
  '1867', // Rentas de capitales mobiliarios (recuadro)
]);
const DEDUCCIONES_CODIGOS: ReadonlySet<string> = new Set([
  '169', // Pérdida en operaciones de capitales mobiliarios
  '494', // Gastos presuntos 30% sobre el código 547
  '900', // Cargo por cotizaciones previsionales
]);
// "Retenciones · PPM · Créditos" — retenciones de honorarios, pagos provisionales y créditos.
const CREDITOS_CODIGOS: ReadonlySet<string> = new Set([
  '36', // PPM / Pagos provisionales
  '119', // Remanente de crédito por reliquidación del IUSC
  '162', // Crédito al IGC o IUSC
  '198', // Retenciones por rentas declaradas en código 110
  '492', // Impuesto Retenido de Honorarios Con Retención
  '611', // Retenciones Recuadro Nº1
  '619', // Impuesto Retenido del Total Rentas y Retenciones
  '757', // Remanente código 119 y código 116
  '849', // Pago Provisional (art 84) / Rebaja Crédito AFP
  '1905', // PPM de segunda categoría art 84 letra b)
]);
// Intermediate IGC/IUSC computation steps — NOT final outcomes. Split out of `resultado`
// (#28 review): a "SUB TOTAL" / "según tabla" / "débito fiscal" is a calc step, not a result.
// Surfaced in its own `calculo` group (never hidden — they're real tax códigos).
const CALCULO_CODIGOS: ReadonlySet<string> = new Set([
  '157', // IGC o IUSC, según tabla
  '158', // SUB TOTAL
  '304', // IGC o IUSC, débito fiscal / tasa adicional
]);
const RESULTADO_CODIGOS: ReadonlySet<string> = new Set([
  '31', // IGC o IUSC, tasa adicional
  '39', // Reajuste art.72
  '85', // Saldo a Favor
  '86', // Saldo Puesto a Disposición de los Socios
  '87', // Monto devolución solicitada
  '90', // Impuesto Adeudado
  '91', // TOTAL A PAGAR (90+39)
  '92', // Reajustes Declaración Fuera de Plazo
  '93', // Intereses y Multas Declaración Fuera de Plazo
  '94', // TOTAL A PAGAR (91+92+93)
  '98', // (codigosPie — total/giro)
  '305', // RESULTADO LIQUIDACIÓN ANUAL
  '795', // (codigosPie — total/giro)
]);

/** Organize the (already PII-dropped) grid into the lines a contador reads:
 *  ingresos / deducciones / retenciones·PPM·créditos / cálculo / resultado, with `otros`
 *  catching any non-PII código not yet mapped — so nothing tax-relevant is hidden. Order
 *  within a group preserves the wire order; the union of the SIX equals the input. */
export function groupCodigos(codigos: readonly CodigoF22[]): F22Grupos {
  const ingresos: CodigoF22[] = [];
  const deducciones: CodigoF22[] = [];
  const creditos: CodigoF22[] = [];
  const calculo: CodigoF22[] = [];
  const resultado: CodigoF22[] = [];
  const otros: CodigoF22[] = [];
  for (const c of codigos) {
    if (INGRESOS_CODIGOS.has(c.codigo)) ingresos.push(c);
    else if (DEDUCCIONES_CODIGOS.has(c.codigo)) deducciones.push(c);
    else if (CREDITOS_CODIGOS.has(c.codigo)) creditos.push(c);
    else if (CALCULO_CODIGOS.has(c.codigo)) calculo.push(c);
    else if (RESULTADO_CODIGOS.has(c.codigo)) resultado.push(c);
    else otros.push(c); // non-PII, unmapped — still surfaced
  }
  return { ingresos, deducciones, creditos, calculo, resultado, otros };
}
