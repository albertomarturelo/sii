# ADR-004: Port the SII guardrails + ToS posture from sii-py

## Status

Accepted — 2026-06-27. Consolidates, for this repo, the lineage of the Python
`sii-cli` ADR-003 (ToS), ADR-010 (no third-party SII libs), ADR-011 (rate
limits), ADR-016 (prod-only), ADR-020 (wire-contract docs).

## Context

The Python project paid for its SII knowledge through live observation and a set
of guardrails that kept it legal, safe, and stable. Those rules are independent
of language; re-deriving them in TypeScript would repeat the cost and risk
regressions. We port the rules now so they bind from the first portal call.

## Decision

The following are repo invariants, enforced by convention and (where possible)
CI:

- **No third-party SII libraries.** Every selector, endpoint, and payload
  constant is written from first-hand observation of the live SII source and
  cited in code (`// observed at <URL> on <YYYY-MM-DD>`). CI greps for known
  SII libs and fails on any import.
- **Production-only, hostnames centralized.** SII hostnames are constants in
  `@sii/core` config; never hard-coded elsewhere. No `SII_ENV` switch. Cert
  isolation, when DTE writes need it, returns as a per-call parameter.
- **Audit every state-touching op** through the `AuditSink` port:
  `{ts, action, rut, result, durationMs?, ...extra}`; keys matching
  `password|clave|cookie|secret|token` are dropped before write. The log is a
  receipt, never a gatekeeper.
- **Rate-limit / block handling:** never retry after a SII block; surface the
  Spanish message verbatim and stop. Pace fan-outs from a configurable rps.
- **Wire-contract docs** under `docs/sii-contract/<surface>.md` record request
  shape, response shape, and observation date for each surface.
- **PII hygiene:** real PII never lands in a tracked file (including CI guard
  denylists — hold those in a repo secret); tests use synthetic Mod-11-valid
  RUTs; PII values never reach the audit log.
- **ToS posture (own + consensual delegated access only).** We automate the
  user's OWN account and the empresas the SII itself authorizes them to operate
  (representación, discovered via the operable set). We NEVER custody a third
  party's Clave or automate an account we are not authorized for. Public,
  login-free consultas (e.g. authorized-DTE lookup) are a separate, in-bounds
  class because no account is touched.

## Alternatives Considered

1. **Re-derive the rules as we go.** Rejected — repeats live-observation cost
   and invites regressions on legally/operationally sensitive behavior.
2. **Allow a third-party SII library to bootstrap faster.** Rejected — the
   Python project's ADR-010 found them unreliable and contract-opaque; first-
   hand observation is the only trustworthy source for an unofficial portal.

## Consequences

- Easier: the dangerous decisions are already made and rationalized; CI catches
  the two most damaging regressions (a third-party SII import, a real-RUT leak).
- Obligation: every new SII surface cites its observations and adds a
  `sii-contract` doc; the audit + rate-limit rails are wired through the ports,
  not bolted onto each surface.
- A future public release will need its own ADR for license + a ToS disclaimer
  (lineage: sii-py ADR-021/022); out of scope here.
