# ADR-035: `alertas` reads F29 by año from SII's « Consulta Integral F29 », per month only where needed

## Status

Accepted — 2026-11-12. Amends ADR-030 (the `f29` source's transport and a new `f29_observada`).
Builds on ADR-020 (GWT-RPC read over `requestText`), ADR-027 (no browser), ADR-029 (`Gwt7Codec`).

## Context

`alertas`' `f29` source costs 1 + 12 paced calls: `propuestaf29ui getDeclaracionConEstados` takes
one `mes` + `anno` per call. Without `mes` (absent, `""`, `null`, `"00"`) it answers « Ocurrio un
error desconocido », and its rows carry no período (probed 2026-11-12). F29 observaciones (#206)
had no known endpoint.

SII's « Consulta Integral F29 » (`www4.sii.cl/sifmConsultaInternet/index.html?dest=cifxx&form=29`,
id 1368 in the public catalog `zeusr.sii.cl/admin/js/tramites_misii.js`) shows a year at once. The
spike of 2026-11-12 (empresa account) captured it headless, then went browser-free:

- **The call:** `SvcConsulta.getInfoIntegral(String "IVAEXP", int año, int 7, RutDto, String "DPS",
  String null, LogAuditoriaDTO, String token)`, GWT-RPC protocol 7, `www4.sii.cl/sifmConsultaInternet/svcConsulta`.
- **Over HTTP:** a body encoded from scratch was byte-identical to the browser's, and so was
  SII's answer. Changing only the año answers that año. One año took 56 ms, against 12.3 s for
  `f29 overview`'s 12 paced calls.
- **Where each value comes from:**
  - `RutDto` (`[char dv, long rut]`) and two `Integer`s come from the session RUT.
  - Nine fields are constants in the app's public JS.
  - One upper-case field is already in Mi SII's HTML (`DatosCntrNow`), which `alertas` reads anyway.
  - The IP comes from `SvcConsultaExt.getIpLocal`. The HTTP client's own IP worked.
  - The token is not validated (a placeholder gave the same answer), as with SISPAD (ADR-020).
- **Answer:**
  - `ResumenDeclaracionesTo` → `ResumenFiscaAnualDTO` (form 29) → a map keyed by month → that
    month's `EstadoFormulariosDTO[]`, 21 fields (layouts read from the app's deserializers; the
    decoder consumed the payload exactly).
  - Fields checked against `f29 overview`, month by month: 16 = período `YYYYMM`, 15 = folio,
    14 = fecha-hora, 2 = observación (`SINOBS` = « Declaración sin observaciones. » in the app),
    4 = estado (`DRCP`, `DRSP`; the app also knows `DRRC`, `DRTR`, `DRCG`).
  - A month with a declaración here is exactly a month `overview` reads « Vigente ». The total is
    not in the DTO.
- **Not seen:** a Guardada or Rechazada F29, an observed F29, and what `DRSP` means.

## Decision

- **Transport:** facade `portal/f29-sifm.ts` over `PortalSession.requestText` (HTTP, ADR-027),
  encoded with `Gwt7Codec`. Write and read layouts are keyed by class name and extracted from
  the app's permutation (a `sifm-schema-extract.py` beside `rfi-schema-extract.py`). The policy
  and each CRC are read from the live permutation and self-healed on a policy error (ADR-020).
  The bootstrap file that names the permutation was not observed (the `.nocache.js` guess is a
  404): finding it is part of the implementation.
- **Every value is sourced the way SII's client sources it, never invented:**
  - constants from the app;
  - the RUT from the session;
  - the upper-case field from `DatosCntrNow`;
  - the IP from one `getIpLocal` per run.

  The token is a constant placeholder.
- **Hybrid `f29` source:**
  1. `getIpLocal`, then one `getInfoIntegral` per año the window touches (≤ 2).
  2. A window month with a declaración there is filed: no `getDeclaracionConEstados` for it.
  3. Only window months with none are read month by month, exactly as ADR-030 does today:
     Guardada, Rechazada, `otro_estado`, `sin_declarar`, the #208 regime rule and the #245 BTE rule.

  Cost for an account that is up to date: ~3 calls (from 13). Each missing month adds one, as today.
- **`f29_observada`:** a declaración whose observación is not `SINOBS` gives one alerta. Its
  `codigo` is SII's code verbatim (any value, never dropped), with `folio` and `fecha`. The id is
  `f29:<periodo>:observada:<codigo>:<folio>`. This covers #206 for F29.
- **`DRSP` / `DRCP` are data, not alertas.** Their meaning is not confirmed against SII's own text,
  so no alerta rests on them until a later observation says what they are.
- **Fallback, never silence:**
  - A policy or layout failure first re-syncs the policy.
  - If it still fails, the source reads all 12 months as ADR-030 does today (no observaciones) and
    says so: `fuentes[].via: "mes_a_mes"` plus the integral's error kind.
  - A dead session or a rate limit aborts as always (ADR-030).
- **PII:** the request carries the RUT, and the DTO holds a field shaped like it (field 1). Only
  período, folio, fecha, estado, observación and medio (`MPD_*`) are curated, with no `raw`, and
  the fixtures are synthetic.

## Alternatives Considered

1. **Integral only.** Rejected: a Guardada or Rechazada F29 was never seen there, so a month saved
   but not sent would read « sin declarar ». The hybrid keeps today's alertas for those months.
2. **Per month plus the integral for observaciones.** Rejected: ~16 calls instead of 13, when the
   point is fewer.
3. **A source `error` when the integral breaks.** Rejected: a SII redeploy would switch F29 alertas
   off until a code change, and the per-month path still works.
4. **Alert on `DRSP` as « posible pago pendiente ».** Rejected for now: its meaning is unconfirmed,
   and a false « impago » on a paid month is worse than waiting for an observation.
5. **Drive the app in a browser.** Rejected: ADR-027. The HTTP replay is proven.

## Consequences

- Easier: a default `alertas` run drops from ~25 to ~15 calls, and F29 observaciones become
  visible. `f29 overview` could later use the same call (it still needs the total, which the
  integral does not carry).
- Risk: a second GWT app with its own redeploy cadence. The self-heal and the per-month fallback
  bound it, and `via` tells the caller when it happens.
- Obligation: the `f29_observada` id joins ADR-030's contract. The `getInfoIntegral` and
  `LogAuditoriaDTO` shapes go to `docs/sii-contract/f29.md` with the date observed.
