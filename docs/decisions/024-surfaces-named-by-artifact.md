# ADR-024: Surfaces are named by SII artifact; portal and auth mode are implementation axes

## Status

Accepted — 2026-09-09

## Context

#90 shipped the MIPYME facturación portal as `sii factura …` / `factura_*`. The name picks a
document subclass (factura = DTE 33/34) for a surface whose listing already returns guías de
despacho, notas de crédito and facturas de exportación (`TPO_DOC` ∈ 33…112 — the first document
downloaded live was a 110), and it collides with `dte`, which exists (`dte authorized`) and will
emit the same DTE 33 by SOAP + certificado (ROADMAP 🔒). The surface was really named after
its portal. Nothing is released yet (`main` is past `v0.7.0`), so the rename is free NOW and a
breaking change after `0.8.0`. The repo has no written rule for where a new surface goes; this
is the second time a naming choice had to be re-litigated in review (#88 → #90 → here).

## Decision

**A surface varies along four axes. Each axis has exactly one home; only the first reaches the
user's vocabulary.**

| Axis | Home | Never in |
| --- | --- | --- |
| SII **artifact** (F29, RCV, DTE, BHE, peticiones…) | the top-level CLI verb / MCP prefix | — |
| **Portal / transport** (SDI JSON, legacy CGI, GWT-RPC, SOAP, public CGI) | the portal-layer file name: `portal/<artifact>-<transport>.ts` | the verb |
| **Auth mode** (session-keyed, body-RUT, empresa-keyed, public, certificado) | the FIRST line of the surface's `--help` and its errors | the verb |
| **Read / write** | the sub-verb (`list`, `status`, `borrador save`, `emit`) | — |

Rules a new surface must satisfy:

1. **The verb is the artifact.** If the artifact already has a verb, add a sub-verb; never a
   sibling verb for a subclass of it. `factura` is DTE 33 ⇒ it lives under `dte`.
2. **Document types are numeric parameters, not verbs** (`dte … --tipo 61`), per CONVENTIONS
   "codes stay numeric". `nota-credito` / `guia` as verbs are the failure mode this prevents.
3. **Two transports for one artifact share the verb** and are told apart by prerequisites in
   `--help` (`dte borrador save`: Clave, portal gratuito · `dte emit`: certificado, SOAP).
4. **`ROADMAP.md` § "Where a new surface goes" is the placement table.** A verb absent from it
   needs an ADR before it lands — the table is the contract, not a suggestion.

**Applied now (before `0.8.0`):**

| Was | Becomes | MCP |
| --- | --- | --- |
| `sii factura empresas` | `sii dte empresas` | `dte_empresas` |
| `sii factura borrador list/save/delete` | `sii dte borrador …` | `dte_borrador_*` |
| `sii factura preview` | `sii dte preview` | `dte_preview_pdf` |
| `sii factura emitidas` | `sii dte emitidos` (the noun is *documentos*) | `dte_emitidos` |
| `sii factura pdf <folio>` | `sii dte pdf <folio>` | `dte_pdf` |

Core: `portal/factura.ts` → `portal/dte-mipyme.ts` (beside `dte-public.ts`; a SOAP layer would
be `dte-soap.ts`); `tasks/factura.ts` folds into `tasks/dte.ts` (one task file per module,
ADR-007); `FacturaError` → `DteError` already exists for the public surface — reuse it.
`sii-contract/factura.md` → `dte-mipyme.md`. ADR-023's boundary (never emit) is unchanged.

## Alternatives Considered

1. **Keep `factura`, named after the document like `bte` is** — rejected. `bte` collides with
   nothing; `factura` collides with `dte`, which will emit the very same document. And the read
   side already lists non-facturas, so the name was wrong on day one, not only in the future.
2. **Name it after the portal: `sii mipyme …`** — rejected. It leaks the implementation axis into
   the user's vocabulary; a contador would have to know SII's internal portal architecture.
   Nobody types `sii sdi rcv` or `sii sispad peticiones`.
3. **Nest the transport under the artifact: `sii dte mipyme borrador …`** — rejected. Three
   levels for the common path, to expose an axis the user does not choose. `f29 pdf` does not
   say "servlet"; the transport belongs in the file name and the wire contract.

## Consequences

- Easier: one verb per artifact holds for everything on the horizon — more DTE types by MIPYME
  are `--tipo`, SOAP emission joins `dte`, composites (`iva`, `renta`) are top-level, new
  artifacts (carpeta, situación) get new verbs. Contributors have a table to check against.
- Harder: the rename touches CLI, MCP, three core files, tests, contract, ROADMAP, README —
  one session, mechanical. MCP tool names change; free only because nothing shipped.
- Obligation: keep the ROADMAP placement table current; every surface's `--help` opens with
  its auth mode (new convention); document that `rcv list` (ventas) is the SII *registry* of
  all emitted DTEs from any software, while `dte emitidos` is the MIPYME *portal*'s own — with
  PDF access — so the overlap is a difference in capability, not a bug.
