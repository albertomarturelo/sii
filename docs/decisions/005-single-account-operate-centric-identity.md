# ADR-005: Single-account, operate-centric identity model

## Status

Accepted — 2026-06-27. Simplifies the Python `sii-cli` lineage: keeps the
operate-pointer idea (sii-py ADR-029) and the per-call override (sii-py ADR-015)
as the SAME value-domain; drops multi-session account switching (sii-py ADR-028)
in favor of logout→login. One open spike gates the reach contract (below).

## Context

A user is either a **persona natural** (who may also represent empresas the SII
authorizes) or an **empresa** (whose login cannot act on behalf of anything; its
functions are limited). The Python project accumulated three context knobs
(`use`, `operate`, `--rut`) for multi-account support — confusing for a human
and a selection hazard for an LLM. The user chose a simpler model: ONE account
live at a time, with representación as the center for persona accounts.

## Decision

- **One live session at a time.** Switching accounts is `auth logout` →
  `auth login`. There is no account registry, no per-RUT cookie-jar roster, no
  `use` verb. (This is the deliberate simplification away from sii-py ADR-028.)
- **`operate` is the identity center for persona accounts.** A session has an
  operating RUT, defaulted to SELF on login. The **operable set** = `{self} ∪
  {empresas the account represents}` is fetched on login
  (`getDcvEmpresasAutorizadas`) and cached. `sii operate <rut|alias>` selects an
  operating RUT from that set; `sii operate --self` clears back to self.
- **Empresa accounts have no operate capability.** Their operable set is
  `{self}`; the verb is a degenerate no-op and is hidden. The capability is
  derived from account type at login — the user never configures it.
- **`--rut` is the per-call override of the operate pointer**, drawing from the
  same operable set. Precedence: explicit `--rut` > operate pointer > session
  RUT. It is NOT a separate concept.
- **`operate` SELECTS, never mints** (lineage: sii-py ADR-019). An unknown /
  unauthorized target is rejected up front against the cached operable set.
- **Always visible** (the load-bearing obligation): `auth status` shows the
  operating context, and every domain command prints `operating as: <rut>
  (razón social)` whenever the effective operating RUT ≠ self.
- **Reach is surface-dependent — and partly unresolved.** Body-RUT surfaces
  (RCV) honor `operate`. Session-keyed surfaces authorize by the session
  principal; the sii-py live finding (2026-06-26) was that F29/BHE reject a
  representing persona. **OPEN SPIKE:** does a persona with full representante-
  legal grants reach F29/F22/BHE via `operate`, or only RCV? Until resolved,
  session-keyed surfaces opt OUT of the operate pointer and, on a "no
  autorizado", return the actionable path ("log in as the empresa"). The spike's
  outcome decides whether `operate` is documented as "RCV read of representadas"
  or "full operation as the empresa". This ADR is Accepted for the MODEL; the
  reach table is appended when the spike lands.

## Alternatives Considered

1. **Keep `use` + `operate` + `--rut` (sii-py status quo).** Rejected — three
   knobs the user found confusing; a selection hazard for MCP. The user
   explicitly asked for one-account-at-a-time.
2. **Collapse `operate` into `--rut` only.** Rejected — the user elevated
   `operate` to the persona identity center (a sticky pointer carrying the
   representación capability), which a per-call flag cannot be.
3. **Type-blind operate (allow on empresa too).** Rejected — an empresa cannot
   represent; offering the verb there is a misleading dead end.

## Consequences

- Easier: the whole identity surface is "log in, optionally `operate <empresa>`,
  work, `operate --self`"; switching identity entirely is logout→login.
- Obligation: login does one best-effort `operable` fetch; the operate pointer
  + operable set are per-session state (razón social is PII → never audited);
  the `operating as:` header and `auth status` context are mandatory (invisible
  operating RUT is the exact foot-gun this model must prevent).
- Risk/blocker: the reach spike. If session-keyed surfaces never honor operate,
  representación is RCV-read-only and the rest needs logout→login as the empresa
  — still coherent, just less powerful. Resolve before wiring those surfaces.
