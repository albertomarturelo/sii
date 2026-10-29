# ADR-029: F29 submit — send the propuesta as-is, declare only, return the payment link

> **Amended 2026-10-19 (#158), after the live capture (spike #138):** the transport is a cold GWT
> replay plus an in-house interpreter of SII's form metadata, with the headless browser as the
> fallback; SII's validation is not proof of completeness; the preview is non-filing, not
> non-mutating. See [Amendment](#amendment-2026-10-19-158).
>
> **Amended 2026-10-20 (#179):** the synthetic oracle injects a synthetic layout into the
> browser instead of having the operator type values. See
> [Amendment](#amendment-2026-10-20-179-the-oracle-injects-the-layout-nobody-types).
>
> **Amended 2026-10-28 (#235):** the submit files only within the plazo; a validated borrador
> carrying SII's recargo block is refused before saving. See
> [Amendment](#amendment-2026-10-28-235-within-the-plazo-only).
>
> **Amended 2026-10-29 (#221):** an opt-in `--sin-movimiento` files a período with no propuesta
> through SII's customizado route, only when SII validates every código at zero. See
> [Amendment](#amendment-2026-10-29-221-sin-movimiento).

## Status

Accepted — 2026-10-18. The posture is decided here. The transport is decided after a live capture
of the submit flow and recorded as an amendment (§ Decision 5). Builds on ADR-017 (the write
posture template), ADR-013 (F29 Fase 1 reads), ADR-005 (session-keyed), ADR-006 (the LLM boundary),
ADR-020 (GWT-RPC) and ADR-027 (HTTP default, CLI never needs a human at a browser).

## Context

`f29 submit` files the monthly IVA declaration. That is a legally-binding act: it creates a tax
obligation, and it can only be undone by a rectificatoria. If the período already has a
declaración vigente, a second send IS a rectificatoria. Today F29 is read-only over the
`propuestaf29ui` SDI JSON. "Enviar Declaración" lives in the `rfiInternet` GWT app and has
**never been captured live** (`sii-contract/f29.md`). The trigger is the autonomous-agent goal:
an agent that can read the month should also be able to file it. Paying is a separate act,
because it moves money through the banks and TGR.

## Decision

1. **Scope: SII's propuesta, as-is.** No código is changed; editing the form is #137, with its
   own ADR. A período with no propuesta is refused. A período whose estado already shows a
   declaración vigente is refused too: rectificatorias are out of scope (#137).
2. **Two phases, like ADR-017.**
   - `f29SubmitPreview(periodo)` is non-mutating. It returns the curated propuesta (Fase 1
     `formulario`) plus the total SII computes for it.
   - `f29Submit(periodo, totalEcho)` re-reads the propuesta immediately before sending and
     aborts **without contacting the submit endpoint** if its total ≠ `totalEcho`. The propuesta
     can change between preview and submit.
   - **CLI**: `sii f29 submit <periodo>` defaults to the preview; the send needs
     `--confirm <total>`.
   - **MCP**: `f29_submit_preview` (`readOnlyHint`) + `f29_submit` (`destructiveHint: true`,
     explicit `confirmar: true` + `total`). Its description says it files a legally-binding
     declaration.
3. **Session-keyed** (ADR-005): `assertOperatingSelf` rejects a representing pointer; NO `--rut`.
4. **Declare only; return the payment link, never pay.** The result is
   `{ periodo, folio, total, estado, pagoUrl | null }`. `pagoUrl` is SII's own payment entry
   for that declaración: the user opens it in THEIR browser, authenticates there themselves and
   pays. Rules:
   - The link must carry **no session material** from our jar (ADR-006). If SII only offers a
     link that embeds a session-bound token, return the generic payment entry point plus the
     folio instead.
   - We never inject our cookies into the user's browser.
   - `pagoUrl` is `null` when there is nothing to pay.
5. **Transport: chosen by the live capture**, in this order of preference:
   1. an SDI JSON op (`requestJson`);
   2. a cold GWT-RPC replay through `portal/gwt.ts` (ADR-020);
   3. the headless browser engine (ADR-027 `engine: 'browser'`).

   A headed browser is never an option in the CLI. The capture is written to
   `sii-contract/f29.md` (submit + payment link), and this ADR is amended with the outcome.
6. **Audit every attempt** with `{ rut, periodo, durationMs, folio?, result }` and never the
   amounts or códigos. A SII rejection is surfaced verbatim; **never retry** a submit.
7. **Live-validate** against a período the user really has to file — never a throwaway.

## Amendment (2026-10-19, #158)

Spike #138 captured the flow end to end on the empresa account, período 2026-09 (2026-10-18/19).
The owner then filed that período from the guarded capture browser. The wire detail is in
`sii-contract/f29.md` § Submit. The Decision above stands except where this says otherwise.

### Transport (§ Decision 5): preference 2, a cold GWT replay

No SDI JSON op files a declaración, so preference 1 is out. The whole flow runs on the
cookies-only session, entered through the propuesta handoff. "Enviar Declaración" asks for **no**
Clave re-entry (`SdiFacade.isAutenticationAvailable` is only a read). The chain:

1. **SDI JSON on `propuestaf29ui`** (`requestJson`): read the propuesta, `guardarPropuesta`,
   `enviarDatosFlujo`, then a `GET rfiInternet/?origen=PROPUESTA&accionPpta=PPTA-F29-COMPLETA`.
2. **GWT reads on `rfiInternet`** (`requestText`, ADR-020): `consultarHijoToken` (gives the
   per-flow `idBorrador`), `getContribuyente`, `findAllFormulario`, `findPeriodoHabilitado`,
   `findVersionBorradorById` (gives the form layout).
3. **The in-house interpreter** loads the propuesta into the layout. It clears stale campo
   values, applies the propuesta's códigos, and evaluates SII's own formula metadata
   (`CampoMetadata` / `Expresion` / `Regla`). That metadata ships with the layout, so this is an
   interpreter over SII's data, not hand-written tax logic (#160).
4. **`getBorradorRfiValidado`** validates the filled form and returns the `BorradorRfi`.
5. **The submit is TWO GWT calls.** `guardarBorradorRfiValidado` saves the validated borrador
   and does NOT file. **`inyectarBorradorRfi`** files, with the `Borrador` the first call
   returned, unchanged. Both are the submit: neither runs in the preview.
6. The folio and estado are read back with the existing `getDeclaracionConEstados`
   (`f29 status`).

`portal/gwt.ts` gains a **serializer** (#159). Its write layouts come from the compiled
permutation's serializers, the same way ADR-020 derived the read layouts from the deserializers.
They are keyed by class name. The rfiInternet policy hash rotates on redeploy and gets ADR-020's
self-heal. A scratch codec built during the spike re-encoded every captured request byte for
byte, including the ~356 KB validation and the ~92 KB submit.

**The fallback is the headless browser engine** (ADR-027 `engine: 'browser'`) clicking SII's own
UI on the same cookies-only session. It has one real advantage: SII's JS computes the form, so
there is no interpreter to get wrong. It is not the default because:
- it drives the GWT SPA through dialogs and navigation, the fragility ADR-013 documented;
- it puts Chromium on the agent's machine, which every other HTTP surface avoids (ADR-027).

It becomes the transport only if the interpreter cannot match the oracle below.

This departs from ADR-013, which judged GWT too brittle to replay by hand and planned F29's
Fase 2 on a real browser. Two things changed since: ADR-020 showed the redeploy brittleness is
absorbed by layouts derived from the permutation plus a self-healing policy hash (SISPAD,
live since 2026-07-03), and the capture showed the form app replays cold when entered through
the propuesta handoff. ADR-013's Fase 2 read path is not re-decided here.

### The safety rule: SII's validation is not proof of completeness

Validating the layout **as `findVersionBorradorById` returns it**, with no formula evaluation,
answered `//OK` and "El Formulario 29 no presenta errores lógicos ni matemáticos". Yet the
borrador was missing **77** (remanente para el período siguiente) and **537** (total créditos),
and still carried **543 / 547 / 573 / 598 / 755 / 774** from an earlier draft. Filing it would
have dropped the remanente that feeds next month's 504. SII's validation neither recomputes nor
flags an omission.

So, before `guardarBorradorRfiValidado`, the task checks the borrador SII validated against
what the propuesta implies:
- every código of the propuesta is present, with its value;
- no código is present that neither the propuesta nor a formula produced (a stale value);
- the derived códigos the formulas must produce are present (e.g. 77 and 537 when 504 > 0);
- at submit only, SII's total equals the confirmed total (§ Decision 2); the preview has no
  confirmed total yet, it shows SII's.

Any disagreement **refuses the submit without contacting either submit op**. The error names
the códigos in conflict, never their amounts. "No presenta errores" is never a reason to proceed.

### The preview is non-filing, not non-mutating

`guardarPropuesta` + `enviarDatosFlujo` leave a borrador **"Guardada"** at SII, and each run
gets a new `idBorrador`. It is not a filing and has no legal effect, but it is a write. So:
- § Decision 2's "`f29SubmitPreview` is non-mutating" now reads **"non-filing"**. The preview runs
  the chain through `getBorradorRfiValidado` and the safety rule, and stops before
  `guardarBorradorRfiValidado`.
- The CLI help and the MCP description say that the preview leaves a borrador saved at SII.
- **`f29_submit_preview` drops `readOnlyHint`** (it writes) **and gets no `destructiveHint`**
  (the borrador is reversible and legally inert). That is ADR-023's line for MIPYME borradores.
- `f29Submit` re-runs the chain through `getBorradorRfiValidado` and the safety rule from fresh
  SII responses before `guardarBorradorRfiValidado`. It never reuses the preview's borrador.

### An ambiguous outcome is resolved by reading, never by resending

A second `inyectarBorradorRfi` for a período with a declaración vigente is a rectificatoria.
If the filing call fails or times out after it was sent, the task does not resend it. It reads
`f29 status` and reports what SII shows. If `guardarBorradorRfiValidado` succeeded and
`inyectarBorradorRfi` failed, nothing was filed; SII's message is surfaced verbatim (ADR-004).
When a step fails, SII's client shows a code: `[mod-gdrpro-rfi3]` (`guardarPropuesta`),
`[mod-envdf-rfi3]` (`enviarDatosFlujo`), an empty `[]` for the rfiInternet validation/submit.
The task surfaces SII's own message the same way.

### The payment link is still unobserved

2026-09 had nothing to pay. § Decision 4 stands, but no payment URL is wired before it is
observed (ADR-004). #162 files período 2026-10 by the CLI and records the link if that month
has a balance. Until then `pagoUrl` is `null`; when the total is positive, the CLI and MCP tell
the user to pay at SII.

### Test data: a synthetic SII oracle

The interpreter cannot be tested against real filings: they are taxpayer data. Instead:
- **The oracle** (#160) is a guarded browser capture. It types SYNTHETIC values into SII's own
  F29 form, lets SII's JS compute, and saves `{inputs → outputs}` (campo values + computed
  cells). Both submit ops are blocked. Its fixtures are committable: no real amounts and no
  header PII (nombre, RUT, dirección).
- **A private check against the real filing** (run6, outside the repo) is gated by an env var
  and skipped when it is unset, like any live test.

## Amendment (2026-10-20, #179): the oracle injects the layout, nobody types

The oracle above assumed the operator types synthetic values into SII's form. Two findings rule
that out:
- **The propuesta carries no values.** `guardarPropuesta` sends only the RUT, the período and the
  propuesta type (run5, observed 2026-10-18). SII builds the propuesta server-side from its own
  data, so no synthetic value can enter through it.
- **The propuesta view is read-only.** In mode PPTA-F29-COMPLETA, the one `f29 submit` uses, the
  client builds each TEXTBOX as a hidden-value field (`wM`, #160). Typing would need another
  mode of the form, and the oracle would then test a path production never takes.

So the oracle **replaces the layout in the browser**:
1. The guarded harness lets `findVersionBorradorById` reach SII, decodes its `//OK` response, and
   builds a synthetic layout from it. The header is blanked, every input campo takes the case's
   synthetic value, and the formula metadata stays SII's own.
2. It answers the client with that layout (`route.fulfill`). SII's own JS fills it in the same
   mode production runs.
3. When the operator clicks to send, the harness records the `getBorradorRfiValidado` request
   (the client's computed output) and **aborts it**. `guardarBorradorRfiValidado` and
   `inyectarBorradorRfi` are aborted too, unconditionally. No synthetic value reaches SII.
4. The fixture is `{synthetic layout → the client's request}`. The test is
   `fillF29Form(layout)` re-encoding to the recorded request.

Costs, accepted:
- the harness needs a protocol-7 response ENCODER. It lives with the harness, outside the
  repo, and is trusted only after it round-trips a captured response;
- reaching the form still runs `guardarPropuesta` + `enviarDatosFlujo`, which leave a borrador
  "Guardada" at SII. That is non-filing (§ The preview is non-filing).

Rejected: typing in another mode of the form (it tests a path production never takes, and is
error-prone); rewriting `guardarPropuesta` (it has no values to rewrite).

## Amendment (2026-10-28, #235): within the plazo only

Between the due day and the end of the month SII still opens the previous período in this flow,
and its validation then adds the **recargo block**: 92 Más IPC, 93 intereses y multas, 795 / 922
/ 915 the condonación, and 94 TOTAL A PAGAR CON RECARGO (`91 + 92 + 93 − 795`). The layout
defines them (`findVersionBorradorById`, permutation `543D42AD0EF9E262804F560CE81AF5A6`,
2026-10-19); a late borrador's real values are not observed yet.

The posture above does not cover that case: the confirm echo is 91, while a late filing pays 94,
and the safety rule would read SII's surcharges as `sobra`. So:
- **Decided:** when SII's validated borrador declares any recargo código, both phases refuse
  before `guardarBorradorRfiValidado`, saying the plazo has passed and the user should file at
  SII. Nothing is saved past the propuesta's borrador.
- The rule is keyed on what SII declares, not on our own reading of the due date (estimated
  holidays, ADR-030), so it cannot refuse a filing SII considers on time.
- Filing late (total 94, SII's surcharges accepted as SII-computed) needs its own amendment and
  a live capture: #237.

Rejected: filing late with total 91 (the echo would not be what the user pays); dropping the
recargo códigos from the safety rule (it would file what nobody reviewed).

## Amendment (2026-10-29, #221): sin movimiento

Decision 1 refuses a período with no propuesta, so a taxpayer without IVA movement could not file
through the CLI. The route was captured live on 2026-10-29 in the guarded browser (both submit
ops aborted; nothing filed). SII's « Declarar sin movimiento » is NOT the propuesta chain:

| Step | Propuesta (this ADR) | Sin movimiento |
| --- | --- | --- |
| propuestaf29ui handoff | `guardarPropuesta` + `enviarDatosFlujo` | `enviarDatosFlujo` only, `tipo: "CUSTOMIZADO"` |
| flow parameters | carry `idBorrador` | carry `accionPpta: TKN_PPTA-F29-CUSTOMIZADO`, no `idBorrador` |
| layout | `findVersionBorradorById(…, idBorrador)` | `findVersionFormularioPrimitivaByPeriodo(…, "FMNINT")` |
| Formulario flag / tipo, validation tipo | TRUE / 40, 40 | FALSE / 1, 1 |
| client screen | `QRb` (773/778 FALSE) | `HMb`: campo 8859 = "3"; the user's cells stay editable |
| save | validated Borrador, tipo 40 → 41 | validated Borrador unchanged (tipo 1) |
| filing | `inyectarBorradorRfi` | the same op (its answer here is not observed yet) |

The interpreter ports both screens from SII's code (`wM`'s editability, `HMb`), and the filled
primitiva layout re-encodes byte for byte into the browser's validation request.

- **Decided:** `sii f29 submit <periodo> --sin-movimiento` (MCP: `sinMovimiento` on both tools)
  takes this route. Without the flag nothing changes.
- **It requires the opposite precondition:** no declaración vigente and NO propuesta. When SII
  has one, it refuses and points to plain `f29 submit`, so the flag never files zeros over SII's
  data.
- **The safety rule is stricter, not looser:** SII's validated borrador must declare no non-zero
  monto and no text, with total 91 = 0. Anything else refuses before saving, the recargo códigos
  included. The confirm echo is `--confirm 0`.
- **The previous month must be filed (Vigente).** SII's propuesta carries the previous month's
  remanente de crédito as 504 (run5/run6), and a propuesta refuses the flag, but SII only knows
  that remanente once the previous month is filed. Declaring a month in zeros before then drops
  the remanente the earlier month may leave, so the task refuses until the previous month is
  Vigente. The exception is the account's first month (the previous one falls before the
  inicio de actividades, read from Mi SII's `DatosCntrNow` as `alertas` does). A month before
  the inicio is refused.
- **Only a período that has ended.** The customizado flow opens any período it is asked for, the
  current and future months included, so the task refuses one that is not over (the month in
  America/Santiago, as SII's client computes it) before contacting SII.
- **A late período is allowed on this route, unlike the propuesta's (#235 amendment).** That
  refusal exists because a late propuesta pays 94, not the 91 the user confirms. A sin movimiento
  declaración has nothing to surcharge, so the validated total is what is filed. A multa for the
  late filing, if SII applies one, is SII's: computed and charged by SII, outside the
  declaración. The CLI neither computes nor hides it, and its help says so. A taxpayer with
  overdue nil months has to file them anyway.
- **The caller asserts the month was nil.** An empty propuesta can also mean SII has not built it
  yet, or that it misses documents outside the RCV, and the CLI cannot tell those apart. The
  flag is that assertion, and the docs say so.
- Everything else holds: run once, never resent; an ambiguous outcome is read with `f29 status`;
  `pagoUrl` is `null` (nothing to pay). The first live filing by this route is its validation.

Rejected: inferring « sin movimiento » from an empty propuesta (the case above); the « Formulario
en Pantalla » or « Upload » options SII also offers (they let the user type values, which is
#137's scope); the headless browser (the cold replay reproduces the client byte for byte).

## Alternatives Considered

1. **Editable form in the first cut.** Deferred to #137. It needs a consistency validator
   (ideally SII's own in-page one, as in ADR-023), a diff-vs-propuesta preview and a
   rectificatoria story, and it is much more surface. The propuesta covers the common month.
2. **Pay inside the flow.** Rejected: it moves money through bank redirects and third-party
   flows. Declaring and paying are separate acts, and the user keeps the second one.
3. **Hand our session to the user's browser** (cookie injection, or a tokenized URL copied out
   of our jar). Rejected: the session would leave the jar, and its token would enter the LLM's
   context (ADR-006). The user authenticating in their own browser is the boundary.
4. **CLI-only.** Rejected: an agent reaches the CLI through Bash anyway, and the user wants
   MCP/CLI parity. What gates the send is the total echo plus `destructiveHint`, not the
   surface.
5. **A single-step submit with no preview or echo.** Rejected for the same reason as ADR-017
   alt. 4: a legally-binding act needs an explicit, informed confirmation.

## Consequences

- An agent can file a month end to end from SII's propuesta and hand the user a link to pay.
- The echo guards against a mistake, not against the agent: an unattended agent can read the
  total from the preview and echo it back. That is accepted for the autonomous-agent goal and
  stated here so nobody mistakes the echo for human approval.
- Honest limitation: SII's propuesta can be incomplete (PPM, retenciones, documents outside the
  RCV). Sending it as-is files exactly what SII proposed, so the preview is the user's chance to
  notice. The CLI help and the MCP description must say so.
- Obligation: the live capture of the submit flow AND the payment link precedes any code. If
  the only transport is the browser, the submit inherits the GWT fragility ADR-013 documented.
