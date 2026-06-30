# SII wire contract — BTE/BHE (Boletas de Honorarios Electrónicas)

> **Ground truth (once built):** the authoritative source for any constant will be
> the cited code in `packages/core/src/portal/bte.ts` + the BHE host in the core
> config (ADR-004 inline `// observed …` citations). This doc is the curated
> in-repo synthesis. All values below are **synthetic placeholders** — no real PII.

**Status (Phase-1 spike #20):** ported from the proven Python `sii-cli`
(`src/sii/core/portal/bte.py`, live-captured 2026-06-14 #62) AND **TS-live-validated
2026-06-30** (prod, persona-natural session, headless `restore` → `goto`/`evaluate`).
The TS pass confirmed: the `.sii.cl` session cookie **SSO-carries to `loa.sii.cl`** on a
headless `restore`+`goto` (all probes landed on `loa.sii.cl`, not the login host); the
inline `xml_values` (annual + monthly meta) and `arr_informe_mensual` (rows) maps read
through `PortalSession.evaluate`; the annual grid, monthly meta, and **emitidas** row
fields match the contract below. Caveat: the test account had **no recibidas and no 2025
emitidas** — the **recibidas row fields are ported from Python, not TS-live-confirmed**
(re-confirm against an account with recibidas).

## Reach — spike #15 for BHE: SESSION-KEYED (answered)

**BHE does NOT support a represented operating RUT (confirmed live #62).** The
`rut_arrastre`/`dv_arrastre` query params are keyed to the **session principal** —
querying an empresa's recibidas from a persona-natural session (`--rut <empresa>`)
returns a non-report page, not the empresa's data. This is **unlike RCV** (body-RUT)
and **like F22/F29** (session-keyed). Therefore (ADR-005): the TS surface **opts out
of the operate pointer, takes NO `--rut`, reads the session principal**, and on a
non-report/cross-RUT page returns the actionable "log in as the empresa" path. The
empresa's BHE is reached by logging in AS the empresa (logout→login).

## Architecture — DISTINCT from the SDI-JSON template (load-bearing)

BTE is **NOT** an `www4.sii.cl` SDI-JSON facade (RCV/F22/F29) and **NOT** a public
HTML CGI (DTE). It is **legacy CGIs on `loa.sii.cl/cgi_IMT/`** that serve an HTML
skeleton (`charset=iso-8859-1`) and **fill their tables client-side from inline JS
global maps**. So the TS facade reads it through the **existing** `PortalSession`
browser primitives — **no new seam** (contrast DTE's `requestPublic`):

| Step | TS seam primitive |
| --- | --- |
| Navigate to the CGI (browser follows the SSO redirect; cookies carry) | `PortalSession.goto(url) → landedUrl` |
| Auth check: `landedUrl` host is `zeusr.sii.cl` ⇒ session didn't carry | URL-based detection (ADR-009) → `NotAuthenticatedError` |
| Read the inline JS map (NOT `page.content()` — cells still hold the filling JS) | `PortalSession.evaluate<T>(expr)` |

**Do NOT scrape the DOM.** After `domcontentloaded` the table cells still hold the
JS that fills them. Read the inline maps with:

```js
typeof xml_values !== 'undefined' ? Object.fromEntries(Object.entries(xml_values)) : null
```

The `Object.entries` wrapper is REQUIRED: both maps are JS `Array`s with **string
keys**, which `JSON.stringify` / a bare `evaluate("xml_values")` would drop (→ empty).
A non-report page leaves the var `undefined` → `evaluate` returns `null` → `BteError`.

**Host (add to core config):** `https://loa.sii.cl/cgi_IMT` (Python `BHE_CGI`).
Recibidas (receptor) = `…BheRec.cgi`; emitidas (emisor) = `…Bhe.cgi`.

## Anti-bot / captcha posture

**None.** 0 `grecaptcha` / `recaptchaService` / `tokenRecaptcha` markers across the
loaded scripts + request bodies (grep-verified). No Google SDK.

## Endpoints

Base: `https://loa.sii.cl/cgi_IMT/`. All reads are **GET**; the operating RUT travels
split as `rut_arrastre` (body, no DV) + `dv_arrastre` (DV).

### `TMBCOC_InformeAnualBheRec` / `…Bhe` — annual summary

`GET TMBCOC_InformeAnualBheRec.cgi?rut_arrastre=11111111&dv_arrastre=1&cbanoinformeanual=2026`

Source: the global **`xml_values`** map. Per-month, per-column keys `xml_values['<mes><N>']`
(mes ∈ `ene`…`dic`; N = column) + `xml_values['sum<mes>']` (total líquido) + `xml_values['tot<N>']`
(column totals). Observed column mapping (same both sides):

| key | field |
| --- | --- |
| `<mes>1` | honorario bruto |
| `<mes>2` | retención de terceros |
| `<mes>3` | retención contribuyente |
| `<mes>4` | folio inicial (surfaced for **emitidas only**) |
| `<mes>5` | folio final (surfaced for **emitidas only**) |
| `<mes>6` | emisiones vigentes |
| `<mes>7` | emisiones anuladas |
| `sum<mes>` | total líquido |

The recibidas UI hides the FOLIOS columns (a folio range is meaningless across
multiple emisores) → surface `folio_inicial`/`folio_final` for **emitidas only**.
Values are **plain digit strings** (`"1300000"`, no separators); empty months are `""`.
The annual report always carries all 12 months (mostly empty) → return all 12 month rows.

**Full observed `xml_values` key set (TS live 2026-06-30, 110 keys):** the 12×7 month-column
grid (`<mes>1`…`<mes>7`) + `sum<mes>` (12) + `tot1`…`tot7` + `sumtot` (grand total), PLUS a
header block: `nombre_contribuyente` **(own-identity PII)**, `rut_arrastre` + `dv_arrastre`
**(own RUT PII)**, `anio_consulta`, `es_sociedad_profesionales` (`SI`/`NO`), `msg_mes`
(a generic UI string: "Para ver el detalle de las boletas, hacer click sobre el mes."). The
header PII keys are **dropped** from the curated output — see PII posture below.

### `TMBCOC_InformeMensualBheRec` / `…Bhe` — monthly detail (paginated)

`GET TMBCOC_InformeMensualBheRec.cgi?cbanoinformemensual=2026&cbmesinformemensual=05&rut_arrastre=11111111&dv_arrastre=1&pagina_solicitada=0`

Source: the global **`arr_informe_mensual`** map, keyed `arr_informe_mensual['<campo>_<i>']`
(i = 1-based row index). Per-page metadata is in `xml_values`. **Monthly `xml_values` meta
keys (TS live 2026-06-30):** `total_boletas`, `pagina_solicitada`, `mes_consulta`,
`anio_consulta`, `porcentaje_retencion`, `suma_honorarios`, `suma_retencion_emisor`,
`suma_retencion_receptor`, `suma_liquido` (the `suma_*` are **plain** digit strings, NOT
dot-formatted) + the same `nombre_contribuyente`/`rut_arrastre`/`dv_arrastre` own-PII header.
Row montos (`totalhonorarios`, `honorariosliquidos`, …) ARE **Chilean dot-formatted**
(`"1.300.000"`) — parse es-CL (cf. F22). Observed row fields:

- **Recibidas** row `_<i>`: `nroboleta`, `rutemisor`+`dvemisor`, `nombre_emisor`,
  **`nombre_receptor`** (the RECEPTOR = self → own-identity PII, live BUG-1), `fecha_boleta`,
  `totalhonorarios`, `honorariosliquidos`, `es_soc_profesional`, `retencion_receptor`,
  `estado` (`S`/`N`), `fechaanulacion`, `cod_comuna`, `codigobarras`.
- **Emitidas** row `_<i>`: `nroboleta`, **`usuemisor`** (the EMITTER = self → own-identity PII,
  live BUG-1), `fechaemision`, `rutreceptor`+`dvreceptor`, `nombrereceptor`, `fecha_boleta`,
  `totalhonorarios`, `es_soc_profesional`, `email_envio` (counterparty email), `retencion_emisor`,
  `retencion_receptor`, `honorariosliquidos`, `estado` (`S`/`N`), `fechaanulacion`, `codigobarras`.

Pagination: walk `pagina_solicitada` from 0; stop once `len(collected) >=
xml_values.total_boletas`, OR a page adds no new rows (dedup by folio + counterparty
RUT — guards a non-advancing loop), OR a `_MAX_PAGINAS` cap. **Pace via `Clock.sleep`**
(ADR-004). **Open TBD (Python too):** behavior beyond page 0 unconfirmed — both test
accounts had single-page months; a >page-size month is the case to confirm live.

## Error envelope

No JSON envelope — state read from the inline maps:

| Condition | Signal |
| --- | --- |
| Report page | `xml_values` (and `arr_informe_mensual` for monthly) defined → `evaluate` returns the dict. |
| Empty month | `arr_informe_mensual` 0 rows / `total_boletas == 0` → a legitimate empty result (annual: all-empty month rows), NOT an error. Confirmed live (#62). |
| Non-report / cross-RUT page | requested var `undefined` → `evaluate` returns `null` → `BteError`. |
| Session bounce | a GET landing on `zeusr.sii.cl` → `NotAuthenticatedError` (domain tasks never mint). |

## Field semantics

| Field | Format |
| --- | --- |
| período (anual) | `cbanoinformeanual=YYYY` |
| período (mensual) | `cbanoinformemensual=YYYY` + `cbmesinformemensual=MM` (zero-padded) |
| RUT operativo | split `rut_arrastre=<body>` + `dv_arrastre=<dv>` (no dots) — **session-keyed** |
| paginación | `pagina_solicitada=N` (0-based) |
| montos | annual: plain int / digit string; monthly: dot-formatted `"1.300.000"` (parse es-CL, cf. F22) |
| fecha | `DD/MM/YYYY` — kept verbatim (ADR-004), not normalized |
| `estado` (per boleta) | `S` = anulada → `ANUL`; `N` = vigente → `VIG`. `fechaanulacion` set when anulada. |
| Soc. Prof. | `SI`/`NO` → bool |

## PII posture — NO `raw` (live BUG-1, 2026-06-30)

BTE exposes **NO `raw`** — only the curated tax fields — exactly like F22/F29 (CONVENTIONS:
drop `raw` when the non-curated data is PII).

- **Annual map + monthly meta** carry the taxpayer's OWN identity (`nombre_contribuyente`,
  `rut_arrastre`, `dv_arrastre`) → never read. Surface only the tax numbers (the month grid /
  `total_boletas` + `suma_*`).
- **Monthly rows** mix counterparty data with the taxpayer's OWN identity on **both** sides:
  EMITIDAS carries `usuemisor` (the emitter = self) and RECIBIDAS carries `nombre_receptor` (the
  receptor = self). Live testing (3 RUTs: persona / empresa / a worker who emitted to the empresa)
  found **BUG-1** — `raw` leaked the session principal's full name via `raw.usuemisor` (emitidas)
  and `raw.nombre_receptor` (recibidas), touching the real PII of two people. A per-field denylist
  was rejected: the full own-identity field set is **not provably enumerable** across both sides /
  future fields. So the curated shape (`folio`, counterparty `contraparte{Rut,Nombre}`, montos,
  retenciones, `estado`, …) IS the whole output — `raw` is dropped. The dropped fields are
  own-identity PII (`usuemisor`/`nombre_receptor`), a counterparty email (`email_envio`), and
  low-value metadata (`codigobarras`, `cod_comuna`) — no tax detail is lost.
- The **audit log** already carried no boleta data (action/result/rut/period/side only) — unaffected.

## Read / write boundary

- **READ (this surface, #20):** the 4 informe CGIs (anual + mensual × recibidas + emitidas).
- **WRITE (out of scope — own ADR):** the `TMBECN_*` emission flow. Emit rides **Clave,
  no certificate** (NOT blocked on the DTE cert layer); its blockers are the legal-weight
  ADR + capturing the form fields + final-submit endpoint.

## Open / TBD (carry into Phase 2)

- **Cookie carry + `evaluate` read: CONFIRMED TS-live (2026-06-30).** No longer open.
- **Recibidas rows not TS-live-confirmed:** the test account had no recibidas → those row
  fields stay ported-from-Python. Re-confirm against an account with recibidas data.
- **Monthly pagination > page 0:** page-size + whether `pagina_solicitada++` advances (vs a
  `pagina_sig_codigo` cursor) — still unconfirmed (the test month had `total_boletas=1`, a
  single page); the `total_boletas` target + no-new-rows dedup guard the common/degenerate
  cases.
- **`porcentaje_retencion`** (monthly meta) — present; its exact semantics/encoding not yet
  pinned (observed once). Record but don't rely on it for the curated view; the per-boleta
  `retencion_emisor`/`retencion_receptor` carry the actual amounts.
- Whether `estado` has values beyond `S`/`N` — observed `N` (vigente) live; extend the label
  map + cite when an anulada (`S`) is seen.
