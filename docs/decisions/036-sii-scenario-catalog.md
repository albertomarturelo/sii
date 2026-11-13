# ADR-036: A catalog of simulated SII states that every facade, and every contributor PR, must ship

## Status

Accepted — 2026-11-12. Builds on ADR-003 (seams + fakes), ADR-004 (production is the only target),
ADR-016 (pure main barrel), ADR-034 (row shapes taken from SII's renderer).

## Context

The owner cannot test many SII answers live, because their accounts do not hold the data: an
unpaid cuota (#250), an observed F29, an anotación. External contributors now send whole surfaces.
#274, for example, adds an irreversible write (annul a BHE) in ~1.1k lines and changes the shared
HTTP adapter. It cites wire observations only its author made, and says that two of three reasons
and one SII state were never seen live. A reviewer cannot reproduce any of it.

The gaps:
- nothing states which SII states a facade must handle;
- nothing separates what was seen from what was guessed, or who saw it;
- CI does not run on a first-time contributor's fork PR until the owner approves the run.

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

  **Only `por: 'mantenedor'` counts as verified.** A contributor's observation is recorded,
  but stays « declarado, sin verificar ». `validarEnVivoCuando` states the condition generically
  (« una cuenta con una cuota impaga »), never an account's own state.
- **Mandatory states.** A state that does not apply is declared with its reason
  (`noAplica: { vacio: '…' }`).
  - Read facade: `con-datos`, `vacio`, `inesperado` (unknown code or row shape), `sesion-muerta`.
  - Write facade (`escritura: true`): `exito`, `rechazo-sii` (SII's verbatim refusal),
    `indeterminado` (lost or ambiguous answer: never resent), `inesperado`, `sesion-muerta`, plus
    the preview's read states.
- **Expected results are snapshots.** One generic vitest file runs every scenario with a `tarea`
  and compares the JSON result (or the error `type`, ADR-012) with a committed snapshot, so a
  behaviour change is a diff the reviewer reads. A snapshot only proves stability: correctness
  comes from `procedencia`.
- **Enforced in CI, on fork PRs too:**
  - A vitest check fails when a `portal/` facade has no scenario module or misses a mandatory
    state. Helpers (codecs, schemas, código tables) are an explicit exempt list.
  - Today's 21 facades start on a `LEGACY_SIN_ESCENARIOS` list that may only shrink.
  - The owner approves the fork's workflow run before reviewing (GitHub's first-time gate).
- **`/review-pr` on a contributor PR:**
  - It lists every scenario not verified by the maintainer as « afirmaciones sin verificar ».
  - A missing facade module or a missing mandatory state is Critical.
  - A change to a shared adapter or seam inside a feature PR is Critical: split it into its own PR.
- **Merge rule for a contributor's write surface:** the preview / read half must be
  `/live-check`ed by the owner. The irreversible step may merge unverified only on the owner's
  explicit acceptance in the PR. It stays in the pending list until the owner performs one
  deliberately.
- **Run at the core-task level, never through a switch in the binaries.** `run-sii`'s
  `driver.mjs scenario <id>` calls the real task against the faked state and prints its JSON and
  audit entries; `driver.mjs scenarios` lists them. The published CLI and MCP keep no fake mode
  and no env var for one (ADR-004).
- **Pending list + `/live-check`:**
  - `docs/validation/pending.md` is generated from the catalog (`pnpm scenarios:pending`): every
    scenario not verified by the maintainer, with its condition and issue. A test fails when it
    is stale.
  - `/live-check <id>` runs a read or preview facade on the live session and refuses a write.
  - It follows `live-probe-hygiene`: shape only, digits and keys masked, scrubbed errors, nothing
    on disk.
  - It compares the live shape with the scenario's. On a match the agent proposes
    `por: 'mantenedor'` with the date; on a mismatch, the difference is the bug. Either way, a PR.

## Alternatives Considered

1. **Scenarios only inside test files.** Rejected: `run-sii` reads the built packages, and a
   reviewer or integrator could not reproduce a contributor's states.
2. **Trust a contributor's `// Observed at …` comments.** Rejected: unverifiable. They are kept,
   but as `por: 'contribuidor'`.
3. **Only a `/review-pr` checklist item, or a branch-coverage threshold.** Rejected: a checklist
   depends on someone running it. A coverage number knows nothing of SII states, and a fork can
   meet it without ever exercising a dead session or a lost answer.
4. **An env var that makes the CLI or MCP use a scenario.** Rejected: a fake mode in the
   published binary breaks ADR-004 and could switch on by mistake.
5. **Refuse contributed write surfaces outright.** Rejected: #63 is wanted. A verified preview,
   explicit acceptance and the pending list bound the risk instead.

## Consequences

- Easier: a contributor PR arrives with its states. CI rejects a missing one before review, and
  the review names every unverified claim. A state no account holds can still run end to end
  (`driver.mjs scenario bienes-raices/cuota-impaga`, then `alertas`).
- Harder: every new facade ships its states and snapshots; legacy facades migrate one by one,
  starting with `bienes-raices` (#250). CONTRIBUTING / the PR template must say so.
- Obligation: CONVENTIONS « Testing » cites this ADR. The `/review-pr` checklist, the driver,
  `/live-check`, the catalog and the PR template land together in the implementation PR.
