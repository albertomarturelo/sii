# ADR-020: GWT-RPC read capability behind the seam (SISPAD peticiones)

## Status

Accepted — 2026-07-03. Scopes the peticiones administrativas read surface (#74),
de-risked + live-characterized by the #73 PoC (2026-07-03). Builds on ADR-003 (injectable
seams; surfaces call tasks only), ADR-004 (first-hand observation, audit, verbatim errors,
no third-party libs), ADR-005 (body-RUT vs session-keyed). **Refines ADR-013**, which
deferred GWT-RPC as build-hash-fragile: the SISPAD read is un-deferred for THIS endpoint —
the PoC showed it is a single **cold, cookie-authorized POST**, not the UI-stateful flow
that keeps F29 Fase 2 deferred.

## Context

Peticiones administrativas (a taxpayer's SII administrative requests + their state
timeline) is a high-value early-warning surface SII does not push, reachable only via
**GWT-RPC** on a new host (`www3.sii.cl/sispadinternet`): a `text/x-gwt-rpc` POST to
`…/peticion` returns a `//OK[…]` serialized object graph. No current seam fits —
`requestJson` is JSON-only (non-JSON ⇒ login wall), `requestForm` expects HTML,
`requestPublic` is session-less. The #73 PoC characterized it live (a persona session AND
her empresa session):

- **A cold POST works** — no app warm-up / SPA-driving; the `.sii.cl` session cookie
  authorizes directly (like `loa.sii.cl` for BTE).
- **The server authorizes by session cookie + the RUT parameter.** The GWT "token" arg is a
  UI conversation id — a stale/placeholder value still returns `//OK` (observed). No token
  sourcing is needed.
- **The policy strong-name hash IS validated** — a bogus hash fails. It rotates on redeploy,
  so it is sourced at runtime (it lives in the app's permutation JS, fetchable authenticated).
- **Body-RUT (ADR-005), scope = operable set.** A persona session read her own petitions AND
  those of the empresa she represents (both in her operable set); the RUT param selects the
  subject. So the RCV `resolveOperableTarget` gate is correct.

## Decision

Add **one** generic authenticated transport primitive to `PortalSession` — GWT + SII
specifics stay in the facade so fakes keep tests hermetic:

- **`requestText(url, {method, headers, body})`** → `{status, body}` text: an authenticated
  raw GET/POST (the session cookies ride the browser context), the authenticated peer of
  `requestPublic`. No page navigation.

`portal/gwt.ts` (in-house, stdlib only — ADR-004) builds the GWT-RPC request string (fixed
template + hash + target RUT + a constant placeholder token) and decodes the `//OK[…]` graph
(string table + inline timestamps → número, materia, state timeline). The **policy hash is
self-healing**: cache the last-known-good; on a deserialization failure re-fetch the
permutation JS via `requestText`, extract the candidate 32-hex hashes, and re-probe —
absorbing SII redeploys without a fragile minified-var parse. A `LOGIN_HOST` bounce ⇒
`SessionExpiredError`; a genuine `//EX` **business** message ⇒ surfaced **verbatim** (ADR-004),
never flattened to "scraper roto" (reserved for an unparseable/changed shape).

`portal/peticiones.ts` + `tasks/peticiones.ts` (`withSession`, **body-RUT** — resolve the
operating RUT, validate `--rut` against the operable set via `resolveOperableTarget`, like
RCV), audited **rut-only**. **No `raw`, tight allowlist** (número, materia glosa, estado,
fechas, + SII's verbatim note per estado): the payload mixes own-identity + SII-functionary +
third-party PII. `//OK[]` empty ⇒ legitimate "no petitions", never an error.

### Decoder: schema DERIVED from the permutation, not hand-modeled (implementation, 2026-07-03)

GWT-RPC has no per-object framing, so decoding needs the exact field layout of EVERY type in
the graph. Reverse-engineering it from response samples was **tried and rejected**: it can't be
made complete (different petitions expose different types — `HojaTrabajoGeneralTo`,
`AutorizacionSispadTo`, … — and raw unboxed primitives collide with string-table tokens), and a
sample that omits a type silently mis-aligns. Instead the reader is **schema-directed**, and the
per-type schema (`portal/gwt-schema.ts`, 109 classes) is **extracted first-hand from the
compiled permutation's generated `FieldSerializer` deserialize functions** (still in-house,
stdlib, no third-party GWT lib — ADR-004): each field's read op is read straight from the JS,
superclass deserializers inlined. Keyed by **class name** (the per-type CRC in the wire sig
rotates on recompile; the layout does not) — a recompile still resolves; a class whose fields
change ⇒ "scraper roto". The extractor (`docs/sii-contract/peticiones-schema-extract.py`)
regenerates the schema from a fresh permutation, the same JS the hash self-heal already fetches.
Live-validated end-to-end 2026-07-03 (4 real petitions + 1 empresa capture, full-consume).

## Alternatives Considered

1. **A warm+capture primitive that boots the app to source token+hash** (an earlier draft of
   this ADR) — rejected: the PoC showed the token isn't validated and a cold POST works, so
   warming the SPA + capturing its traffic is dead weight. Only the hash needs sourcing, which
   a `requestText` GET + probe of the permutation JS covers.
2. **A single GWT-specific `requestGwt(service, method, args)` seam method** — rejected:
   couples the seam to GWT and buries logic in transport (untestable without the app). Generic
   `requestText` + a facade codec mirrors ADR-014.
3. **Drive the SPA + scrape the rendered DOM** (BTE-style `goto`+`evaluate`) — rejected: the
   decoded data isn't in clean JS globals (GWT widgets; the modal renders badly), and headless
   SPA-driving IS the F29-Fase-2 fragility. A cold replay avoids it.
4. **Keep GWT-RPC deferred (ADR-013 as-is)** — rejected: this endpoint is a robust cold replay
   and a top early-warning surface; only the F29 presented form stays deferred.

## Consequences

- Easier: the smallest possible seam addition (`requestText`, an authenticated peer of
  `requestPublic`) — reusable for any authenticated raw-body endpoint; F29 Fase 2, if
  revisited, reuses `gwt.ts`. No new seam KIND (unlike the earlier warm+capture draft).
- Obligation: maintain the in-house GWT codec + the hash self-heal; the fake gains scripted
  text. `requestText` is a second raw-HTTP path beside `requestJson`/`requestForm` — justified:
  GWT-RPC is neither JSON nor urlencoded/HTML.
- Boundary held: surface → task → seam, audited (ADR-003/004); body-RUT validated against the
  operable set (ADR-005); no `raw` keeps PII off every surface, the audit, and the LLM.
- Risk: an SII redeploy rotates the hash → the first call self-heals (re-source + re-probe); a
  changed response shape ⇒ "scraper roto" (honest), never silent wrong data. Live-revalidate.
