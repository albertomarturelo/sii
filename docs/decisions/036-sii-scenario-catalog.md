# ADR-036: A catalog of simulated SII states that every facade, and every contributor PR, must ship

## Status

Accepted — 2026-11-12. Builds on ADR-003 (seams + fakes), ADR-004 (production is the only target),
ADR-016 (pure main barrel), ADR-034 (row shapes taken from SII's renderer).

## Context

The owner cannot test many SII answers live, because their accounts do not hold the data: an
unpaid cuota (#250), an observed F29, an anotación. External contributors now send whole surfaces.
#274, for example, adds an irreversible write (annul a BHE) in ~1.1k lines and changes the shared
HTTP adapter. It cites wire observations only its author made, and says that two of three reasons
and one SII state were never seen live. Nothing states which SII states a facade must handle, or
separates what was seen from what was guessed, and by whom.

**Threat model.** The goal is to make unverified behaviour visible and honest mistakes fail
early. It cannot stop a deliberate bypass from inside the PR: `ci.yml` runs on `pull_request`, so
a fork's PR runs its own copy of the workflow and the tests. The gate against that is the owner's
review: CODEOWNERS is `* @albertomarturelo`, and branch protection requires a code-owner review.

## Decision

- **A scenario is a named SII state.**
  - It lives in `adapters/fake/scenarios/<surface>.ts`, exported as `testing.scenarios`: pure,
    synthetic data only.
  - Shape: `{ id: '<surface>/<state>', estado, procedencia, validarEnVivoCuando?, issue?, tarea?,
    escritura?, script }`.
  - `script` is a `FakeDriverScript` / `FakeSessionScript`: SII's answers, by URL and request.
- **`procedencia` says what was seen, and by whom:**
  - `observado`: `{ fecha, por: 'mantenedor' | 'contribuidor' }`;
  - `renderer`: `{ fuente, fecha }`, naming SII's JS function or deserializer;
  - `sintetico`: `{ motivo }`.

  **Only `por: 'mantenedor'` counts as verified, and only the owner's `/live-check` writes it,
  in the owner's own PR.** A contributor records their own observation as `contribuidor`.
  `validarEnVivoCuando` states the condition generically, never an account's own state.
- **Mandatory states.** A state that does not apply is declared with its reason
  (`noAplica: { vacio: '…' }`).
  - Read facade: `con-datos`, `vacio`, `inesperado` (unknown code or row shape), `sesion-muerta`.
  - Write facade (`escritura: true`): `exito`, `rechazo-sii` (SII's verbatim refusal),
    `indeterminado` (lost or ambiguous answer: never resent), `inesperado`, `sesion-muerta`, plus
    the preview's read states.
- **Expected results are snapshots.** One generic vitest file runs every scenario with a `tarea`
  and compares its JSON result (or the error `type`, ADR-012) with a committed snapshot, so a
  behaviour change is a diff the reviewer reads. A snapshot only proves stability: correctness
  comes from `procedencia`.
- **CI catches the honest mistake:**
  - It fails when a `portal/` facade has no scenario module or misses a mandatory state. Codecs,
    schemas, código tables and interpreters are an explicit exempt list.
  - Every facade that exists today starts on `LEGACY_SIN_ESCENARIOS`, a list that may only shrink.
  - A CI step fails when a fork PR's diff adds `por: 'mantenedor'`.
  - The owner approves a first-time contributor's run when GitHub asks. That is not a gate.
- **`/review-pr` is the gate for contributor PRs.** It reports as Critical:
  - a missing scenario module or mandatory state;
  - any change to a **guard file**: the exempt list, `LEGACY_SIN_ESCENARIOS`, the coverage test,
    `.github/**`, the snapshot runner, or a `por: 'mantenedor'`;
  - a change to a shared adapter or seam inside a feature PR (it gets its own PR).

  It also lists every scenario that is not verified as « afirmaciones sin verificar ».
- **Merge rule for a contributor's write surface.** The owner `/live-check`s its preview. The
  irreversible step may merge unverified only on the owner's explicit acceptance in the PR, and
  it stays pending until the owner performs one. If the owner cannot run the preview either (no
  data, e.g. no own boleta to annul), the write waits, or merges on that same explicit acceptance.
- **Run at the core-task level, never through a switch in the binaries.** `run-sii`'s
  `driver.mjs scenario <id>` calls the real task against the faked state and prints its JSON and
  audit entries; `driver.mjs scenarios` lists them. The published CLI and MCP keep no fake mode
  (ADR-004).
- **Pending list + `/live-check`:**
  - `docs/validation/pending.md` is generated (`pnpm scenarios:pending`) and lists every scenario
    not verified by the maintainer. A test fails when it is stale.
  - `/live-check <id>` runs a read or preview facade on the live session, refuses a write, and
    follows `live-probe-hygiene` (shape only, masked, nothing on disk).
  - It compares that shape with the scenario's. On a match it proposes `por: 'mantenedor'`; on a
    mismatch, the difference is the bug.

## Alternatives Considered

1. **Scenarios only inside test files.** Rejected: `run-sii` reads the built packages, and a
   reviewer or integrator could not reproduce a contributor's states.
2. **Trust a contributor's `// Observed at …` comments.** Rejected: unverifiable. They are kept,
   but as `por: 'contribuidor'`.
3. **Only a checklist, or a branch-coverage threshold.** Rejected: a checklist depends on someone
   running it. A coverage number knows nothing of SII states and ignores a lost answer.
4. **Enforcement CI that a PR cannot edit (`pull_request_target`).** Rejected: it would run fork
   code with the base repository's privileges. The owner's review of guard files is the gate.
5. **An env var that makes the CLI or MCP use a scenario.** Rejected: a fake mode in the published
   binary breaks ADR-004.
6. **Refuse contributed write surfaces.** Rejected: #63 is wanted. A verified preview, explicit
   acceptance and the pending list bound the risk.

## Consequences

- Easier: a contributor PR arrives with its states. CI flags a missing one before review, and
  the review names every unverified claim and every touched guard. A state no account holds still
  runs end to end (`driver.mjs scenario bienes-raices/cuota-impaga`, then `alertas`).
- Harder: every new facade ships its states and snapshots; legacy facades migrate one by one,
  starting with `bienes-raices` (#250).
- Obligation: CONVENTIONS « Testing » cites this ADR. The `/review-pr` checklist, the driver,
  `/live-check`, the catalog and the CONTRIBUTING / PR template land in the implementation PR.
