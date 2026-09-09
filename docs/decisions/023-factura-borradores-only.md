# ADR-023 — Factura electrónica (Portal MIPYME): borradores only, no emission

## Status

Accepted — 2026-09-08. The surface was renamed `factura` → `dte` by ADR-024 (2026-09-09);
its wire contract is now `docs/sii-contract/dte-mipyme.md`. The decision — borradores only,
never emission — is unchanged.

Relates to: ADR-003 (seams), ADR-004 (guardrails), ADR-005 (identity),
ADR-006 (secrets/PII), ADR-017 (write posture), ADR-022 (document downloads).

## Context

The SII runs a **free** facturación electrónica portal ("Sistema de facturación gratuito del
SII", `Portal001` CGIs on `www1.sii.cl`). It is the surface a small contribuyente actually uses
to issue facturas, and it supports a **borrador** (draft) lifecycle: save, list, re-open, preview
and delete a document before committing to it.

A live capture on 2026-09-08 (`docs/sii-contract/dte-mipyme.md`) mapped the whole flow and surfaced
one decisive fact:

> **Signing is server-side.** The `Firmar` button posts to `mipeGenXMLFirma.cgi`; there is no
> applet, no browser certificate and no `.pfx`. **A Clave Tributaria session alone is sufficient
> to emit a legally-binding factura electrónica.**

That is a much lower bar than the DTE SOAP services (which do require a certificado digital and
are still Future in `ARCHITECTURE.md`). It means an automated surface here could, with one HTTP
POST, create a real tax document with legal and financial consequences for the taxpayer and a
third party — and unlike a BHE, a factura cannot simply be annulled.

The portal's authorization model is also its own: the working empresa is whichever RUT was last
POSTed to `mipeSelEmpresa.cgi`, chosen from the empresas that registered this user as *usuario
autorizado*. That list is **not** the operate pointer's operable set (ADR-005) and not the
session principal either.

## Decision

**1. Ship the borrador lifecycle; do not ship emission.**

The surface implements exactly: list authorized empresas, create/update a borrador, list
borradores, download the preview PDF, delete a borrador. `mipeGenXMLFirma.cgi` is never called
from this codebase. The emission path is documented in the wire contract solely so the boundary
is explicit and reviewable.

Rationale: everything a user needs to *prepare* a factura is reversible and carries no legal
weight — a borrador has no folio and is not a tax document. Emission is the one step that is
irreversible, legally binding, and (because it needs no certificate) trivially reachable by
accident or by a prompt-injected model. Splitting there puts the whole useful workflow behind
automation while leaving the consequential click to a human in SII's own UI, which is one
navigation away from any borrador this tool writes.

**2. A borrador is a write, but not a destructive one.**

Unlike `bte emit` (ADR-017), `dte_borrador_save` needs no double-entry confirm and no
`destructiveHint`: it is reversible and legally inert. **Deleting** a borrador is irreversible,
so it does get the gate — CLI `--confirm <id>` (double-entry of the id) and MCP
`destructiveHint: true` + an explicit `confirmar: true`.

**3. Empresa-keyed is a third authorization mode, resolved live.**

`--empresa` / `empresa` is validated against the portal's own list, fetched at call time from
`mipeSelEmpresa.cgi`, and every task selects the empresa before acting. An unknown RUT fails with
the available list. This joins body-RUT (RCV) and session-keyed (F22/F29/BHE) as a documented
mode in `CONVENTIONS.md`.

**4. Let SII validate, and pass its message through.**

The form's own `validaFacEx()` is run **in-page** before anything is POSTed. It produces exactly
the Spanish refusals SII would otherwise bounce, so the user gets the real message at zero cost
and an invalid document never reaches SII (a redirect loop was observed when posting past it).

**5. The preview PDF follows the ADR-022 document contract.**

`mipePreView.cgi` returns a real `application/pdf` stamped "VISTA PREVIA · DOCUMENTO NO VALIDO".
It is fetched with `requestBinary`, written through the `FileSink` seam, and the task returns a
**descriptor** — never the bytes. Success is decided by `content-type` + `%PDF` magic, never by
HTTP status. No new seam was needed.

**6. No `raw`, anywhere.**

A factura is both parties' identity end to end. Rows are curated; the audit receipt carries only
the empresa RUT, the borrador id, the DTE type and counts — never the receptor, the montos or the
item glosas (ADR-006).

## Alternatives Considered

### 1. Ship emission behind the ADR-017 write ceremony — REJECTED

`bte emit` already has a posture for irreversible writes: a non-mutating preview split from
the issue step, an explicit `--confirm <echo>` double-entry of a load-bearing value, and
`destructiveHint` on the MCP tool. The obvious move is to reuse it for `factura emit`.

It is not sufficient here, for two reasons.

**ADR-017's gate protects against a mistake, not against an instruction.** A double-entry echo
stops a human fat-fingering an amount. It does not stop a model that has been told, by content
it read, to issue a document — the model can supply the echo as readily as the amount, because
both are just arguments it is choosing. The MIPYME surface is reached with data the taxpayer
does not control: receptor names, giros and addresses come back from SII's registry, and a
factura's own item glosas are free text. That is a prompt-injection surface on the *inputs* of
the very operation being gated.

**A factura binds a third party.** A BHE is the issuer's own income declaration, and it can be
annulled (`bte anular`, #63). A factura creates a tax obligation for the *receptor* — it enters
their Registro de Compras, affects their IVA position, and cannot simply be withdrawn; it is
undone by issuing a nota de crédito, itself another binding document. The blast radius is
someone who never interacted with this tool.

Those two together move the decision out of "add more ceremony" and into "do not automate the
step at all".

### 2. Don't ship the MIPYME surface at all — REJECTED

If emission is out, one could argue the rest is not worth the wire-contract surface area.

But the borrador half is where the repetitive work actually is: composing a document, checking
the receptor's registry data, reviewing totals, and doing that for many clients in a batch.
All of it is reversible and legally inert — a borrador has no folio and is not a tax document.
The one consequential click then stays with a human in SII's own UI, one navigation away from
any borrador this tool writes. That is a good split: the tedium is automated, the legal act is
not.

### 3. Automate emission but require a certificado digital — REJECTED, non-option

The DTE SOAP services need a `.pfx`, which is a natural second factor: no certificate, no
emission. It would have been reasonable to gate `factura emit` the same way.

The live capture removed the option. The MIPYME portal **signs server-side**
(`mipeGenXMLFirma.cgi`): there is no applet, no browser certificate, no `.pfx` anywhere in the
flow. A Clave Tributaria session alone is sufficient. There is therefore no certificate to
require, and nothing to gate on — which is precisely why the boundary has to be drawn by
choosing not to call that CGI.

## Consequences

- The user can draft, review and manage facturas entirely from the CLI/MCP, then emit in SII's UI.
- No tool in this codebase can create a legally-binding factura. This is a deliberate ceiling, and
  reversing it requires a new ADR — with, at minimum, the ADR-017 write posture (two-phase,
  confirm-gated, folio-only audit, live-validated against a real needed document).
- The form is JS-populated, so this facade depends on a real browser session (`goto`/`evaluate`),
  like BTE. A portal redesign breaks it loudly ("scraper roto"), never silently.
- Only DTE 33/34 are wired. The other MIPYME types (46 compra, 43 liquidación, 110 exportación)
  each carry extra fields and need their own live capture before being trusted.
