# ADR-029: F29 submit — send the propuesta as-is, declare only, return the payment link

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
