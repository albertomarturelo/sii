# ADR-030: `alertas` — a session-keyed composite read with stable ids

## Status

Accepted — 2026-10-23. A new top-level verb under ADR-024 (composites are top-level, like `iva` /
`renta`). Builds on ADR-005 (session-keyed), ADR-012 (JSON), ADR-004 (verbatim SII text, pacing).

## Context

SII does not push most of what a taxpayer must act on: an F22 observación, a petición moving to
"en espera de antecedentes", a month with no F29. The user (or an agent running a daily routine,
#195) learns of it late. Three of the sources #195 lists already exist as facades: F22
observaciones, the F29 per-month estado, and SISPAD peticiones. The rest do not: situación
tributaria (#204) and the notificaciones (#205) were never observed, F29 observaciones (#206) have
no known endpoint, and deuda / giros / convenios live at Tesorería (TGR), another institution.
The sources also differ in auth mode: F22 / F29 are session-keyed, peticiones is body-RUT.

## Decision

- **Verb `sii alertas` / MCP `alertas`** (`readOnlyHint`), read-only. One task,
  `tasks/alertas.ts`, opens ONE `withSession`, calls the portal facades inside it (never the
  other tasks, which would each open a session), paces every call with `Clock.sleep`, and writes
  one audit receipt (rut, count, each source's estado; never SII's text).
- **Session-keyed, no `--rut`.** It reads the session principal (peticiones too, for its own
  RUT); a representing pointer is refused up front (`assertOperatingSelf`). An empresa's
  alertas: log out and log in as the empresa (ADR-005).
- **Phase 1 sources** (each an `origen`):
  - `f22`: the last 3 años tributarios; for each with a declaración (`buscaDeclVgte`, vigente
    folio), one alerta per `situacionObservacion` código.
  - `f29`: the 12 períodos before the current month, decided per período. A Vigente declaración
    ⇒ nothing. Otherwise a record with estado `70` (Rechazada por pago inconcluso) ⇒
    `f29_rechazada`, `10` (Guardada, never sent) ⇒ `f29_guardada`, any unobserved estado ⇒
    `f29_otro_estado` (surfaced, never dropped), with SII's label verbatim. No record past the
    due date ⇒ `f29_sin_declarar`, ONLY inside the account's own obligation window and when the
    window holds a Vigente F29: an account that never files F29 (a persona without giro) gets
    none, and the source says `no_declarante`. **The window and the regime come from the
    account's `DatosCntrNow`** (Mi SII, one more call; observed 2026-10-23): no período before the
    month of `fechaInicioActividades` (`"2026-03-26 00:00:00.0"`) or after `fechaTerminoGiro`, and
    `autorizadoDeclararDia20` (`"S"`) picks the 20th, `"N"` the 12th. Found live: an empresa got
    five false "sin declarar" for the months before it existed.
  - **The F29 due date**, from SII's FAQ (`preguntas_frecuentes/impuestos_mensuales/
    001_130_1060.htm`, updated 17/06/2025, read 2026-10-23): the 12th of the next month in
    general; the 20th for an Internet declaration with payment by an eligible taxpayer
    (facturador electrónico, emisor de BHE); the 28th "sin pago" or sin movimiento; a due date with
    payment on a Saturday or holiday moves to the next business day. `f29_sin_declarar` fires once
    the regime's day has passed (moved off a weekend; holidays are not known, so `estimado: true`;
    an unknown regime keeps the 20th, never early) and carries `vencimiento: { conPago, sinPago }`.
    A sin movimiento filer may still see it until the 28th.
  - `peticiones`: one alerta per petición's latest state transition, SII's note verbatim. A
    closed one is kept: its closing is news, reported once by the id diff. A first run therefore
    lists old closed petitions too; seed the seen ids or use `--desde` (observed live: 4 of 5).
- **The caller picks what to read: `--fuentes f22,f29,peticiones`** (default all; MCP
  `fuentes`). Unifying saves sessions, not SII calls: a full run is ~20 paced requests (F22 ≤ 6,
  F29 1 + 12, one período per call; peticiones 2–3), 16–21 s live, as the three verbs run apart. Most of it rarely changes, so a daily routine can read `f29,peticiones` and run
  everything weekly. `--help` and the MCP description state the cost. A shorter F29 window is
  not the lever: it would break `no_declarante` and drop an unpaid month still pending.
- **Alerta shape** (plain JSON, ADR-012), every field present, `null` when it does not apply:
  `{ id, tipo, origen, periodo, anio, folio, peticion, codigo, estado, mensaje, url, fecha }`,
  plus `vencimiento` on `f29_sin_declarar`. `estado` / `mensaje` / `url` are SII's own label,
  text and ayuda link. `fecha` is `YYYY-MM-DD`: SII's date when it gave one, the passed due date
  for `f29_sin_declarar`, else `null`.
- **Stable ids, no stored state.** Built from what the alerta is, never from the run:
  `f22:<anio>:<folio>:<codigo>`, `f29:<periodo>:<guardada|rechazada|sin_declarar|otro_estado:<id>>
  [:<folio>]`, `peticion:<numero>:<fecha of the latest transition>`. A petición's id changes only
  when its state does. The caller keeps the ids it has seen; `--desde <YYYY-MM-DD>` drops older
  dated alertas (undated ones stay). The CLI stores nothing.
- **Partial results are explicit:** `fuentes: [{ origen, estado: ok | no_declarante | error |
  omitida, error? }]` + `incompleto`. A source's SII error is kept with its kind
  (`classifyError`) and verbatim message, and the other sources still run. A dead session
  (`not_authenticated`, `session_expired`) or SII's rate limit aborts the call: going on would be
  asking again against a block. A non-SII error (a bug) propagates, never hidden as a source error.
- **Out of the verb:** Tesorería, like Previred (only what SII itself shows may join); writes and
  notifications. Situación tributaria, notificaciones and F29 observaciones join as new `origen`s
  once their spikes land.

## Amendment (2026-10-23, #208): SII's regime decides the obligation

"Files F29" was inferred from activity: a Vigente F29 in the window. A new business that has not
filed its first F29 has none, so it read `no_declarante`, the case it needs most. SII's FAQ puts
the obligation on the regime, not on activity: F29 is mandatory every month, sin movimiento
included, for "todos aquellos contribuyentes afectos a la Ley de Impuestos a las Ventas y
Servicios" from the « Inicio de Actividades en la primera categoría » (`preguntas_frecuentes/
impuestos_mensuales/001_130_1051.htm`, `001_130_1053.htm`, updated 05/06/2025, read 2026-10-23)
until the término de giro (`001_130_2312.htm`).

- **Obligated** = `DatosCntrNow.atributos[]` holds an active (no `fechaTermino`, no `eliminado`)
  entry whose `atrCodigo` is a primera-categoría regime AND `fechaInicioActividades` is known.
  Then `sin declarar` runs from the month of inicio with no Vigente F29 needed, and the source
  reads `ok`. Observed 2026-10-23: the empresa carries `14D1` « REGIMEN PRO PYME GENERAL (14D) »;
  the persona (honorarios only) has an inicio de actividades too, but only `NOTI` and `SGPE`
  (« Categoría Contribuyente = 2 »), so inicio alone could not tell them apart.
- **Only observed codes count** (today `14D1`). Another regime (transparente, semi-integrado…)
  joins with its own observation. An unknown code, no atributos or an unparseable shape is
  "unknown", never "not obligated": the activity rule above still applies.
- Rejected: `fechaInicioActividades` alone (flags the persona); `FPYM` (facturador MIPYME), which
  the FAQ ties to IVA only together with a first declaración con movimiento; waiting for the
  situación tributaria (#204), whose actividades list "afecta IVA" but is not observed yet.

## Alternatives Considered

1. **Wait for every source before shipping.** Rejected: two sources are unobserved and may need
   new transports; the three existing ones already cover the cases #195 opens with.
2. **`--rut` applying to the body-RUT sources only.** Rejected: one call would answer for two
   principals at once, and the session-keyed sources would always read "no aplica" for a
   representada.
3. **The CLI keeps the seen ids in `SII_HOME` (`--nuevas`).** Rejected: state that drifts from
   the caller's (a second machine, a reset home); an agent already has memory, and a stable id is
   enough for it.
4. **Calling the existing tasks in sequence.** Rejected: N sessions and N receipts for one read.
5. **Including TGR through the same session.** Rejected here: another institution widens the
   project's scope; it needs its own spike and ADR if ever wanted.
6. **A TTL cache of source results in `SII_HOME`.** Rejected: stored state again, and an alerta
   stays hidden until the entry expires. `--fuentes` cuts the same calls without hiding anything.

## Consequences

- Easier: a daily routine is one command and an id diff. A new source slots in as an `origen`
  without changing the shape.
- Risk: an account with no Vigente F29 in the window and no observed primera-categoría regime
  is silent about missing months by design (a new business in an unobserved regime included).
  The due date is an estimate, and the result says so.
- Obligation: the ids are a contract. Changing one makes every caller see an old alerta as new,
  so an id change is **Breaking** in the changelog (ADR-021 amendment).
