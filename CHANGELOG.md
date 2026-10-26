# Changelog

Release history of the **sii** monorepo. The three published packages —
[`@albertomarturelo/sii-core`](packages/core), [`@albertomarturelo/sii-cli`](packages/cli)
and [`@albertomarturelo/sii-mcp`](packages/mcp) — move in **lockstep**: one version, one
tag, one npm publish (ADR-021). This file is the release-level view; the per-package
detail lives in each package's own changelog:

- [core](packages/core/CHANGELOG.md) — the domain engine (tasks, seams, portal facades)
- [cli](packages/cli/CHANGELOG.md) — the `sii …` terminal surface
- [mcp](packages/mcp/CHANGELOG.md) — the stdio MCP server

The project is pre-1.0, so MINOR bumps may carry breaking changes (pin, or use `~`).
Every decision behind a release is recorded as an ADR under
[`docs/decisions/`](docs/decisions/_index.md); the surface checklist is
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Unreleased

<!-- One line per user-visible PR, written in that PR (CONVENTIONS, ADR-021 amendment). Start
     a breaking one with **Breaking**. Any Added / Removed / Breaking line makes the next
     release a MINOR. The release commit turns this list into the version's sections here and
     in each package's changelog, and leaves only this comment; release.yml refuses a tag
     while an entry remains. -->

- **`bte list` no longer needs Chromium (#222).** The boletas de honorarios report is read from
  its HTML over the same HTTP connection as every other read, so `sii bte list` and the MCP's
  `bte_list` run on a machine without a browser. The result is unchanged.
- **Added: `testing.inlineMapsPage` (#222).** For library consumers, a core test helper that
  builds a synthetic legacy-CGI page with literal inline maps (and its `InlineMapValue` type), so
  a fake `bte list` needs no browser engine. A new export: the next release is a minor.
- **A `DatosCntrNow` field of an unexpected type no longer breaks the login (#214).** If Mi SII
  serves `fechaInicioActividades`, `fechaTerminoGiro` or `autorizadoDeclararDia20` as something
  other than text, `auth login`, `whoami` and `auth status --refresh` still read the identity,
  and `alertas` reads that field as unknown.
- **Accents in SII's legacy pages no longer come back as `�` (#224).** The boletas de honorarios
  pages declare their charset only inside the HTML, which the browser-free driver ignored, so a
  name or an SII message with ñ or an accent came back garbled in `bte emit`. The driver now
  reads that declaration, as a browser does.

## 0.16.0 — 2026-10-23 — Dónde se cortó la red

When SII never answers, the CLI and the MCP say which host failed and why, instead of a bare
`fetch failed`.

**A network failure names the host and the cause (#215).** Node's `fetch` reports every
transport failure as `fetch failed` and keeps the reason in a field nothing showed. An egress
proxy that reset the TLS handshake to one SII host (`misiir.sii.cl`) while letting the login host
through read as `unexpected`, and it took a separate diagnosis to find.
- The error is now the kind `network`, with exit 1 as before: a consumer that does not know the
  kind reads it as `unexpected`, which is what it was. Its message names the SII host and Node's
  cause (`ECONNRESET`, `ENOTFOUND`, `TIMEOUT`…); never the path, the query or the request body.
- RCV, F29, F22, representación, Carpeta and the public DTE consulta reported it as « Respuesta
  inesperada de SII (no es JSON) » or a DTE error. They now let it through. `alertas` stops on
  it instead of reporting a source error.
- A failed login's audit receipt records the RUT, the kind and, for a network failure, the host
  and the cause. Never the message or the Clave; a network failure does not set the latch.
- The contador bot's skill documents the kind: stop and notify, never retry a login in the same
  run, and the machine's network must let every `*.sii.cl` host through.

## 0.15.0 — 2026-10-23 — Lo que SII no te avisa

The CLI and the MCP read in one call what SII holds against you but never pushes, and they can
file the F29.

**`alertas` (#195, #208).** SII does not notify an F22 observación, a petición waiting for
antecedentes, or a month without F29.
- `sii alertas` reads them in ONE session and returns one list: the F22 observaciones of the
  last 3 años tributarios, the F29 « Guardada » never sent, « Rechazada por pago inconcluso »,
  unobserved estados and months not filed past their due date (last 12 períodos), and each
  petición's latest state.
- Every alerta has a stable `id`, so a routine reports only what is new without the CLI storing
  anything. `--desde` filters by date; `--fuentes f22,f29,peticiones` limits the ~20 paced SII
  calls of a full read.
- A missing F29 is only reported inside the account's own obligation window, read from Mi SII:
  from the inicio de actividades to the término de giro, with the due day (12 or 20) of its
  regime. An account SII holds in a primera-categoría regime (Pro Pyme General) gets it even
  before its first filing; an account that does not file F29 reads `no_declarante`.
- A source that fails is reported in `fuentes` / `incompleto` and the others still return; a
  dead session or SII's rate limit stops the read. The MCP's `alertas` does the same.

**`f29 submit` (#161, ADR-029).** The F29 is filed from SII's propuesta, as SII proposes it.
- `sii f29 submit <periodo>` is the preview: SII validates the borrador, and the result shows the
  propuesta, the códigos SII's formulas compute and the TOTAL A PAGAR (91). It files nothing,
  but leaves a borrador « Guardada » at SII.
- `--confirm <total>` files it, and must repeat that total. It refuses before filing when SII
  computes another total, when the validated borrador disagrees with the propuesta (SII's "no
  presenta errores" is not taken as proof), for a período already Vigente and for one without
  propuesta.
- It declares only and never pays. An answer that is lost after the filing call is reported as
  unconfirmed and never resent: a second filing is a rectificatoria.
- The MCP's `f29_submit_preview` and `f29_submit` (`destructiveHint`, `confirmar` + `total`) do
  the same. The contador bot's skill files only on the user's typed approval.
- Checked byte for byte against the browser's real requests on two private captures. The first
  live filing through the CLI is still pending (#162).

**Breaking (MCP): the session tools answer JSON (#198).** `auth_login`, `auth_status`,
`auth_logout` and `operate` returned Spanish text. They now return the same object as
`sii <cmd> --json`, like every other tool. A client that read their text should `JSON.parse` it;
errors are unchanged.

## 0.14.0 — 2026-10-21 — Lo que otros informaron de ti

The CLI and the MCP read what third parties reported about you to SII, the data an F22
observación is checked against.

**`f22 terceros` (#183).** Employers, banks, AFP, AGF and corredoras file declaraciones juradas
about the taxpayer every year, and the F22 propuesta is built from them. When the F22 gets an
observación such as B102, the question is who reported what, and until now the answer was in
the portal only.
- `sii f22 terceros <año>` returns the per-DJ resumen with its totals, in ONE call to SII.
- `--dj <código>` returns that DJ's rows (folio, declarante, fecha, SII's per-row `estado`, and
  the DJ's own columns), every page of 10 up to 30; `--pagina <n>` reads one page.
- The MCP's `f22_terceros` does the same, and its description declares that the rows carry
  third-party data: the declarante's RUT and name, possibly a persona natural.
- The taxpayer's own identity is kept off the rows. SII had the informante's spelling of the
  name, which differed from Mi SII's, so the partícipe/aportante columns go by label as well as
  the RUT and name by value.
- Session-keyed, like the rest of F22. It refuses while `operate` points at an empresa.
- SII ships no F22 código per column and no link from an observación to a DJ, so neither is
  invented. The contador bot's skill lists the command.

**The account's own name survives the login (#186).** A persona login stored the RUT as the
account's own name, because SII's list of operable RUTs carries no name for the account itself.
`sii operate --list` now shows the name; log in again to pick it up.

**On the way to `f29 submit` (#159, #160).** The core gained the protocol-7 GWT-RPC codec of
SII's F29 form app and an interpreter of the form's own formula metadata, both checked byte
for byte against real captures. Nothing user-facing yet; the command is #161.

## 0.13.0 — 2026-10-19 — El estado donde lo guarde tu agente

The CLI and the MCP keep their state wherever you point them, and `f29 submit` has its decision.

**`SII_HOME` moves the state directory (#164).** Session, `operate` pointer, rejection latch,
audit log and downloaded documents lived in a fixed `~/.sii`. Some agent hosts keep only one
path: Grok Bot keeps `/workspace` and may replace the home directory. There, losing `~/.sii`
meant a fresh login on every run and, worse, a lost rejection latch, so an unattended agent
could retry a Clave SII had already rejected. Now `SII_HOME=/workspace/.sii` keeps all of it
there.
- Unset or empty means `~/.sii`, exactly as before.
- It must be an absolute path. A relative or `~` value is refused as a `validation` error that
  names the variable, never resolved against the working directory (a cron's moves).
- Whoever lifts the latch uses the same value: `SII_HOME=/workspace/.sii sii auth unblock`.
- The contador bot's skills now set it, and drop the `~/.sii` symlink they needed before. An
  existing link points at the same folder and is harmless.

**`f29 submit` is decided (#158).** ADR-029 and its amendment are on `main`, from the live
capture of the filing flow (#138). The submit replays SII's own form app without a browser,
fills the form with an in-house interpreter of SII's formula metadata, and refuses to file
when what SII validated disagrees with the propuesta: SII's "no presenta errores" passed a
form missing the remanente. Nothing is implemented yet; the plan is #159–#162.

**Breaking, for library consumers of `@albertomarturelo/sii-core/node` only:** the constants
`SII_DIR` and `DOCUMENTOS_DIR` are replaced by the functions `siiDir()` and `documentosDir()`.
A constant is computed at import, and validating `SII_HOME` there would crash the import
before any error handler runs. `createNodeRuntime` now builds a default only for a seam you
did not override. The CLI and MCP are unaffected.

## 0.12.2 — 2026-10-19 — Un contador para tu agente

The logout tells the truth about the www2 session, and the first agent integration ships.

**`sii auth logout` (and the MCP's `auth_logout`) no longer claim the www2 session was closed
(#146).** Observed live: SII does not revoke the www2 app session. Neither its own close nor
`autTermino.cgi` ends it, so it stays valid until it expires (~100 min). The old check read the
close's redirect as "closed". `www2Closed` is now proven like `serverClosed`, and is `false`
today. The result gains `www2ValidUntil`, and both surfaces say until when the session stays
valid at SII; its cookies are deleted from the machine. The same capture found a worse bug:
the www2 close deleted the classic cookies from the shared jar, so with a www2 layer the
classic close went out without them. Each close now runs in its own session.

**www2 errors name the right login (#151).** They pointed at `sii auth login --www2`, which
0.11.0 removed, and said the login was "pendiente". They now name the MCP's `auth_login` with
`www2: true`. The error `type` is unchanged.

**A contador bot for your agent** ([`docs/integrations/contador-bot/`](docs/integrations/contador-bot/README.md),
#155). It is written for Grok Bot and works with any agent that has a shell, a scheduler and
memory.
- A prompt to paste, plus two skills (initialization, and the CLI knowledge base).
- It reminds you before each F29 is due and prepares the month's borrador from SII's propuesta
  and the RCV.
- It gets each Clave onto the agent's computer without it passing through the chat.
- Filing stays manual until `sii f29 submit` exists. The approval protocol for it is already
  written.

The release workflow now waits until npm serves all three packages before it creates the
GitHub release (#123).

No breaking changes. For library consumers:
- `AuthLogoutResult.www2ValidUntil` is new and optional;
- `www2Closed` now reads `false` where it read a false `true`;
- `testing.seedSession` takes an optional `www2` layer.

## 0.12.1 — 2026-10-18

A patch for the logout over the browser-free driver (#135).

**`sii auth logout` (and the MCP's `auth_logout`) now say when SII really closed the
session.** Over HTTP, SII's `autTermino.cgi` answers `200` on its own path and navigates by
JavaScript, so the old check ("did we leave the logout page?") always reported
`serverClosed: false`, although SII does close the session. The close is now proven: the old
cookies, restored into a fresh session, no longer get into Mi SII. The audit receipt reads
`result: "ok"` only for a proven close, and `"local_only"` otherwise.

No breaking changes. For library consumers: the `logout` receipt's new `"local_only"` value,
and an optional `gotoLanding(url)` on `testing.FakePortalDriver` session scripts.

## 0.12.0 — 2026-10-18 — Errores que un agente entiende

0.11.0 let an agent log in and operate without a browser or a keyboard. This release lets it
**recover on its own**.

**Every error now says what kind it is** (#134, ADR-012 amendment). The CLI's JSON error on
STDERR is `{ "error", "type", "exitCode", "reason"?, "codigo"? }`, and the MCP's tool error is
the same object without `exitCode`. `error` is still SII's message, verbatim. `type` is a
stable name an agent branches on instead of parsing Spanish:
- `session_expired` / `not_authenticated`: log in again and retry once.
- `login_rejected`: SII rejected the Clave, and the latch is now set.
- `login_blocked`: the latch refused without contacting SII.
- `login_queued`: SII's waiting room.
- `rate_limited` and the rest: stop and alert a person.

Kinds are never renamed. The table lives in ADR-012, and the README's « Uso autónomo » turns it
into the agent's loop.

**A dead session is detected as dead** (#139). Without a browser, a session SII had already
closed looked alive: Mi SII answers it `200` with a page that only redirects to the login in
JavaScript. Every login then answered "already authenticated" and nothing recovered it. The
driver now recognises that page as the login wall, and a session counts as live only when Mi SII
returns your identity.

**Breaking changes:**

- **MCP:** a failed tool call's text is a JSON object instead of the bare message. The message
  is still in `error`.
- **CLI:** the JSON error gains fields (`type`, `exitCode`, and `reason` / `codigo` on login
  failures). Exit codes are unchanged, except `whoami` / `auth status --refresh` on a dead
  session, which now exit `2` (`session_expired`) instead of `3`.

**For library consumers:**
- `classifyError(error)` is exported from `@albertomarturelo/sii-core` and returns the same
  `{ type, reason?, codigo? }`.
- `whoami` / `statusRefresh` raise `SessionExpiredError` on a login landing.
- A Mi SII page without identity raises `UnexpectedResponseError` instead of `LoginFailedError`.

## 0.11.0 — 2026-10-18 — Sin navegador y sin teclado

**The CLI no longer needs a browser** (ADR-027). `sii auth login` is now a plain HTTP POST to
SII's real login form: you type RUT and Clave in the terminal, only cookies are kept, and
Playwright is no longer installed or launched for it. Almost every read runs over the same
browser-free driver: RCV, F22, F29, whoami, operate, peticiones (GWT-RPC) and the public DTE
consulta, all live-validated 2026-10-18. Chromium is now needed only where SII's own page
JavaScript must run: `bte list`, the Portal MIPYME (`sii dte`) and the MCP's login.

**And it no longer needs a keyboard** (ADR-028). For cron, CI and agents, the Clave can come
from an environment variable you **name** on the command line (`--clave-env SII_CLAVE`, deleted
from the environment after the read) or from stdin (`--clave-stdin`). Three rules govern every
login, and the README now states them once, in « Cómo funciona el login »:

1. The Clave's source is always named in the command. There is no fallback from one source to
   another.
2. A live session for that RUT means nothing is sent. A live session for **another** RUT is
   now an error instead of a silent "already authenticated" as the wrong account.
3. After SII rejects a Clave, a local **latch** makes every unattended login refuse **without
   contacting SII**, so a stale Clave in a loop cannot lock your account. A person lifts it
   after fixing the Clave, with a `--console` login or `sii auth unblock`. `sii auth status`
   reports the latch as `loginBlocked`.

The README's new « Uso autónomo » section is the guide for running this from an agent: the
exit-code loop, persisting `~/.sii/`, and the residual risk you accept by giving an agent your
Clave.

**Breaking changes (CLI):**

- `sii auth login` no longer opens a browser; it prompts in the terminal. `--console` remains
  as an explicit alias.
- `sii auth login --www2` and `sii carpeta …` left the CLI. The www2 layer needs SII's OAuth
  page, where reCAPTCHA runs, and no CLI command may need a person at a browser window. Both
  live on in the MCP (`auth_login` with `www2`, `carpeta_instituciones`).
- A credential login with a live session for a different RUT fails with an error naming
  `logout` → `login`.

**For library consumers:** `createNodeRuntime().portal` is now the `HttpPortalDriver`, and
Playwright moved to the optional `Runtime.browser`, which `createNodeRuntime` wires for you. A
consumer that builds its own `Runtime` must supply `browser` for `bteList` and the MIPYME `dte`
tasks, or they raise `BrowserRequiredError`. `AuthLoginResult.reason` gains `env_login` and
`stdin_login`, and `AuthStatusLocal` gains `loginBlocked`. `LoginFailedError` now carries a
typed `reason` and SII's `codigo` (#129), so no consumer has to parse the Spanish message.

## 0.10.0 — 2026-09-12 — Carpeta Tributaria y la segunda sesión del SII

`sii carpeta instituciones` reads SII's **live** list of destination institutions for the
Carpeta Tributaria Regular — the `enfinCodigo` its `/generar` demands. No catalog ships with
the tool: the codes drift, and a hardcoded one had already gone stale. Live-validated with 67
rows; `codigo` stays a string compared verbatim, because zero-padded (`"016"`) and unpadded
(`"1005"`) codes coexist in SII's own list.

Getting there uncovered the release's real finding: **`www2.sii.cl/app/*` has its own session
layer.** The classic cookies-only session reaches www1, www3, www4 and loa, but every
`cte-api` call answers a bare `401` until an OAuth2 flow at SII's `oauthsii-v1` page mints a
second cookie pair. So `sii auth login --www2` adds that layer the same way the project has
always handled the Clave: **the user types it into SII's own page**, headed, cookies only —
never headless, because reCAPTCHA Enterprise gates it and an automated Clave submit is how
accounts get locked (ADR-026). Both layers live in one session file; `auth status` reports
them and `auth logout` closes both.

Two things worth knowing before upgrading. With a warm classic session `--www2` asks for the
Clave **twice**, since the headed browser opens without cookies — the one-prompt flow is
tracked as #119. And `carpeta regular`, the PDF itself (#109), is **not** in this release; the
catalog and the session layer are what it was blocked on.

Also in: `UnexpectedResponseError` (#112), so an authenticated JSON call that gets a non-JSON
body no longer reads as an expired session — it names the endpoint, status, content-type and
the body's first characters verbatim. The SII surface that prompted it answers `200
text/plain` to a perfectly live session.

**No breaking changes.** Core's returned objects gain fields (`AuthStatusLocal.www2`,
`AuthLogoutResult.www2Closed`, `statusRefresh` → `AuthIdentityRefresh`) and `login` gains an
optional argument; all additive.

## 0.9.0 — 2026-09-09 — Login desde el llavero del sistema

`sii auth login --keyring`: the Clave is read from the OS keyring (Secret Service on Linux,
Keychain on macOS) instead of being typed, minting the same cookies-only session as
`--console`. Built for unattended use — one attempt, never a retry, never a prompt, and
**no automatic re-login**: an expired session still asks you to run the verb, because the
alternative is the shape that turns one stale entry into a locked account (ADR-025).

This resolves the `SecretStore` backend that ADR-006 left open, and it is **more
conservative than ADR-006 allowed**: the CLI never *writes* the Clave — storing it is your
own act with your own tool — and `Runtime.secrets` is typed read-only so no task can, even
by mistake.

**The MCP server gains nothing and holds no keyring.** The adapter is wired by the CLI's
composition root alone, never as a runtime default, so the MCP process carries no
`SecretStore` at all — asserted in both packages. The Clave still never crosses an MCP tool
argument.

`@napi-rs/keyring` `2.0.0`, pinned exactly: a native module that reads the OS credential
store must not roll a new major forward on a plain `pnpm install`.

**Breaking (core, type-level):** `Runtime.secrets` is now a `SecretReader` (`get` only), and
`AuthLoginResult.reason` gains `'keyring_login'`. Nothing shipped ever wired `secrets`, so no
runtime behaviour changes.

0.8.0 already shipped an outside contribution (#90); this is the first one taken through
the full review cycle `CONTRIBUTING.md` documents — issue, request-changes, fix, approve
(#101 → #105).

## 0.8.0 — 2026-09-09 — Facturación por el Portal MIPYME (borradores)

`sii dte empresas` / `borrador list|save|delete` / `preview` / `emitidos` / `pdf`: SII's own
**free** facturación portal, driven with the Clave alone — no certificado digital. Prepare a
factura (DTE 33/34), save and update it as a **borrador**, get the preview PDF, and read the
documents an empresa has already emitted, with their PDFs.

**Borradores only — emission is deliberately not implemented (ADR-023).** Signing on this
portal happens SERVER-SIDE, so a Clave alone would be enough to issue a legally binding
document. That one irreversible step stays with a human in SII's own UI; the signing CGI is
never called from this codebase, and a test asserts its absence from the build. Everything
that *prepares* a document is automated.

A **third authorization mode** joins body-RUT and session-keyed: **empresa-keyed**. The
portal keeps its own list of the empresas that registered you as *usuario autorizado*, which
is neither the `operate` pointer's operable set nor the session principal — so `--empresa` is
validated against that live list before every operation.

Surfaces are now named by **SII artifact** (ADR-024): the verb is `dte`, not the portal
(`mipyme`) or the transport, and document types are parameters (`--tipo 61`), not verbs.
`docs/ROADMAP.md` § "Where a new surface goes" is the placement table a new verb is checked
against. This work landed under a `factura` verb and was folded into `dte` before release,
so no published command or tool was renamed.

Also in this release: `CONTRIBUTING.md` now carries the CFD ceremony, the PR checklist in a
form a contributor without Claude Code can walk by hand, and what CI does **not** check on a
fork PR.

## 0.7.0 — 2026-08-31 — F29 document downloads

The first **document-download** surface: `sii f29 pdf` / `f29_pdf` saves the filed F29 of
a período to a local file — the form as SII prints it (which doubles as the **payment
receipt** when the período was paid) and/or the Certificado de Declaración.

The download needed no new SII reverse-engineering: the authorization token the PDF
servlet demands turned out to be a field the F29 estado facade already returned, so no
GWT-RPC and no SPA warm-up (ADR-022).

Two new seams: `PortalSession.requestBinary` (an undecoded response body — text decoding
corrupts a PDF) and `FileSink` (writing, mode 0600). A document-producing task returns a
DESCRIPTOR (path, size) and never the bytes: these PDFs are PII-dense, so their contents
stay out of the LLM's context (ADR-006).

**Breaking (core):** `PortalSession` gains `requestBinary` — only affects a consumer that
implements that interface itself.

## 0.6.0 — 2026-07-04 — RCV fan-out

`sii rcv all` / `rcv_all`: every RCV document of a período+lado in ONE session, flattened
and tagged by document type, with per-type resilience (a rejected type is surfaced, the
rest still return).

## 0.5.0 — 2026-07-03 — Peticiones administrativas; CLI + MCP on npm

`sii peticiones list` / `peticiones_list`: SISPAD administrative requests with their state
timeline, including SII's verbatim note on what is pending. The first **GWT-RPC** surface,
decoded in-house with a schema derived from the compiled permutation (ADR-020).

Also the first npm release of the **CLI and MCP** packages (ADR-021) — previously only the
core was published.

## 0.4.0 — 2026-07-03 — whoami

`sii whoami` / `whoami`: the authenticated account's own razón social (or full name) and
email, read live from the session principal. The audit records that the read happened,
never the values (ADR-006).

## 0.3.0 — 2026-07-02 — Public npm, MIT, and the first write surface

Renamed to `@albertomarturelo/sii-core`, relicensed **MIT** and published to the **public**
npm registry (ADR-018, ADR-019); `0.1.0`/`0.2.0` had been private on GitHub Packages.

First **write** surface: `bte emit` — issuing a Boleta de Honorarios Electrónica, two-phase
(preview vs issue) and confirm-gated (ADR-017).

## 0.2.0 — 2026-07-02 — Embeddable core

The core became embeddable: a pure main barrel (no `node:*` or Playwright evaluated at
import time) with a `./node` composition subpath, and Playwright as an OPTIONAL peer
(ADR-016). A consumer injecting its own seams never installs a browser.

## 0.1.0 — 2026-06-30 — First release

The read surfaces built up to that point — `auth`, `operate`, `rcv`, `f22`, `f29` (Fase 1),
`bte list`, `dte authorized` — on the shared core, behind injectable seams (ADR-003),
published privately to GitHub Packages (ADR-015, later superseded).
