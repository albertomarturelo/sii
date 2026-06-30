# ADR-013: F29 read surface — phased; robust SDI-JSON now, GWT-RPC presented form deferred

## Status

Accepted — 2026-06-29. Scopes the F29 read surface (#18). Builds on ADR-004
(first-hand observation, no third-party), ADR-005 (session-keyed), ADR-006 (PII),
ADR-012 (JSON default).

## Context

The F29 (Declaración Mensual de IVA) read surface was first ported 1:1 from the
Python `sii-cli` (propuesta + estado). The user rejected that scope: it only shows
whether a return was filed (estado) and SII's *proposed* códigos (propuesta) — not
the **balance a contador reads** (ingresos, IVA débito/crédito, determinado, total
a pagar) of the **filed** return, nor that balance **across past months**.

A live spike (2026-06-29, operator-assisted, prod, empresa session) mapped where
that data actually lives:

- **Propuesta** — `propuestaf29ui` SDI **JSON** (`getDeclaracionConCondicionesY
  TipoPropuesta`). Clean, robust. But it is SII's *suggestion*, a sparse subset of
  códigos, served WITHOUT glosas.
- **Estado** — `propuestaf29ui` SDI **JSON** (`getDeclaracionConEstados`). Clean,
  robust, **works for historical months**: per declaración it gives estado, folio,
  fecha and `monto` (the declared total a pagar).
- **The filed form's full código grid** (the real balance, incl. the computed
  totals 538 TOTAL DÉBITOS / 537 TOTAL CRÉDITOS / 89 / 91 TOTAL A PAGAR) lives
  ONLY behind **`rfiInternet` GWT-RPC** — a **two-GWT-app, UI-stateful** flow
  (`sifmConsultaInternet` → `rfiInternet/consulta`), with a token handshake
  (`SdiAATokenService`) and **build-specific strong-name hashes** that change on
  every SII redeploy. The payload is a clean `<FormularioRfi><ListaCodigos>` XML,
  but reaching it requires driving a real browser through the warm-up chain (a cold
  cookies-only replay bounces to the login wall). It is the most complex and most
  fragile surface in the project — exactly the layer the Python project declared
  out of scope.

So: the exact filed balance is expensive and brittle; a robust subset is cheap.

## Decision

**Build F29 in two phases.**

**Fase 1 (this PR) — robust, SDI-JSON only, no GWT-RPC.** Three session-keyed verbs
over the two clean JSON facades:

- `f29 formulario <periodo>` — the **propuesta** códigos, **labeled** (glosa) and
  **grouped** by the form's sections (débitos / créditos / retenciones·PPM / otros /
  determinación). `fuente: 'propuesta'` is explicit — it is SII's suggestion, not
  the filed form.
- `f29 overview <desde> <hasta>` (and a `<año>` shortcut) — **per-month** position
  across a **date range**: each month's vigente estado, folio, fecha and the declared
  **`total`** ("lo que pagué por mes"). Fans out one estado POST per month, paced
  (`Clock.sleep`), capped at 36 months.
- `f29 status <periodo>` — the raw estado records of one month.

The código **taxonomy** (`portal/f29-codigos.ts`: código → glosa + form sign +
group) is OBSERVED first-hand from the rendered form HTML (`rfiInternet/cargarHtml`,
captured in the spike) — a one-time observation, cited (ADR-004). 157 códigos. An
**unobserved código groups to `otros` — surfaced, never hidden** (the anti-allowlist
lesson from F22 #27).

The estado **`monto` is surfaced as `total`** (it is the user's own monthly figure
and the whole point of the overview). It never reaches the audit log (which records
only action/result/period — no amounts), satisfying ADR-006.

**Fase 2 (separate PR + its own ADR) — the presented form via GWT-RPC.** Deferred.
It will read the filed `<FormularioRfi>` XML by driving the browser through the
`rfiInternet` warm-up + intercepting `findDeclaraciones`, parse the código grid, and
add `fuente: 'presentada'` + a computed `resumen` (the real totals). Gated on a
headless warm+intercept PoC proving it is reliably automatable; encapsulated in the
`PortalDriver` with "scraper roto" errors. The taxonomy from Fase 1 is reused as-is.

## Alternatives Considered

1. **Ship the ported propuesta+estado as-is.** Rejected by the user — it is the
   exact limitation the rewrite exists to fix (no readable balance).
2. **Build the GWT-RPC presented form now (single phase).** Rejected for now — it is
   the biggest, most brittle component (two GWT apps redeploying independently,
   strong-name hashes, token handshake, browser-driven), and the spike could not
   finish proving headless automation (the session expired). Deferred to Fase 2
   behind its own ADR + a de-risking PoC, rather than block the robust value.
3. **Propuesta-only (no overview).** Rejected — the historical per-month position
   ("lo que pagué en meses anteriores") is a primary ask and is robustly available
   from estado.

## Consequences

- Easier: a useful, robust F29 ships now — the exact historical totals (overview)
  and a labeled propuesta breakdown — with zero GWT-RPC fragility.
- Honest limitation: the Fase-1 `formulario` is the **propuesta**, not the filed
  form, and propuesta-specific códigos without an observed glosa land in `otros`.
  The ROADMAP F29 row stays partial until Fase 2.
- Obligation: Fase 2 carries the GWT-RPC risk; it gets its own ADR and a PoC gate.
- Reusable: the observed código taxonomy serves both phases.
