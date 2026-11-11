# ADR-034: BHE annulment uses the issued report as confirmation

## Status

Accepted — 2026-11-11

## Context

Issue #63 adds an annulment path for issued boletas de honorarios electrónicas.
Annulment changes the legal status of an existing document. The captured portal
workflow identifies the document by its numeric folio and exposes a review form
before the final submission. This extends ADR-017 to the separate annulment flow.

## Decision

Use the authenticated `requestForm` seam for the observed review and submission.
Identify the BHE by its issued-report period and numeric folio in the session
principal's account. Cross-check the issuer, folio, document date, gross amount,
status, and reason against the review form.

The CLI defaults to a preview and requires the folio again in `--confirm` to submit.
The MCP exposes a read-only preview and a destructive tool that requires both
`confirmar: true` and the same folio in `folioConfirmacion`. Both surfaces require an
explicit SII reason for submission. The echo guards against an input mistake. An
unattended caller can still supply it and is responsible for obtaining authorization.

Send the final POST once with redirects disabled. Independently re-read the issued
report, including after a lost response. Report success only when the same folio
appears as annulled with an annulment date. An inconclusive read after submission
leaves the outcome indeterminate, with the verification status preserved separately.
Audit the operation with its folio, period, and outcome.

## Alternatives Considered

1. **Use the barcode as the identifier.** The captured SII form takes the numeric
   folio, which the issued report already exposes.
2. **Rely on the response page or replay the POST after a timeout.** The report can
   establish the outcome even when the response is lost. Replaying could duplicate
   the write.
3. **Drive the browser form for each operation.** The captured form works through
   the existing HTTP seam and can be tested with synthetic responses.

## Consequences

Both surfaces share the same checks and require a session for the issuer. A
pending or unrecognized status in the report remains indeterminate until its
representation can be verified. The wire contract records the observed fields
and distinguishes live evidence from synthetic tests.
