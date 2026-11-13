# ADR-035: `alertas` reads F29 by año from SII's « Consulta Integral F29 », per month only where needed

## Status

Accepted — 2026-11-12. Amends ADR-030 (the `f29` source's transport and a new `f29_observada`).
Builds on ADR-020 (GWT-RPC read over `requestText`), ADR-027 (no browser), ADR-029 (`Gwt7Codec`).

## Context

`alertas`' `f29` source costs 1 + 12 paced calls: the `DatosCntrNow` read, then one
`propuestaf29ui getDeclaracionConEstados` per month (`mes` + `anno`). Without `mes` (absent, `""`,
`null`, `"00"`) SII answers « Ocurrio un error desconocido », and the rows carry no período (probed
2026-11-12). F29 observaciones (#206) had no known endpoint.

SII's « Consulta Integral F29 » (`www4.sii.cl/sifmConsultaInternet/index.html?dest=cifxx&form=29`,
id 1368 in the public catalog `zeusr.sii.cl/admin/js/tramites_misii.js`) shows a whole year.
The spike of 2026-11-12 (empresa account) captured it headless, then went browser-free:

- **Call:** `SvcConsulta.getInfoIntegral(String "IVAEXP", int año, int 7, RutDto, String "DPS",
  String null, LogAuditoriaDTO, String token)`, GWT-RPC 7, `www4.sii.cl/sifmConsultaInternet/svcConsulta`.
- **Over HTTP:** a body encoded from scratch was byte-identical to the browser's, and so was SII's
  answer. Changing only the año answers that año. One año: 56 ms; `f29 overview`'s 12 calls: 12.3 s.
- **Where the values come from:**
  - `RutDto` (`[char dv, long rut]`) and two `Integer`s come from the session RUT.
  - Seven are app-JS constants. Two one-digit fields match both a constant and earlier answers.
  - One upper-case field is in Mi SII's HTML (`DatosCntrNow`), which `alertas` reads anyway.
  - The IP comes from `SvcConsultaExt.getIpLocal`; the HTTP client's own IP worked.
  - The token is not validated (a placeholder answered the same), as with SISPAD (ADR-020).
  - Where the `int 7` comes from was **not traced**.
- **Answer:**
  - `ResumenDeclaracionesTo` → `ResumenFiscaAnualDTO` (form 29) → a map keyed by month → that
    month's `EstadoFormulariosDTO[]`, 21 fields. The layouts come from the app's deserializers, and
    the decoder consumed the whole payload.
  - Fields checked against `f29 overview`, month by month: 16 = período `YYYYMM`, 15 = folio,
    14 = fecha-hora, 4 = estado (`DRCP`, `DRSP`, both matching « Vigente »; the app also knows
    `DRRC`, `DRTR`, `DRCG`).
  - Field 2 is the observación: `SINOBS`, presumably « Declaración sin observaciones. » (that label
    is in the app, the code is not).
  - No total.
- **Not seen:** a Guardada or Rechazada F29 in the integral, an observed F29, and what `DRSP` means.

## Decision

- **Transport:** facade `portal/f29-sifm.ts` over `PortalSession.requestText` (HTTP, ADR-027),
  encoded with `Gwt7Codec`. Write and read layouts are keyed by class name and extracted from the
  app's permutation (`sifm-schema-extract.py`, beside `rfi-schema-extract.py`). The policy and the
  CRCs are read live and self-healed (ADR-020). The bootstrap that names the permutation was not
  observed (`.nocache.js` is a 404): finding it is implementation work.
- **Each value is sourced as SII's client sources it, never invented:** constants from the app,
  the RUT from the session, the upper-case field from `DatosCntrNow`, the IP from one `getIpLocal`
  per run, and a constant placeholder token. The `int 7` must be traced to its source before it
  ships; until then it is a constant observed on 2026-11-12.
- **Hybrid `f29` source:**
  1. `getIpLocal`, then one `getInfoIntegral` per año the window touches (≤ 2).
  2. A month counts as filed only when its integral estado is one observed to match « Vigente »
     (`DRSP`, `DRCP`). Such a month needs no `getDeclaracionConEstados`.
  3. Every other window month is read month by month, exactly as ADR-030 does today: no entry, any
     other estado (`DRRC`, `DRTR`, `DRCG`, an unknown one). Its rules (Guardada, Rechazada,
     `otro_estado`, `sin_declarar`, #208's regime rule, #245's BTE rule) are untouched.

  An up-to-date account costs ~4 calls (from 13: `DatosCntrNow`, `getIpLocal`, ≤ 2 años), plus a
  cached permutation GET for the policy. Each month that is not filed adds one call, as today.
- **`f29_observada`:** a declaración whose observación is not `SINOBS` gives one alerta. `codigo`
  is SII's code verbatim (any value, never dropped), with `folio` and `fecha`. The id is
  `f29:<periodo>:observada:<codigo>:<folio>`. It follows ADR-030's adjective style
  (`guardada`, `rechazada`) rather than #206's `observacion`; the folio separates rectificatorias.
- **`DRSP` / `DRCP` are data, not alertas** until SII's own text confirms what they mean.
- **Fallback, never silence:**
  - A policy or layout failure re-syncs the policy.
  - If it still fails, the source reads the 12 months as today (no observaciones) and says so:
    `fuentes[].via: "mes_a_mes"` + the integral's error kind.
  - A dead session or a rate limit aborts (ADR-030).
- **PII:** the request carries the RUT, and DTO field 1 looks like one. Only período, folio, fecha,
  estado, observación and medio (`MPD_*`) are curated; no `raw`; synthetic fixtures.

## Alternatives Considered

1. **Integral only.** Rejected: a Guardada or Rechazada F29 was never seen there, so a month saved
   but not sent would read « sin declarar ». The hybrid keeps today's alertas for those months.
2. **Per month plus the integral for observaciones.** Rejected: ~16 calls instead of 13.
3. **A source `error` when the integral breaks.** Rejected: a SII redeploy would switch F29 alertas
   off until a code change, while the per-month path still works.
4. **Alert on `DRSP` as « posible pago pendiente ».** Rejected for now: its meaning is unconfirmed,
   and a false « impago » on a paid month is worse than waiting for an observation.
5. **Drive the app in a browser.** Rejected: ADR-027. The HTTP replay is proven.

## Consequences

- Easier: a default `alertas` run drops from ~25 to ~16 calls, and F29 observaciones become
  visible. `f29 overview` could use the same call later, but it still needs the total.
- Risk: a second GWT app with its own redeploy cadence. The self-heal and the per-month fallback
  bound it, and `via` tells the caller when it happens.
- Obligation: the `f29_observada` id joins ADR-030's contract. The `getInfoIntegral` and
  `LogAuditoriaDTO` shapes go to `docs/sii-contract/f29.md` (« Observaciones », #206's contract
  criterion) with the date observed, in the implementation PR.
