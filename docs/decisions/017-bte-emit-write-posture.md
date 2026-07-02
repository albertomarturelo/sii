# ADR-017: BHE emission — the first write surface (`bte emit`) posture

## Status

Accepted — 2026-07-02. The FIRST write surface (all prior surfaces are reads). Builds on
ADR-003 (injectable seams; surfaces call tasks only), ADR-004 (first-hand observation, audit,
verbatim errors, no retry after a block), ADR-005 (session-keyed identity), ADR-006 (secrets /
LLM boundary). The wire contract was captured live 2026-07-02 (a real boleta issued end-to-end)
and is documented in `docs/sii-contract/bte.md` (§ Emisión). Anulación is deferred (own flow /
follow-up).

## Context

`bte emit` issues a **Boleta de Honorarios Electrónica** — a legally-binding tax document: it
creates a tax obligation, is reported to SII, and affects the counterparty. The ROADMAP kept it 🔒
pending "its own ADR for the legal weight". Two facts shape the design (both confirmed in the live
capture):

1. **It rides the Clave session, no certificate** (unlike DTE 33/34 emit, which needs a `.pfx`).
   So it is NOT blocked on a cert layer — the same cookies-only session the read surfaces use
   reaches `loa.sii.cl/cgi_IMT/`.
2. **The wire shape is a legacy HTML form-POST flow** (`TMBECN_*` CGIs returning HTML), NOT the
   SDI-JSON facades. It is a multi-step state machine (validate → present form → **preview** →
   **issue** → optional email), where the PREVIEW step (`TMBECN_ConfirmaTimbrajeContrib.cgi`) is
   non-mutating and computes retención/líquido server-side, and only the ISSUE step
   (`TMBECN_BoletaHonorariosElectronica.cgi`) creates the folio. That natural preview/issue split
   is the safety seam this ADR builds on.

No existing seam fits: `requestJson` is JSON-only and rejects HTML as a login wall;
`requestPublic` is unauthenticated. An **authenticated form-POST** primitive is needed.

## Decision

Ship `bte emit` as a two-phase, session-keyed, audited write on both surfaces, shipped as **0.3.0**.

1. **New seam `PortalSession.requestForm`** — an authenticated `x-www-form-urlencoded` POST from the
   logged-in browser context (cookies ride along), returning the decoded text body (charset-aware,
   reusing the `requestPublic` decode). It detects the login-wall (`LOGIN_HOST` landing / login HTML)
   → `SessionExpiredError`. This is the authenticated peer of `requestPublic.form`, and the reusable
   basis for future form-POST writes (e.g. `f29 submit`).

2. **Preview/issue split is the safety model.**
   - `bteEmitPreview` runs steps 1–3 (…→ `ConfirmaTimbrajeContrib.cgi`) and returns the
     server-computed boleta (retención/líquido, `porc_retencion`) **without issuing**.
   - `bteEmit` runs step 4 (`BoletaHonorariosElectronica.cgi`) and returns `{ folio/codBarras,
     pdfUrl }`. Optional `enviarBte` (step 5) emails the PDF.
   - **CLI**: `sii bte emit --dry-run` = preview; the real issue requires an explicit `--confirm`
     that re-states receptor + monto (a mismatch aborts). No accidental issue.
   - **MCP**: exposes BOTH — `bte_emit_preview` (non-issuing) and `bte_emit`, the repo's **first
     `destructiveHint: true` tool** (`readOnlyHint: false`), whose input requires an explicit
     `confirmar: true` + receptor/monto echo. Its description states plainly that it ISSUES a
     legally-binding boleta. (The Clave never crosses MCP — ADR-006 holds; emission carries no
     password, so unlike `consoleLogin` it is MCP-eligible.)

3. **Session-keyed** (ADR-005): emission authorizes by the session principal (`rut_arrastre` =
   `rut_autentificado`, confirmed in the capture). Reuse `assertSelfOperating` — reject a
   representing operate pointer up front; NO `--rut`. A represented empresa's boletas need the
   empresa's own session.

4. **Retención is server-side.** The payload sends GROSS amounts + who-withholds
   (`OptTipoRetencion`); SII computes retención/líquido from the year's `porc_retencion`, which it
   injects into the form. We **read that rate from the form, never hardcode a per-year table**
   (ADR-004: observe, don't assume). Local validation covers only what's cheap and safe: receptor
   Mod-11 (before any SII call), monto (positive integer), boleta date (±3 months), region/comuna
   (against the ported `GLB_comunas.js` table).

5. **Audit every attempt** (ADR-004): `bte_emit_preview` / `bte_emit` receipts carry
   `{ rut, durationMs, folio? }` — **never** the receptor RUT/name, the monto, or the glosa (PII /
   business data stays out of the log, as F22/F29/BTE reads already do). A SII rejection surfaces
   its message verbatim; **never retry** an emission.

## Alternatives Considered

1. **CLI-only emit (no MCP).** Rejected: the user wants an assistant able to prepare AND issue.
   The `destructiveHint` + explicit-confirm-token gate makes MCP issuance deliberate; the preview
   tool covers the "prepare/quote" case without risk.
2. **Drive the form via `goto` + `evaluate`** (fill the real page's inputs and click submit).
   Rejected: brittle DOM scripting, and it couples the facade to page structure. A clean
   authenticated form-POST (`requestForm`) matches the "one primitive per wire shape" convention
   and is unit-testable against a fake.
3. **Compute retención client-side from a year-rate table.** Rejected: SII already computes it and
   ships the vigente rate in the form; a hardcoded table would drift and violates ADR-004. Read
   `porc_retencion`; surface SII's computed retención/líquido.
4. **Single-command issue (no preview/confirm).** Rejected: a legally-binding, hard-to-reverse act
   needs an explicit confirmation. The preview/issue split already exists in SII's own flow — we
   mirror it.

## Consequences

- New capability: prepare + issue BHE from the CLI and MCP, session-keyed, with a
  preview-before-issue safety gate and an audit receipt per attempt.
- New seam `requestForm` (authenticated form-POST) — reusable for future writes.
- First `destructiveHint` tool in the MCP surface; sets the pattern (explicit confirm token +
  honest description) for future write tools (`f29 submit`, `dte emit`, `bte anular`).
- Obligation: emission is irreversible except by a separate **anulación** (deferred — own capture +
  verb). The PII posture tightens (no receptor/monto/glosa in the audit log). Live-revalidate the
  binary end-to-end before the release tag.
