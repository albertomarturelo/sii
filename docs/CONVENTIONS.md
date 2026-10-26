# Conventions

This file grows as real work surfaces patterns (ADR-007: corrections become
conventions). It starts with the load-bearing rules ported from the proven
Python `sii-cli`, adapted to TypeScript.

## Code style

- TypeScript `strict` everywhere, plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. No `any` without an inline justification; prefer
  `unknown` + narrowing at boundaries.
- ESLint + Prettier are authoritative. Format before commit.
- Comments explain WHY, not WHAT — non-obvious constraints, SII quirks, subtle
  invariants. Never restate the code.
- ESM only (`"type": "module"`). Named exports; avoid default exports.
- **NodeNext modules: relative imports end in `.js`** (e.g. `from './rut/index.js'`)
  so the compiled output runs directly on Node; bare specifiers (`@albertomarturelo/sii-core`,
  `commander`) stay extensionless. `tsc` errors on a missing extension. (ADR-009)

## Architecture patterns

- **Single-env (prod) is the contract.** No `SII_ENV` switch. Hostnames are
  constants in `@albertomarturelo/sii-core` config; never hard-code a SII hostname anywhere else.
- **Surfaces call `@albertomarturelo/sii-core` tasks only.** CLI and MCP never reach past the
  task layer into a portal/DTE facade — that bypasses throttling, audit log, and
  credential handling. (ADR-003)
- **The core is the data layer; surfaces present. JSON is the default output.**
  `@albertomarturelo/sii-core` tasks return plain, JSON-serializable objects (no `Date`/`Map`/`Set`,
  no human formatting) — that is the library/integration contract. The MCP surface
  emits `JSON.stringify`; the CLI emits JSON by DEFAULT (`--human` for the readable
  rendering, `--json` is the explicit default). A command computes its result object
  ONCE and renders it through the shared `emit(data, humanFn)` — never bare `out()`
  for a result. STDOUT carries only the result (JSON pipeable to `jq`); the
  `operating as:` header + diagnostics go to STDERR and are human-mode-only. (ADR-012)
  **A JSON error is `{ error, type, exitCode, reason?, codigo? }` on STDERR** (the MCP's
  tool error is the same object, minus `exitCode`). `error` is the verbatim message. `type`
  is a stable kind from the core's `classifyError` (`login_rejected`, `session_expired`, …),
  never a class name. A consumer branches on `type`, never on the text. The CLI's exit code
  is derived from `type`. A new error class either maps to an existing kind or gets a new
  kind through an ADR-012 amendment. Kinds are never renamed. (ADR-012 amendment, #134)
- **External dependencies sit behind injectable seams.** `PortalDriver`,
  `SecretStore`, `SessionStore`, `AuditSink`, `Clock` are interfaces in
  `@albertomarturelo/sii-core` with Node default implementations; tests inject fakes so they
  never touch the real SII / keyring / clock. The core is otherwise a normal
  Node library (it may use Node APIs directly). (ADR-003)
- **The default `portal` is HTTP; a JS engine is an explicit, optional capability
  (ADR-027).** `HttpPortalDriver` (Node `fetch` + an in-house cookie jar) backs every
  `request*` primitive, and its `goto` is a redirect-following GET. Its `evaluate` throws
  `BrowserRequiredError`.
  - A surface may ask for the browser (`withSession(…, { engine: 'browser' })`) ONLY when
    SII's own page JS must COMPUTE the data: a JS-built form or an in-page validator
    (MIPYME `validaFacEx`). Data the page writes as literals is parsed from the HTML (the
    next bullet, and the inline-JS-map rule below; ADR-027 amendment, #222).
  - In the CLI that browser is ALWAYS headless. **No CLI command may need a human at a
    browser window**, so the headed login and `--www2` are MCP-only.
  - If the data ships as a JSON literal in the HTML (e.g. `DatosCntrNow`), extract and
    `JSON.parse` it, zod-validated. Never request the browser for that, and never
    upgrade to it silently.
  - **A text body is decoded the way a browser decodes it (#224).** The header's charset
    wins; without one, an HTML body's `<meta>` charset (first 1024 bytes); else UTF-8
    (`charsetOfBody`, every decode site in both Node drivers). `loa.sii.cl` sends a bare
    `text/html` and declares `iso-8859-1` only in the HTML, so the header alone turned
    every ñ into U+FFFD. A move from the browser to HTTP is validated on a value with an
    accent, or by counting U+FFFD in the decoded body: "every field present" hid this.
- **A seam only ONE surface may use is wired in THAT surface's composition root, never
  as a `createNodeRuntime` default.** Both surfaces build from `createNodeRuntime()`, so a
  default there hands the capability to the MCP server too. Keeping a task off the main
  barrel controls which TASK the model can reach; it does NOT control which SEAM the
  runtime carries — every barrel task receives `runtime`. The OS keyring is the template:
  `packages/cli/src/main.ts` passes `secrets: new KeyringSecretStore()` explicitly,
  `createNodeRuntime().secrets` is asserted `undefined` in both packages, and the type on
  `Runtime` is the READ half only (`SecretReader`). "The MCP never reads the keyring" must
  be true by construction, not because no code happens to call it. (ADR-006 / ADR-025)
- **Authentication is an explicit verb, not a side-effect.** Domain tasks never
  mint a session; they consume a valid one or raise `NotAuthenticated`. Only the
  login task mints. (ported sii-py ADR-019)
- **Domain tasks reach SII through `withSession`, never a bespoke restore.** The
  `auth/session.ts` primitive restores the cookies-only session into a live
  `PortalSession`, resolves the operating/body RUT (override > pointer > self — a
  `--rut` override is validated against the operable set HERE, the single
  enforcement point, via the same `resolveOperableTarget` the `operate` command
  uses), hands both to the callback, and always closes the session — raising
  `NotAuthenticated` when there is none. It does NOT eagerly probe liveness — the
  first SDI POST IS the liveness test: the `requestJson` seam detects the login-wall
  response (a dead jar bounced to HTML / `LOGIN_HOST`) and raises `SessionExpiredError`
  (actionable "re-login"), so facades must let `NotAuthenticated` propagate instead of
  wrapping it as their domain error. NEVER retries after a block. New read surfaces
  (rcv/f29/bte) wrap their facade call in it. (ADR-003 / ADR-005)
- **Identity is single-account + operate-centric.** One live session at a time;
  switch accounts by logout→login. Within a session, a persona's `operate`
  pointer chooses which RUT it acts as (self by default, or a represented
  empresa). `operate` SELECTS, never mints, and is validated against the cached
  operable set. Empresa accounts have no operate capability. The active operating
  RUT is ALWAYS visible (status + an `operating as:` header). (ADR-005)
- **Per-call `--rut` overrides the operate pointer** for one operation; it is the
  same value-domain (the operable set), not a separate concept.
- **Validate external inputs at the boundary with `zod` (ADR-011).** MCP tool
  inputs (the SDK derives the protocol JSON Schema from the zod shape) and, later,
  SII wire payloads in `@albertomarturelo/sii-core`. Validation stays at the boundary — internal
  domain invariants are plain TypeScript types, never zod.

## SII domain rules

- **No third-party SII libraries.** Every selector, endpoint, and payload
  constant is derived from first-hand observation of the live SII source (HTML,
  JS, WSDL, official PDFs) and cited in a code comment, e.g.
  `// observed at <URL> on <YYYY-MM-DD>`. (ADR-004)
- **Prefer inline structured data over DOM scraping.** Where the portal ships a
  JS object (e.g. `DatosCntrNow`) or an inline data map, read THAT, not the
  rendered DOM. Cite the variable name and observation source.
- **Portal session detection is URL-based, not DOM-based.** Landing on
  `zeusr.sii.cl` means not authenticated; any other host means we reached the
  destination. URL is part of the auth contract; DOM markers are a guess.
  **The HTTP login is the one exception: success and rejection both answer `200` on
  `zeusr.sii.cl`** (observed 2026-10-17). Success there means the session cookies were
  set AND the body's navigation leaves `LOGIN_HOST`, and the Mi SII identity read that
  follows is the proof. (ADR-027)
  **A dead jar can bounce by JavaScript, not only by redirect.** Mi SII answers it `200`
  with a page that only runs `location.replace(<zeusr login URL>)` (observed 2026-10-18,
  GH-139). The HTTP driver treats that page as a landing on `LOGIN_HOST`, so URL-based
  detection holds on every primitive. Keep the match narrow: the page holds nothing else,
  and the target is `LOGIN_HOST`. **"Alive" needs positive proof.** A probe that decides
  whether to skip a login confirms the session by reading the principal's identity, never
  by "no bounce seen". A wrong "alive" locks an unattended caller out of recovery; a wrong
  "dead" costs one login. **"Closed" needs proof too (#135).** Over HTTP, SII's
  `autTermino.cgi` answers `200` on its own path and navigates by JS, so "we left the logout
  page" proves nothing. Prove a server-side close by restoring the PRE-close cookies into a
  fresh session and seeing Mi SII bounce to the login. Never decide it on the same jar, which
  SII may simply have cleared. An unproven close is reported as local only. **Each close runs
  in its own session restored from the PRE-close cookies (#146):** the www2 close deletes the
  classic cookies too, so on a shared jar the classic close went out without the session it had
  to end. The www2 layer gets the same proof through its own liveness read, and SII was observed
  NOT to revoke it at all (it expires on its own), so the result says until when it stays valid.
- **Wire contracts are documented under `docs/sii-contract/`** per surface, with
  the request shape, response shape, and observation date. (ported sii-py ADR-020)
- **Authenticated SPA-JSON facades go through `PortalSession.requestJson`.** The
  `www4.sii.cl` SDI endpoints (RCV, representación, …) are reached via the seam's
  authenticated JSON POST (the session cookies ride along), never a bespoke HTTP
  client. Cite the endpoint + observation date; surface the `respEstado` error
  envelope verbatim; curated + `raw`. (ADR-003 / ADR-004)
  **A non-JSON body is classified by URL + content-type, never by "does the body look
  useful".** `requestJson` resolves parsed JSON ONLY. A `LOGIN_HOST` landing or an HTML
  body ⇒ `SessionExpiredError` (re-login fixes it). Anything else that fails to parse ⇒
  `UnexpectedResponseError` carrying the endpoint, status, content-type and the first ~80
  chars of the body verbatim — observed 2026-09-11 (#111): a LIVE session on the cte-api
  `obtenerValorParametro` gets `200 text/plain` with a bare URL (the "modificar email"
  SPA), which is not a dead session and must not read as one, and whose body is exactly
  what tells you the endpoint is wrong. Never return the raw string from the seam: a bare
  value would sail past the facade's zod envelope (ADR-011) and hide a broken endpoint;
  the fix for such an endpoint is to call the RIGHT one, not to relax the seam.
  **A facade's catch lets `NetworkError` through, like `NotAuthenticated` (#215).** SII never
  answered, so it is not SII's response and must not read as « no es JSON »: the HTTP driver
  raises it with the host and Node's cause, and it is not a `SiiError`, so a composite read
  aborts on it. Six facades relabelled it before this rule.
- **Inline-JS-map facades (legacy CGIs) GET the page with `requestText` and parse the map
  statements with `readInlineMap`, NOT `requestJson`, never `evaluate`.** Some surfaces
  (BHE/BTE on `loa.sii.cl/cgi_IMT/`) serve an HTML skeleton whose tables are filled
  client-side from global JS maps (`xml_values`, `arr_informe_mensual`) that the HTML itself
  writes as literal statements (`name['k'] = "v";`, `formatMiles('<n>', …)`, `+= <n>`;
  observed 2026-10-26, #222). `readInlineMap` replays them in document order and drops a key
  whose statement it cannot evaluate, so an unknown shape reads as missing, never as a guess.
  The `.sii.cl` session cookie carries on a plain GET; a dead jar lands on `LOGIN_HOST` and
  the driver raises `SessionExpiredError`. NEVER scrape the rendered DOM (the cells hold the
  filling JS). Cite the CGI + observation date; pace pagination via `Clock.sleep`. A page
  whose JS computes the values (expressions, not literals) is a browser surface: ask for
  `engine: 'browser'` and say so in its contract. (ADR-003 / ADR-004 / ADR-027)
- **An HTML table parser preserves blank cells, maps by POSITION, and fails loud on an
  unexpected cell count.** Never drop empty cells before indexing: SII renders a legitimately
  absent value as a blank cell (a `PRV` document has no folio), so filtering it slides every
  later column one place left and yields a plausible row with the values under the wrong names —
  no error, and `Number('2026-09-08')` ⇒ `NaN` ⇒ `null` in the JSON, so even the broken value
  disappears. Read a blank cell (empty, a raw U+00A0, or `&nbsp;`) as `null`, and raise "scraper
  roto" when the row's cell count is not EXACTLY the observed one — exactly, not a minimum,
  because a blank cell BEFORE the first mapped column shifts the row just as badly as a dropped
  one. `dte-public.ts` (`cell()`) is the template; `dte-mipyme.ts` `parseEmitidas` was fixed into
  it (#92). (ADR-004)
- **Unauthenticated public consultas go through `PortalDriver.requestPublic`.** A
  login-free CGI (DTE-authorized) is a cold, session-less, browser-free HTTP request
  (Node `fetch`, charset-aware) — not a `PortalSession`. Still a task + seam (audited),
  never a bespoke client in the facade. (ADR-014)
- **Authenticated HTML form-POST write flows go through `PortalSession.requestForm`.** The
  legacy `loa.sii.cl/cgi_IMT/` `TMBECN_*` CGIs (BHE emission) take `x-www-form-urlencoded`
  POSTs and return HTML, so they use `requestForm` (authenticated peer of `requestPublic.form`),
  NOT `requestJson` (JSON-only, treats HTML as a login wall). The login-wall check is URL-based
  (landing on `LOGIN_HOST`) since an HTML body is expected. Parse the response's inline
  `xml_values` with in-house helpers (single- AND double-quoted; `formatMiles("<n>")` amounts);
  read JS-built `<select>` values from their backing map (`iddir1`), never from the static HTML.
  (ADR-017)
- **Authenticated GWT-RPC read facades go through `PortalSession.requestText` (a cold replay),
  NOT `requestJson` (ADR-020).** The legacy GWT apps (`www3.sii.cl/sispadinternet` — peticiones
  administrativas; F29 Fase 2 later) speak GWT-RPC: a `text/x-gwt-rpc` POST (`5|0|7|…`) returning a
  `//OK[…]` object graph — neither JSON nor HTML. Reach them by a **cold authenticated POST** (never
  by driving the SPA — that is the F29-Fase-2 fragility): `requestText` (authenticated raw GET/POST
  → text, the peer of `requestPublic`) replays the call; the `.sii.cl` cookie authorizes, no warm-up
  needed. The GWT **token arg is NOT validated** (send a constant placeholder; auth is by cookie +
  the RUT param). The **policy hash IS validated** and rotates on redeploy → source it at runtime by
  a `requestText` GET of the permutation JS, cache it, and **self-heal** (re-fetch + re-probe) on a
  deserialization failure. Build the request + decode `//OK[…]` in an in-house `portal/gwt.ts`
  (stdlib only, no third-party GWT lib); `//EX[…]` business message ⇒ **verbatim** (ADR-004),
  `LOGIN_HOST` bounce ⇒ `SessionExpiredError`, changed shape ⇒ "scraper roto". The decoder is
  **schema-directed** — the per-type field layout is **derived from the compiled permutation's
  deserializers** (`gwt-schema.ts`, regenerated by `docs/sii-contract/*-schema-extract.py`), NOT
  reverse-engineered from response samples (which can't be complete — different rows expose
  different types). Key the schema by **class name** (the per-type CRC rotates on recompile; the
  layout does not). Body-RUT (validate `--rut` vs the operable set, like RCV). PII-dense (own +
  functionary + third-party) ⇒ NO `raw`, tight allowlist. (ADR-020)
  **GWT writes (protocol 7, rfiInternet — the F29 submit) follow the same rules in reverse
  (#159).** The encoder is `Gwt7Codec` in `portal/gwt.ts`; write layouts come from the
  permutation's SERIALIZERS (`rfi-schema.ts`). A node carries its class name only; the CRC of every
  signature, like the service's policy, is read from the live permutation at call time and never
  written as a constant. A class or field missing from the layouts throws "scraper roto"; nothing
  is guessed. Verify a new codec against real captures **locally** (an env-gated test), and commit
  only synthetic fixtures. **The encoder reproduces the client JRE's object identity**: two
  equal Strings, and two equal boxes that `valueOf` caches (every `Boolean`; `Byte` / `Short` /
  `Integer` / `Character` in -128..127), are ONE object, written once and then
  back-referenced. A request rebuilt from decoded responses differs from the browser's bytes
  without it (Strings: #160; boxes: #161).
- **When SII computes something client-side, port SII's own compiled code, never write the rule
  ourselves (#160).** The F29 form's formulas, its decimal arithmetic and its storage rules live
  in the rfiInternet permutation (`PG`, `rK`/`sK`, `rC`/`jC`, `jL`…). Read the function, cite it
  by its observed name and the permutation's strong-name, and keep SII's quirks as observed
  (`ROUND(-12.5) = -11`, `-0.0`). Deviate only where SII's code is plainly broken (two
  negatives wrap in its subtraction), and say so in a comment. The proof is a byte-for-byte
  equality against the browser's real request, checked locally from a capture: matching values
  alone missed three rules (store-through-widget, zero as `''`, String identity).
- **Document downloads go through `PortalSession.requestBinary` + the `FileSink` seam, and a
  task returns a DESCRIPTOR, never bytes (ADR-022).** A surface that produces a file (first:
  `f29 pdf`) takes the response body UNDECODED (`requestBinary` — running a PDF through
  `TextDecoder` corrupts it), writes it through the `FileSink` seam (never `node:fs` directly —
  the pure barrel must stay Node-free, ADR-016), and returns `{tipo, path, archivo, bytes,
  contentType, …}`. **Never base64 the bytes into the result**: these documents are PII-dense,
  so their contents must not enter the LLM's context (ADR-006), and a ~34 KB PDF is tens of
  thousands of tokens nobody reads. `Runtime.files` is OPTIONAL (like `secrets`) so an embedded
  consumer isn't forced to supply one; a task that needs it and finds it missing raises an
  actionable error. **Success is decided by `content-type` + magic bytes, NEVER by HTTP status**
  — SII answers `200` for its own error page AND for the login-wall bounce (observed). The
  destination directory is a REQUIRED task argument (the pure core cannot know `$HOME`); each
  SURFACE applies the default from `documentosDir()` (`./node` subpath; it follows `SII_HOME`,
  #164). Compose the local
  filename yourself — SII's `Content-Disposition` is generic and carries no folio/período.
- **Write surfaces are two-phase, session-keyed, confirm-gated, PII-free in the audit (ADR-017).**
  A state-changing op (first: `bte emit`) exposes a non-mutating PREVIEW (server computes the
  result without committing) split from the ISSUE step. The CLI defaults to the preview; the real
  write needs an explicit `--confirm <echo>` (double-entry of a load-bearing value, e.g. the gross
  total). The MCP `*_emit` tool carries `destructiveHint: true` + an explicit `confirmar` + amount
  echo, with an honest "issues a legally-binding document" description. Audit every attempt with
  the result id (folio) only — never the counterparty / amount / free-text (PII/business data).
  **Never retry a write after a SII error.** Server-computed values (retención rate) are READ from
  the form, never hardcoded. Live-validate the ISSUE path against a real (needed) document — never
  a throwaway.
- **A write that creates a debt stops at the declaration and returns SII's payment link (ADR-029).**
  We never pay. The result carries `pagoUrl` (`null` when nothing is owed): SII's own payment
  entry, which the user opens in THEIR browser and authenticates there themselves. The link must
  carry no session material from our jar. If SII's only link embeds a session-bound token, return
  the generic entry point plus the folio. Never inject our cookies into the user's browser
  (ADR-006). The confirm echo guards against a mistake, not against an unattended agent; say so
  in the ADR of every write surface an agent can reach. `f29 submit` is the template.
- **SII's validation is never proof that a write is complete (ADR-029 amendment).** SII's
  validator answered "no presenta errores" on an F29 missing the remanente (77). Before an
  irreversible call, check what SII validated against the source it came from (the propuesta,
  the formulas), and refuse on any disagreement without contacting the irreversible endpoint.
  **An ambiguous outcome is resolved by reading state, never by resending:** a second F29 send
  is a rectificatoria. Only the server's own refusal proves the irreversible call had no effect
  (rfiInternet's `//EX`, raised as `F29RechazoError`). A lost answer, a body that does not parse
  or a dead session after the call was sent is UNCONFIRMED: read the state, and say so when it
  does not settle it. An error class shared by "SII said no" and "we could not read SII's
  answer" must not decide this (#193 review).
- **Wire parsing is zod-at-the-boundary + alias-tolerant rows (ADR-011 / ADR-004).**
  Validate the SDI ENVELOPE with zod (`respEstado` block + the `data[]` array; use
  `.loose()` so unobserved fields survive into `raw`). Project each row into the
  curated shape with an **alias-tolerant** lookup (an ordered tuple per logical
  field, OBSERVED NAME FIRST; extend with a `// observed …` citation when SII serves
  a new key). Empty `data[]` is a legitimate "no rows", never an error. zod stays at
  the boundary only — curated domain types are plain TypeScript. `representacion.ts`
  predates this (hand-rolled, pre-zod) and may be migrated; `rcv.ts` is the template.
- **A field one feature adds to a shared schema never breaks another feature's read (#214).**
  `DatosCntrNow` is the identity read every login depends on, and `alertas` reads more fields
  off the same object. Such a field carries `.catch(null)`, so an unexpected type on some account
  loses only that field (its consumer reads it as unknown), never the whole parse. Applied twice
  before it was written down: `atributos` (#208), then the three `contribuyente` window fields.
- **Domain read surfaces own a per-module file + a register fn (no barrel churn).**
  Each module ships `cli/src/commands/<mod>.ts` (`register<Mod>(program, runtime)`)
  and `mcp/src/tools/<mod>.ts` (`register<Mod>Tools(server, runtime)`); `program.ts`
  / `server.ts` call it from ONE append-only line. This keeps the shared command tree
  conflict-free across parallel module worktrees (ADR-007). `rcv` sets the pattern.
- **Curated + raw for rich payloads.** When SII returns 30+ fields per row,
  expose a curated typed shape (~10–15 fields) plus a `raw` carrying the full
  payload for tax-special edge cases. **Exception: drop `raw` when the
  non-curated data is PII, not tax detail.** F22's uncurated fields are pure
  identity/bank PII (RUT, dirección, email, número de cuenta) — every tax código
  IS curated — so F22 exposes NO `raw` at all, keeping that PII off every surface
  / the LLM / the audit log. **BTE/BHE joins this no-`raw` camp (live BUG-1):** a
  boleta ROW mixes counterparty data with the taxpayer's OWN identity on both sides
  (emitidas `usuemisor` = self emitter, recibidas `nombre_receptor` = self receptor),
  and the own-identity field set is not provably enumerable — so a per-field denylist
  is unsafe; curate the named tax fields and expose NO `raw`. **Prefer dropping `raw`
  over a denylist whenever the own-PII field set can't be proven complete.** (ADR-004)
- **When a generic grid must keep the taxpayer's own identity out, match it by label AND by
  value, and never on a weak value match (#183).** A per-DJ grid has no fixed field set to
  curate, so own identity is removed three ways:
  - by the label of the columns that ARE the informado (`partícipe`/`aportante`);
  - by the joined RUT exactly anywhere, and a bare RUT body only under a RUT/RUN label (a monto
    can carry the same digits);
  - by the name when two SIGNIFICANT words match (≥3 letters, no connectors like `del`/`las`).

  The name rule was corrected twice. Live, an exact match missed the informante's own spelling
  (2 of 3 words). In review, a two-token match on any word would have dropped a third-party
  "Banco de la Nación" for a taxpayer named "… de la …", a silent loss of the data the user
  needs. Verify against the real name in-process (`whoami`), printing booleans only.
- **Curate PII-dense code grids by DENYLISTING the (bounded) PII, not allowlisting
  the tax códigos.** When a grid interleaves tax códigos with identity/bank PII
  (F22), drop ONLY the PII códigos and surface everything else. The PII set is small,
  fixed, and authoritative (F22's `codigosFormato.codigosCabecera` = the form header
  section, + the bank códigos) — so a denylist stays comprehensive. The tax códigos,
  by contrast, are many and taxpayer-specific: an **allowlist of tax códigos was
  tried for F22 `--full` (#27) and REJECTED** because it silently HID real
  honorarios/retenciones/deducciones lines for taxpayers whose códigos weren't in the
  hand map (AT 2023–2024) — the exact data the user needs. Surface unmapped non-PII
  códigos in an `otros`/visible bucket, never drop them. Keep the PII denylist
  complete by citing each código (`// observed …`); the RUT leaked under `9306`/`9920`
  then `8809` before the set was completed. (ADR-004 / ADR-006)
- **Body-RUT vs session-keyed surfaces (ADR-005).** A *body-RUT* surface (RCV)
  carries the operating RUT in the request body, so `operate`/`--rut` reaches a
  represented empresa — the task resolves the operating RUT. A *session-keyed*
  surface (F22; F29/BHE expected) authorizes by the session PRINCIPAL: it ignores
  the operate pointer, takes NO `--rut`, and always reads self; the empresa's data
  is reached by logging in AS the empresa (logout→login). Confirm reach live before
  wiring each session-keyed surface (F22 confirmed 2026-06-27). `rcv` is the body-RUT
  template, `f22` the session-keyed one. **A session-keyed task rejects a representing pointer
  through the shared `assertOperatingSelf(runtime, mkError)` in `auth/session.ts`** (one check,
  the surface supplies its own typed error + wording) — never a private copy; the third copy
  (carpeta, #110) turned it into the helper. `f29`/`bte` still carry the older copies and migrate
  on their next touch.
- **`www2.sii.cl/app/*` surfaces need the www2 APP SESSION, a second cookies-only layer
  (ADR-026).** The classic `.sii.cl` jar reaches www1/www3/www4/loa but NOT the `/app/<name>-api`
  facades (bare 401). That layer is the httpOnly `.sii.cl` pair `X-SII-STATE-TYPE` + a state cookie `X-SII-STATE-<X>` (suffix varies), minted
  ONLY by the user at SII's `oauthsii-v1` page (headed, reCAPTCHA — never headless),
  persisted in the same session file. A www2 facade FIRST reads `GET /app/session/status`
  (the SPA's own liveness read), keys every API path by its `userId` verbatim, and on a non-200
  raises `Www2SessionError` (a `NotAuthenticated`, actionable), never a warm-up retry. The read
  lives ONCE in `portal/www2-session.ts`. **Since ADR-027 the layer is minted ONLY by the MCP's
  `auth_login` (`www2` flag)** — the headed OAuth login left the CLI (no CLI command may need a
  browser window), still never a password over MCP — so **every www2 surface (Carpeta) is
  MCP-only**, and `Www2SessionError` names that route. `carpeta` is the template; the wire
  findings are in `sii-contract/carpeta-tributaria.md` and `sii-contract/auth-login.md`.
- **Three authorization modes, not two (ADR-023).** Besides *body-RUT* (RCV) and
  *session-keyed* (F22/F29/BHE), a surface can be **empresa-keyed**: the MIPYME facturación
  portal has its OWN authorized-empresa list (`mipeSelEmpresa.cgi` — the empresas that
  registered this user as *usuario autorizado*), which is neither the operate pointer's operable
  set nor the session principal. An empresa-keyed task takes `--empresa`, validates it against
  the LIVE list, and POSTs the selection before every operation (the choice scopes the form, the
  borrador CRUD and the listing). `factura` is the template.
- **Let SII's own client-side validator judge the document, in-page, before POSTing (ADR-023).**
  Where a legacy form ships a validator (`validaFacEx()` on the MIPYME factura form), run it via
  `evaluate` with `window.alert` captured and surface its Spanish message VERBATIM. It produces
  exactly the refusals the server would bounce, so an invalid document never costs a round trip —
  posting past it was observed to redirect back to the form with the same alert.
- **A draft is a write, but not a destructive one (ADR-023).** A reversible, legally-inert write
  (a `borrador`) needs no double-entry confirm and no `destructiveHint` — that ceremony (ADR-017)
  is for the irreversible step. Gate the DELETE instead: CLI `--confirm <id>` (double-entry of
  the id) + MCP `destructiveHint` with an explicit `confirmar`.
- **Pace multi-call fan-outs via `Clock.sleep`.** A task that fires N POSTs (a
  multi-period/-year loop, a folio walk) sleeps `1000/rateLimitRps` ms between
  them through the `Clock` seam (the fake resolves instantly, so tests don't wait)
  — never hammer SII; never retry after a block. (ADR-004)
- **Pass SII's Spanish error messages through unchanged.** The user knows the
  domain; opaque translations waste their time. A scraper that can't find its
  selector raises a "scraper broken" error — never retry silently.
- **Never retry after a SII rate-limit / block.** It is server-side and timed;
  surface the message verbatim and stop.
- **In a multi-call fan-out, a per-item SII error stops the ITEM, not the batch.**
  When a task fans out N POSTs (a multi-folio/-period/-year loop) and ONE item
  returns a business/server error (e.g. F22 `historial`'s `buscaEventos` failing on
  a superseded folio — SII's own UI fails identically), capture that item's SII
  message VERBATIM in a per-item error list (F22's `foliosConError`) and continue
  with the rest; never retry it. A SESSION-level error (`NotAuthenticated` /
  `SessionExpired`) is NOT a per-item error and still aborts the whole fan-out. This
  refines "surface verbatim and stop" for the batch case: stop the item, surface it,
  keep the rest. (ADR-004)
- **A composite read is one session over the facades, never a chain of tasks (ADR-030).**
  `alertas` is the template for `iva` / `renta`:
  - one `withSession`, the portal facades called inside it, every call paced, one receipt;
  - the caller chooses the sources (`--fuentes`), and `--help` states the cost in SII calls;
  - each source reports `ok` / `error` (with its `classifyError` kind) / `omitida`, plus
    `incompleto`; a dead session or SII's rate limit aborts all; a non-SII error propagates;
  - every item has an id built from what it is, so the caller diffs runs and nothing is stored.
- **A "missing obligation" is bounded by the account's own obligation window, never inferred
  from activity alone (#195).** Live, an empresa got five « F29 sin declarar » for the months
  before it existed: "files F29 at least once in the window" was true, but it did not exist
  yet. Read the bounds SII holds for the account (`DatosCntrNow` `fechaInicioActividades`,
  `fechaTerminoGiro`, `autorizadoDeclararDia20`) before deciding something was due.
  **The obligation itself comes from SII's registration, not from activity (#208).** Activity
  ("a Vigente F29 in the window") misses a new business that never filed, and an inicio de
  actividades alone also fits an honorarios-only persona. Read the regime SII holds
  (`DatosCntrNow.atributos`, observed codes only) and start the obligation at the LATER of the
  inicio and the regime's own start: the first version used the inicio alone, which the #209
  review caught, and would have flagged the months before an account entered the regime. An
  unknown code or an unparseable date is "unknown", never "not obligated"; keep the activity
  rule as the fallback. A probe over `atributos` redacts `valor`: under `NOTI` it is the email.
- **Validate a RUT locally (Mod-11) BEFORE any login attempt.** A malformed RUT
  must never become a wasted submit — repeated failed logins lock the account.
  The CLI parses + Mod-11-checks the RUT before prompting/sending the Clave; a
  login (browser or `--console`) makes exactly ONE attempt, never auto-retried.
  (ADR-004 / ADR-010)

## Security, secrets & PII

- **The Clave never reaches the LLM and never lands in plaintext.** Login is
  either the user typing into SII's real page (browser, cookies-only) or a value
  in the OS keyring behind the `SecretStore` seam. No MCP tool accepts a
  password argument. (ADR-006)
- **The Clave never arrives as a flag VALUE or an argument, and every source is named
  explicitly.** The sources are:
  - the hidden prompt (`--console`, ADR-010);
  - the OS keyring (`--keyring`, ADR-025);
  - an environment variable **named on the command line** (`--clave-env <VAR>`: no
    default name, deleted from `process.env` after the read);
  - stdin (`--clave-stdin`, refused on a TTY).

  The last two come from ADR-028. There is never a fallback from one source to another,
  and never a `--clave <value>`, which would leak through argv, shell history and agent
  transcripts. The Clave is held in memory for one attempt, then discarded; only
  cookies persist.
  - Every Clave-taking task (`consoleLogin`, `keyringLogin`, the ADR-028 ones) is
    exported from the CLI-only `@albertomarturelo/sii-core/cli` subpath, NOT the main
    barrel, so the MCP server cannot wire it.
  - A non-interactive login honours the rejection latch (`~/.sii/login-blocked.json`, one
    entry per RUT): after SII rejects a Clave, unattended logins refuse without contacting
    SII until a human logs in or runs `sii auth unblock`, which refuses without a TTY. A
    safety rail an agent must not undo is enforced in code AND stated in the agent's
    instructions, and the docs say honestly what the code check misses (here: a harness
    that runs commands in a pseudo-terminal passes a TTY check).
    (ADR-006 / ADR-010 / ADR-028)
  - **Every credential login probes for a live session first and is RUT-aware.** A live
    session for the same RUT answers `already_authenticated` without reading the Clave; one
    for ANOTHER RUT is an error, never a silent "already authenticated" as the wrong account
    (switching is logout→login, ADR-005). There is no `--if-needed` flag (ADR-028 amendment).
  - **An error that may carry a secret never echoes the user's input.** `--clave-env` given a
    non-name refuses WITHOUT repeating it: the likeliest mistake is passing the Clave itself.
- **Never commit** `*.pfx`, `*.p12`, `.env`, or anything under `.sii/`. Sessions
  are cookies-only; `.gitignore` blocks them — re-verify before any `git add`.
- **Audit every state-touching op** via the `AuditSink` port: `{ts, action, rut,
  result, durationMs?, ...extra}`. Keys whose lowercased name contains
  `password|clave|cookie|secret|token` are dropped before the line is written.
  The log is a receipt, never a gatekeeper — write failures degrade silently.
- **PII hygiene.** Real PII (nombre, RUT, dirección, email, teléfono, DoB) never
  lands in a tracked file — including CI guard denylists (hold those in a repo
  secret). Tests use synthetic, Mod-11-valid RUTs only. A task that surfaces the
  user's own PII carries an explicit opt-in name and states the exposure in its
  CLI help + MCP description; PII values never go to the audit log.
- **No account state in a public artifact.** A live validation is written up as WHAT was
  confirmed (fields, an anulada, the sums' rule, an empty month parsed), never as the
  owner's account activity: which períodos are filed or empty, which months had boletas,
  how many rows, start of activities, plans tied to the filing calendar. This covers the
  ADRs, `sii-contract/*.md`, ROADMAP, commit bodies, issues and PR bodies. A squash body
  and GitHub's edit history keep what was written, so it is caught in review, before the
  merge. Leaked twice: a #179 comment, then #226's ADR + contract (scrubbed in #229).

## Testing

- Tests must NOT hit production SII. Default mode is recorded fixtures with
  synthetic data; any live test is gated behind an explicit env var.
- Reproduce CI conditions before pushing (env stripped of any credential vars).

## Naming

- Files: kebab-case `.ts` modules. Tests: `<module>.test.ts` (vitest).
- Domain terms stay in Spanish where they are Spanish (`boletaHonorarios`,
  `propuestaF29`, `carpetaTributaria`). Don't anglicize SII terminology.
- User-facing surfaces (CLI verbs, MCP tool names) are English where no
  entrenched Spanish term exists (`status`, `login`, `profile`), Spanish where
  one does (`rcv`, `f29`, `bte`).
- Form/document codes stay numeric (`F29`, `F22`, DTE `33`/`39`).
- **Surfaces are named by SII artifact (ADR-024).** The top-level CLI verb / MCP prefix
  is the tax artifact (`f29`, `rcv`, `dte`, `bte`…) — never the portal or transport
  (`mipyme`, `sdi`), and never a document subclass of an artifact that already has a verb
  (`factura` is DTE 33 ⇒ `dte`). Document types are numeric parameters (`--tipo 61`), not
  verbs. Two transports for one artifact share the verb and differ by prerequisites in
  `--help`. Portal-layer files are `portal/<artifact>-<transport>.ts` (`dte-public`,
  `dte-mipyme`). **The first line of every surface's `--help` declares its auth mode**
  (session-keyed / body-RUT / empresa-keyed / public). A verb not in ROADMAP's
  "Where a new surface goes" table needs an ADR before it lands.

## Commits & PRs

- One topic per commit. Conventional Commits subject (`feat(scope): …`),
  ≤72 chars. English everywhere (commits, branches, PRs).
- **One feature / work-unit per PR.** Don't bundle two distinct features even on
  the same branch — when a second feature emerges mid-branch, give it its own
  branch/PR (stacked if it depends on the first). Split BEFORE opening the PR.
  For a FORK PR, "stacked" means SEQUENCED AFTER the first merge: the dependent
  feature waits, then branches off the updated `main` — never two in one branch.
  **Merging a same-repo stack:** retarget the dependent PR to `main` (`gh pr edit --base main`)
  BEFORE merging its base with `--delete-branch`. Deleting the base branch CLOSES the
  dependent PR instead of retargeting it (#226 was closed this way and had to be reopened).
  After the base's squash, rebase the dependent `--onto origin/main <old base tip>` and gate
  its merge on CI for the new head.
- **Status docs go in a SEPARATE commit from feature code.** `ROADMAP.md`
  bookkeeping is its own commit; the feature commit carries code
  plus its tightly-coupled docs only (the ADR + any `sii-contract/*.md`).
- **A squash merge's subject must carry the PR number.** Every commit on `main` ends with
  `(#N)` — that is how a commit is traced back to its review. GitHub appends it automatically
  only when it composes the subject itself; passing `gh pr merge --squash --subject "…"`
  suppresses that, so **write the `(#N)` into the subject yourself**. The ≤72-char limit is on
  the subject you author; the appended reference may push the final line past it, as the existing
  history shows. (Learned by getting it wrong twice on the 0.10.0 work — ADR-007.)
- **No AI attribution anywhere** — no `Co-Authored-By`, no "Generated with",
  no `🤖`, in any artifact that lands in git or on GitHub. Authorship is the
  human owner.
- `docs/` updates ship in the SAME commit as the code that motivated them.
- **Agent knowledge bases follow the CLI.** `docs/integrations/*/skill-*.md` describe CLI
  commands, flags and error kinds to third-party agents, which read them at the release tag of
  the binary they run. A PR that changes any of those updates the affected skill file in the
  same PR, so a tag's skill always matches that tag's binary.
- **A user-visible PR writes its line under `## Unreleased` in the root `CHANGELOG.md`
  (ADR-021 amendment).** One line, in the feature commit (it is the change's own doc, like the
  ADR, not status bookkeeping). "User-visible" means anything an installed package does
  differently: a CLI verb, flag or output field, an MCP tool or its result, an error kind, a
  core export. Repo-only changes (CI, docs, skills) get no line. A change that breaks a caller
  starts with **Breaking** and says what to do instead. The release commit moves the list into
  the version's sections.
- **Pre-1.0, the bump follows the changelog (ADR-021 amendment).** A PATCH carries `Fixed`,
  `Security` and non-breaking `Changed` only. Anything `Added` (a verb, flag, tool, result field,
  export), `Removed` or **Breaking** makes it a MINOR. `release.yml` refuses a patch tag whose
  sections say otherwise, and any tag while `## Unreleased` still holds an entry. 0.12.2 shipped
  an `Added` field in a patch; the rule applies from 0.15.0.
