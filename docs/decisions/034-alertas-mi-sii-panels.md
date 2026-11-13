# ADR-034: `alertas` reads Mi SII's « Mis alertas » panels, one `origen` each, and a short profile

## Status

Accepted — 2026-11-12. Amends ADR-030 (new sources, `--fuentes` alias); reuses ADR-032's transport.

## Context

`alertas` costs ~20 paced SII calls (ADR-030), mostly F29 (1 + 12) and F22 (≤ 6), and still lacks
the situación tributaria (#204) and the notificaciones (#205). Mi SII was redesigned and now shows a
« Mis alertas » section. It is not a dedicated endpoint: SII's own `misii.min.js` (public, read
2026-11-12) assembles it in the browser from separate `CViewCarta.cgi` calls, the CGI ADR-032
already reads (`opc=34`). A headless capture of the redesigned page (persona and empresa,
2026-11-12) confirmed it calls nothing else, and every call below was probed over the HTTP driver:

| Panel | Source | Calls |
|---|---|---|
| Revisiones a distancia | `DatosCntrNow.alertas[]`, `taltCodigo` `1040` / `1041` (SII's own filter) | 0 (the page `alertas` already reads) |
| Anotaciones vigentes | `opc=28` → `{codigo, descripcion, objSalida[]}` | 1 |
| Mensajes informativos | `opc=33` → `{codigoError, mensajes[]}` | 1 |
| Notificaciones | `opc=41&VIEW=1` → `{estado, glosa, data[], metaData}` (SDI `getNotificaciones`) | 1 |
| Transferencias bancarias | `opc=119` → `{listCarpetaTributaria[]}` | 1 |
| Cumplimiento semestral | `opc=118` → `{estado, semestreActual, atributos[], historicos}` | 1 |

Observed empty answers: `opc=28` `codigo 97` « Contribuyente no posee observaciones/alertas
vigentes »; `opc=33` `codigoError 0` + `mensajes: null`; `opc=41` `estado 1403` « No existen
registros »; `opc=119` `[]`. Without cookies every `opc` answers `200` `{"codigoResp":-2,
"glosaRespuesta":"Error: Autenticacion"}`, as `opc=34` does (#236). Rows were observed for
notificaciones and the requisitos of `opc=118` (`NDIR`, `DQDT`, `ATPJ`; SII's code also knows
`MORT`). The other four were only seen empty.

## Decision

- **One `origen` per panel, on by default:** `revisiones`, `anotaciones`, `mensajes`,
  `notificaciones`, `transferencias`, `cumplimiento`. Each has its own `fuentes` estado, so one
  panel failing never hides the others (ADR-030's partial-result model). A full run grows by 5
  calls (~25). Facade `portal/alertas-misii.ts` over `requestForm`, browser-free (ADR-027).
- **Short profile: `--fuentes mi_sii`** (MCP: `fuentes: ["mi_sii"]`) expands to those six plus
  `bienes_raices`: 7 calls, all to one host. The default stays "all"; nothing changes for a caller
  that passes nothing. `--help` and the MCP description state both costs.
- **Every answer is classified, never assumed.** `codigoResp -2` ⇒ `SessionExpiredError` (aborts,
  ADR-030). Each observed empty code above ⇒ no alertas. Any other code ⇒ that source is `error`
  with SII's text verbatim. Rows that do not match the curated shape ⇒ `error`, never `[]`.
- **Fields from SII's own renderer where unobserved** (sii-wire.md): anotaciones
  `setDisplayAnotaciones` (`taltCodigo`, `cantTaltCodigo`, `fechaActivacion`, `glosaSubstr`,
  `accionStr`); mensajes `getMsgEmergentes` (`glosaTitulo`, `glosaDescripcion`, `glosaSolucion`);
  transferencias `pintarBodyInterfazDataCarpeta` (`semestre`, `glosaNombreBanco`,
  `glosaTipoCuenta`, `sumaCantidadAbonos`, `sumaMontoTotalAbonos`); revisiones
  `generarGrillaAlertas` (`folioBloqueo`, `fechaActiv`, `descripcion`). The contract
  (`docs/sii-contract/mi-sii-alertas.md`) marks each as « from the renderer, not observed ».
- **Alertas and ids** (ADR-030 shape; `codigo` / `mensaje` / `estado` are SII's own text):
  - `revisiones`: `revision:<folioBloqueo>`, `fecha` = `fechaActiv`.
  - `anotaciones`: `anotacion:<taltCodigo>:<fechaActivacion>`, `mensaje` = `glosaSubstr`.
  - `mensajes`: `mensaje:<first 12 hex of sha1(glosaTitulo)>`: SII gives no id, so the title is it.
  - `notificaciones`: `notificacion:<id>`, `fecha` = the epoch-ms `fecha` as a Chile date. Every
    notification is returned (page size 1000), old ones included: seed the ids or use `--desde`.
  - `transferencias`: `transferencias:<semestre>:<glosaNombreBanco>:<glosaTipoCuenta>`, plus a
    `transferencias: { semestre, banco, tipoCuenta, cantidad, monto }` field (ADR-030's
    `vencimiento` precedent).
  - `cumplimiento`: `cumplimiento:<atrCodigo>` for a requisito whose `cumple` is not `"SI"`.
    `"NO"` and any unobserved value are both reported, never dropped. `estado` = the global
    `estado`, `mensaje` = `titulo`.
- **`cumplimiento` never gates another source.** `NDIR` (« atrasos en declaración de IVA y/o
  Renta ») is SII's semestral evaluation, and when it refreshes was not observed. An `NDIR` that
  reads "SI" never skips the F29 or F22 read.
- **PII stays out.** A notificación's `descripcion` was observed carrying a RUT, and a revisión
  row carries a domicilio (`calle`, `numero`, `comunaDescripcion`…). Fields are curated with no
  `raw`, the domicilio is never read, and fixtures are synthetic. The audit receipt keeps counts
  and estados only (ADR-030).

## Alternatives Considered

1. **One `origen: mi_sii` for all panels.** Rejected: one failing panel would turn every panel
   `error`, or need a partial state inside a source, which ADR-030's model does not have.
2. **New origenes, opt-in only.** Rejected: the default run would miss notificaciones and
   anotaciones, the information the owner most wants surfaced.
3. **A `--rapido` flag, or a short default.** Rejected: a second way to choose sources beside
   `--fuentes`, and a short default is **Breaking**: it hides « sin declarar » from callers that do not adapt.
4. **Wait for a populated sample before reading the four unobserved panels.** Rejected: neither
   test account may ever show one. SII's renderer is first-hand SII code (ADR-004), and a
   mismatch fails loudly as `error`.
5. **Skip F29 when `NDIR` cumple.** Rejected for the reason ADR-030 rejected a TTL cache: an
   evaluation of unknown freshness would hide a fresh « sin declarar ».

## Consequences

- Easier: a daily check is `alertas --fuentes mi_sii`: 7 calls on one host, covering what SII
  itself flags. #204 (anotaciones, cumplimiento) and #205 (notificaciones) are covered.
- Risk: four row shapes come from SII's renderer, not from a live sample. The first real one may
  need an alias, and until then that source reports `error`, never silence. The `mensajes` id
  changes if SII rewrites a title.
- Obligation: the new ids join ADR-030's contract; changing one is **Breaking**.
