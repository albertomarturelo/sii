# ADR-018: Public release under the MIT license

## Status

Accepted — 2026-07-02. Fulfils the "a future public release will need its own
license + ToS ADR" gate that ADR-004 raised and ADR-015 explicitly deferred
("this ADR is PRIVATE distribution, so that gate does not apply"). Supersedes the
proprietary `UNLICENSED` posture of ADR-015 for licensing only; the release
mechanics (CD on a `v*` tag) are unchanged. The npm **republish target** (public
npm vs GitHub Packages) is intentionally left to a follow-up — this ADR governs
the license and the public posture, not where the artifact is hosted.

## Context

The repository moved from the `AltumStack` GitHub org to the owner's personal
account (`albertomarturelo/sii`) to be made **public**. Until now it was
proprietary: root had no license, `packages/core/LICENSE` read "All rights
reserved… no license granted", and `packages/core/package.json` declared
`"license": "UNLICENSED"`. A public repo with that posture is source-visible but
legally unusable by anyone — which defeats the purpose of publishing.

ADR-004 (guardrails + ToS posture) required that any public release carry its own
decision covering (a) the software license and (b) the ToS/legal disclaimer, since
this tool automates interactions with a government tax authority. This ADR is that
decision.

Two facts shape the license choice: `@altumstack/sii-core` is a **library meant to
be embedded** (it already has an external consumer that injects its own
`PortalDriver`), and the ecosystem is TypeScript/npm, where MIT is the default and
lowest-friction license for adoption.

## Decision

Release under the **MIT license**, copyright **Alberto Marturelo Lorenzo**, 2026.

- Add a root `LICENSE` (MIT) and replace `packages/core/LICENSE` (was proprietary)
  with MIT.
- `packages/core/package.json`: `"license": "UNLICENSED"` → `"MIT"`; point
  `repository.url` at `github.com/albertomarturelo/sii`.
- The `@altumstack/sii-core` **package name is kept** — an npm identifier is
  independent of the repo owner, and renaming would churn every import across
  `core`/`cli`/`mcp` + the CI boundary guard for no functional gain. Copyright
  holder and package scope are deliberately decoupled.

**Legal / ToS posture (reaffirming ADR-004).** The README and `SECURITY.md` state
plainly that this is an **unofficial** tool, **not affiliated with nor endorsed by
the SII**, provided **"as is"** (MIT's warranty disclaimer is the load-bearing
clause here), and that each user is responsible for their own compliance with the
SII's terms of service and Chilean law. The operational guardrails (throttling,
audit, credential handling, never-retry-after-a-block, secrets/PII hygiene) ship
inside the code per ADR-004/006 and apply to every consumer regardless of surface.

**Public-repo foundations** landed alongside this ADR: `LICENSE`, `SECURITY.md`
(responsible disclosure + the secrets/PII rules), `CONTRIBUTING.md` (CFD flow +
Conventional Commits + the no-AI-attribution rule + synthetic-data testing), a
refreshed public `README`, and a repo description + topics.

## Alternatives Considered

1. **Apache-2.0.** Rejected — its differentiators (explicit patent grant, NOTICE
   file, trademark terms) add ceremony without value here: this is portal-scraping
   glue with no patentable technique and no corporate contributors, and MIT already
   carries a sufficient warranty/liability disclaimer.
2. **Keep proprietary, just make the source visible.** Rejected — it makes the code
   legally unusable by anyone, defeating the point of going public.
3. **A copyleft license (GPL/AGPL).** Rejected — friction for a library intended to
   be embedded in other apps; MIT maximises adoption, which is the goal.

## Consequences

- Anyone may use, fork, modify, and embed the code, with attribution and no
  warranty. A permissive license cannot prevent a commercial fork — an accepted
  trade-off for a portfolio/community release.
- The old **private** `@altumstack/sii-core` GitHub Packages releases (0.1.0,
  0.2.0) are now inconsistent with the MIT posture; retiring them and deciding the
  public republish target (public npm vs public GitHub Packages) is a separate
  follow-up. `publish-core.yml` still targets GitHub Packages under `@altumstack`
  and will need revisiting when that decision lands — it only runs on a `v*` tag,
  so it is dormant until then.
- Branch protection (CODEOWNERS + required CI) must be re-applied on the personal
  repo — org protections did not survive the transfer.
- Going public exposes commit-author metadata (name + email) in history — inherent
  to any public Git repo.
