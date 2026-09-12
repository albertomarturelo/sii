# ADR-026: The www2 app session — a second cookies-only login, minted only by the user at SII's OAuth page

## Status

Accepted — 2026-09-12. Extends ADR-006 (browser cookies-only login) to a SECOND session
layer; keeps ADR-005 (identity), ADR-003 (seams), ADR-010/025 (console/keyring paths).
Gates #109 (`carpeta regular`) and #110 (`carpeta instituciones`). Evidence:
`docs/sii-contract/carpeta-tributaria.md` (probes 2026-09-11, headed spike 2026-09-12).

## Context

SII's newer apps on `www2.sii.cl` (`/app/<name>-api/*`, first the Carpeta Tributaria's
`cte-api-carpetatributaria`) are NOT authorized by the classic `.sii.cl` cookies
(`NETSCAPE_LIVEWIRE.*` / `TOKEN`) that `sii auth login` captures and that reach www1, www3,
www4 and loa. They need a **www2 app session** minted by an OAuth2 code flow
(`/app/session/login` → `/oauthsii-v1/`, a full Clave + reCAPTCHA Enterprise login page →
`/app/session/create`). Verified live: with the classic jar every `cte-api` call answers a bare
401, and no bridge/warm-up mints the app session. Once a human completes that page, the app
session is the httpOnly `.sii.cl` cookie pair `X-SII-STATE-CT` + `X-SII-STATE-TYPE` (~100 min),
and Mi SII stays authenticated on it after the OAuth page wipes the classic cookies.

So reaching www2 is a **login of its own**, which under CLAUDE.md is an auth-posture decision
before any code. The trigger is #110: the surface is built and unit-tested but cannot run.

## Decision

1. **The www2 app session is minted ONLY the ADR-006 way: the user types the Clave into SII's
   real `oauthsii-v1` page in a headed browser; we keep cookies only.** Never headless: the page
   runs reCAPTCHA Enterprise (`execute("login")`, "641 = bot"), so a `--console` / `--keyring`
   fill is both unreliable and exactly the automated-login behaviour the rate-limit/lock
   guardrails exist to avoid (ADR-004). No MCP tool takes a password (unchanged).
2. **It rides the SAME cookies-only session file, as a second layer.** `sii auth login` gains an
   opt-in step (`--www2`, or an actionable prompt from a www2 surface: "run `sii auth login
   --www2`") that, after the classic login, navigates the headed browser to the www2 app page
   and waits for `/app/session/status` to answer 200 JSON, then persists `storageState()` as
   today. No new `SessionStore` key, no second file, no new seam: `X-SII-STATE-*` are `.sii.cl`
   cookies and `PortalSession.requestText/requestJson` already carry them.
3. **Liveness of the layer is read, never assumed:** a www2 facade calls `GET
   /app/session/status?originalUrl=…` first (the SPA's own read) and keys API paths by its
   `userId` verbatim; a non-200 raises an actionable "www2 session missing/expired → `sii auth
   login --www2`" error, distinct from the classic `SessionExpiredError`. Never retried.
4. **Session-keyed by construction.** The app session's `userId` is the principal; a www2 surface
   rejects a representing operate pointer up front (F29 posture, ADR-005) until a live probe
   shows a persona's app session can address a represented `{userId}`.
5. **Order of logins is fixed: classic first, then www2** — because the OAuth page deletes the
   classic cookies from the browser context on mount. The classic jar is persisted from the
   classic landing (as today); the www2 step only ADDS cookies to the stored state. Whether the
   legacy side would run on `X-SII-STATE-*` alone is an open spike (see Consequences), not a
   dependency.

## Alternatives Considered

1. **Cookies-only "warm-up" from the classic session** (the contributor's `GET
   /app/session/status` claim) — rejected: verified false on every path (status, goto, bridge,
   bridge2 → all 401 / bounce). Their headed browser already held an app session.
2. **Automate the OAuth login headless with the keyring/console Clave** — rejected: reCAPTCHA
   Enterprise gates it, a low score is refused as a bot, and an automated Clave submit against a
   lock-on-failure account is the exact failure ADR-004/ADR-010 limit to ONE human-driven
   attempt. It would also move the Clave into a flow the model could trigger over MCP.
3. **Make the OAuth login THE login (one session for both worlds)** — deferred, not rejected:
   the spike showed Mi SII accepts `X-SII-STATE-*`, but not that every surface this tool uses
   (`DatosCntrNow`, www4 SDI, `loa` CGIs, MIPYME) does, nor that the classic cookies are not
   re-minted by `/app/session/create`. A follow-up spike may promote it into a superseding ADR.
4. **Drop the www2 surfaces** — rejected: the Carpeta Tributaria is the document contadores ask
   for most (discussion #87); the cost is one extra human step per ~100 min, opt-in.

## Consequences

- `sii auth login --www2` (CLI) / `auth_login` with `www2: true` (MCP, still no password arg)
  mint the second layer; `auth status` reports it (`www2: {authenticated, expiresAt}`); logout
  wipes both (best-effort `GET /app/session/close`).
- www2 facades share one `readWww2Session` helper (`portal/www2-session.ts`, raising `Www2SessionError`, a `NotAuthenticated`); new www2 apps reuse it (no per-app warm-up).
- Obligation: `--help` of every www2 surface names the extra login; the audit records the layer
  minted, never a cookie value (already dropped by the secret-key filter).
- Risk: two TTLs (classic ~60 min hint, www2 ~100 min) → the user may hit "www2 session
  missing" while the classic one is fine. The error names the exact command; no auto re-mint.
- Open spike (Alt. 3): after a `--www2` login, exercise `whoami`, `rcv summary`, `bte list`,
  `dte empresas` on the SAME jar; record which layer each accepted.
