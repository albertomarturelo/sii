# Wire contract — auth login (RUT + Clave Tributaria)

Observed 2026-06-28 against the live SII portal (production — the only target,
ADR-004). First-hand observation, no third-party library (ADR-004). All concrete
values below are **redacted / synthetic** — the owner's real RUT, name, email,
phone, and addresses are PII and MUST NOT land here (ADR-004, PII hygiene).

Surface: `@albertomarturelo/sii-core` `auth.login` / `auth.statusRefresh`
(`packages/core/src/auth/auth.ts`) over the Playwright `PortalDriver`
(`packages/core/src/adapters/node/portal.ts`). CLI: `sii auth login`,
`sii auth status [--refresh]`, `sii auth logout`.

## Flow

1. **Open login (headed).** `interactiveLogin` opens Chromium at the login host
   and waits for the user to type RUT + Clave INTO SII's page. The Clave never
   crosses our process boundary (ADR-006).
   - Login host: `https://zeusr.sii.cl`
   - Login form path: `/AUT2000/InicioAutenticacion/IngresoRutClave.html`
2. **Detect success by URL, not DOM** (ADR-006). Still on `zeusr.sii.cl` ⇒ not
   authenticated; any other host ⇒ through. After a successful login a
   `goto(miSii)` lands on the Mi-SII home:
   - Destination: `https://misiir.sii.cl/cgi_misii/siihome.cgi`
   - **Observed landed URL:** `https://misiir.sii.cl/cgi_misii/siihome.cgi`
     (HTTP `200`) — host ≠ `zeusr.sii.cl`, so the URL contract holds.
3. **Read identity from inline JS, not the DOM** (CONVENTIONS: prefer inline
   structured data). The Mi-SII home serves a global `DatosCntrNow` object; we
   evaluate `typeof DatosCntrNow !== 'undefined' ? DatosCntrNow : null` and read
   `contribuyente`. Account type is derived: `razonSocial` present ⇒ `empresa`,
   else `persona`.
4. **Persist cookies-only.** `storageState()` (cookies + origins, NO password)
   is written to `~/.sii/session.json` (mode `0600`) as
   `{ rut, cookies, savedAt }`. Verified: 21 cookies, no `password`/`clave` key
   anywhere in the file.
5. **Logout.** `goto` `https://zeusr.sii.cl/cgi_AUT2000/autTermino.cgi` (best-effort), then
   the local session + operate state are wiped. Under Playwright (2026-06-28) the page's JS
   navigated OFF that path. Since #135 the close is decided by **proof**, not by the landing:
   see « Logout over HTTP » below.

## `DatosCntrNow` response shape (observed, types only — values redacted)

Top level:

| key | type | notes |
| --- | --- | --- |
| `codigoError` | number | `0` on success (not asserted by core) |
| `descripcionError` | string | |
| `sysdate` | null | |
| `contribuyente` | object | the identity payload (below) |
| `direcciones` | array | 1 entry observed (addresses — PII) |
| `atributos` | array | 2 entries observed |
| `alertas` | array | 0 entries observed |

`contribuyente` (≈45 fields; **curated subset core reads is marked ✓**). The
`whoami` surface (#70) reads `eMail` on top of the identity fields (razón
social/nombre); a fuller `profile` (domicilio from `direcciones[]` + a `raw`)
remains future — CONVENTIONS: curated + raw for 30+ fields:

| key | type | core reads | notes |
| --- | --- | :---: | --- |
| `rut` | string | ✓ | numeric body; joined with `dv` |
| `dv` | string | ✓ | Mod-11 check digit |
| `nombres` | string | ✓ | PII |
| `apellidoPaterno` | string | ✓ | PII |
| `apellidoMaterno` | string | ✓ | PII |
| `razonSocial` | null | ✓ | **null for persona** → drives `accountType` |
| `tipoContribuyenteCodigo` / `…Descripcion` | string | | |
| `subtipoContribuyenteCodigo` / `…Descrip` | string | | |
| `paisCodigo` | string | | |
| `sexo` | string | | PII |
| `numeroPasaporte` | null | | |
| `fechaConstitucion` | null | | (empresa-only) |
| `fechaNacimiento` | string | | PII |
| `fechaDefuncion` | null | | |
| `eMail` | string | ✓ | PII — surfaced by `whoami` (#70) |
| `telefonoMovil` | string | | PII |
| `fechaCreaRegistroCntr` / `fechaModiRegistroCntr` | string | | |
| `fechaTerminoGiro` | null | | |
| `autorizadoDeclararDia20` | string | | |
| `fechaInicioActividades` | string | | |
| `unidadOperativaCodigo` / `…Descripcion` / `…Direccion` | string | | |
| `unidadOperativaGc*` | null | | |
| `capitalPorEnterar` / `capitalEnterado` | string | | |
| `fIndVerificacion` | null | | |
| `fechaCreaRegistroNeg` / `fechaModiRegistroNeg` | string | | |
| `segmentoCodigo` / `segmentoDescripcion` | string | | |
| `personaEmpresa` | string | | |
| `glosaActividad` | string | | |
| `tipoActuacion` / `descripcionActuacion` | null | | |
| `declaraTG` | string | | |
| `personaMiSii` | string | | |

(`contribuyente` also repeats `codigoError` / `descripcionError` / `sysdate`.)

## Verified this session (2026-06-28)

- [x] `sii auth login` — headed login, landed off `zeusr.sii.cl` on the Mi-SII
      home, identity read from `DatosCntrNow`.
- [x] Cookies-only session at `~/.sii/session.json`, mode `0600`,
      `{ rut, cookies, savedAt }`, no plaintext secret (21 cookies).
- [x] `sii auth status` — local read shows the authenticated RUT + `operating
      as:` header (self).
- [x] `sii auth status --refresh` — live portal readback (restore cookies →
      goto miSii → re-read `DatosCntrNow`): RUT + nombre + `tipo: persona`.
- [x] `sii auth logout` — `goto autTermino.cgi` redirected OFF that path
      (server close detected, best-effort), then `~/.sii/session.json` + operate
      state wiped; `auth status` → not authenticated.

## Login FORM contract (for the future credential re-mint path — ADR-006)

Observed 2026-06-28 by a **read-only GET** of the public login page (no login,
no credentials submitted, account untouched). Backs the deferred CLI-only
credential path (keyring-stored Clave → headless re-mint). The login logic lives
in `https://zeusr.sii.cl/AUT2000/js/AutAll.js` (observed same date).

- Page: `GET https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html`
  → HTTP `200`, `<title>Autenticación</title>`.
- Form: `id=myform`, `method=post`,
  `action=/cgi_AUT2000/CAutInicio.cgi`, `onsubmit="return ejecuta_opcion();"`.

### Fields

| element | id / name | type | role |
| --- | --- | --- | --- |
| visible RUT | `#rutcntr` | text, maxlength 12 | user types the **full** RUT, no dots/dash (placeholder `Ej: 123456789`) |
| visible Clave | `#clave` | password | the Clave Tributaria |
| hidden | `#rut` (name `rut`) | hidden | RUT **body**, filled by JS from `rutcntr` |
| hidden | `#dv` (name `dv`) | hidden | check digit, filled by JS from `rutcntr` |
| hidden | `#referencia` | hidden | post-login redirect target (default `http://www.sii.cl`; NOT a CSRF token) |
| hidden | `#code` (name `411`) | hidden | opaque constant shipped by the page |
| submit | `button#bt_ingresar` | button | text `Ingresar`; triggers the form submit |

### Submit mechanics (`AutAll.js`)

`ejecuta_opcion()` → `validaAut()` does three things, then `myform.submit()`:

1. `asignaReferencia()` — sets `#referencia`.
2. `validaRut(rutcntr.value, 'rutcntr')` → `validaDv(...)` — strips dots/dash,
   splits the typed RUT into `#rut` (body) + `#dv`, writes them back.
3. `validaCamposAut()` — re-validates and runs **Mod-11** (`validaM11`, identical
   algorithm to our in-house `rut` module) before allowing submit.

The POST to `CAutInicio.cgi` carries `{ rut, dv, referencia, clave, 411 }`.

### Implication for the implementation (recommended mechanism)

**Superseded by ADR-027 (see below): the hand-built HTTP POST is the mechanism now.**
The 2026-06-28 note read: "Headless form-fill, NOT a hand-built POST … reverse-engineering
the POST body is fragile". A live spike on 2026-10-17 disproved the fragility concern and
confirmed the hand-built POST works, so the default `credentialLogin` is now HTTP, no browser.

### HTTP credential login (ADR-027, observed 2026-10-17 — one attempt, owner's own account)

The default `PortalDriver` is browser-free: `HttpPortalDriver.credentialLogin`
(`adapters/node/http.ts`) does a warm-up `GET` of the login page, then **exactly one**
`POST` to `CAutInicio.cgi` of the five fields the page JS computes:

| field | value |
| --- | --- |
| `rut` | RUT body, leading zeros stripped |
| `dv` | check digit |
| `referencia` | the post-login destination (Mi SII) — a redirect target, NOT a CSRF token |
| `411` | empty (the opaque `#code`, sent blank) |
| `rutcntr` | the dotted RUT (`12.345.678-9`), as `formatoRut` renders it |
| `clave` | the Clave Tributaria |

Headers: `Content-Type: application/x-www-form-urlencoded`, `Origin`/`Referer` = the login
host/page. **No CAPTCHA, no CSRF token** on this classic form.

Observed on the spike:

- The warm-up `GET` sets the F5 WAF's `TS*` cookies; the `POST` is accepted with them present.
- **Success is NOT a redirect**: `200 text/html` on `zeusr.sii.cl` that sets the session via
  `Set-Cookie` (`TOKEN`, `CSESSIONID`, `NETSCAPE_LIVEWIRE.*`, `RUT_NS`/`DV_NS`) and the body
  JS-navigates to `referencia`. **A wrong Clave also answers `200` on the same host** and renders
  the error página (the código table above) — so credentialLogin decides from the body (SII's
  error código ⇒ `LoginFailedError`) plus the session cookie, NOT the host. The caller's Mi SII
  identity read is the final proof.
- The resulting jar reached Mi SII (`DatosCntrNow` as a JSON literal — parsed from the HTML, no
  JS engine) and a www4 SDI POST (`getDcvEmpresasAutorizadas` → `codRespuesta 0`).
- **Queue-it**: a `302` to `salaespera.sii.cl` (SII's peak-load waiting room) ⇒ `LoginQueuedError`,
  surfaced and never retried (an HTTP client cannot pass it).

The headed browser login (`interactiveLogin`) and `--www2` stay on the Playwright engine, now
MCP-only (ADR-027): the CLI never needs a human at a browser window.

### A dead session over HTTP (observed 2026-10-18, GH-139)

A classic session about an hour after its login, read with the HTTP driver (read-only GETs,
owner's own account):

| Request | Answer |
| --- | --- |
| `GET misiir.sii.cl/cgi_misii/siihome.cgi` (Mi SII) | **`200 text/html`, 344 bytes, NO HTTP redirect**: an XHTML shell whose only content is `location.replace('https://zeusr.sii.cl//AUT2000/InicioAutenticacion/IngresoRutClave.html?<origin URL>')`. No `DatosCntrNow`. |
| `GET loa.sii.cl/cgi_IMT/TMBCOC_InformeMensualBhe.cgi` | HTTP redirect to `zeusr.sii.cl` |
| `GET www1.sii.cl/cgi-bin/Portal001/mipeSelEmpresa.cgi` | HTTP redirect to `zeusr.sii.cl` |
| `GET www3.sii.cl/sispadinternet/` | HTTP redirect to `zeusr.sii.cl` |
| `GET www4.sii.cl/propuestaf29ui/`, `…/consdcvinternetui/` | HTTP redirect to `zeusr.sii.cl` |

A browser runs the script and lands on the login page. A client that does not run JS stays on
`misiir.sii.cl`, so the URL check read the dead session as LIVE. Two consequences, both fixed:
- Every credential login's live probe answered `already_authenticated` and never minted.
- `whoami` / `status --refresh` failed as `LoginFailedError` ("DatosCntrNow ausente").

How the driver handles it now:
- `fetchWithJar` recognises the page (`loginStubTarget` in `adapters/node/response.ts`) and
  reports the login URL as the landing, as a browser would. Every primitive then raises
  `SessionExpiredError` through the usual URL check.
- The match is narrow: a small 2xx HTML page whose markup holds NOTHING but one navigation,
  to `LOGIN_HOST`.
- The login probe also needs positive proof: a session is live only when Mi SII serves the
  principal's `DatosCntrNow`.

Live-validated 2026-10-19 on the empresa account:
- A session that expired on its own got the 344-byte page (`200`, no `Location`,
  `location.replace` to zeusr), and `sii whoami` (0.12.0) answered `session_expired`.
- A session closed server-side but still in the local jar made `sii auth login --clave-env`
  log in for real (`env_login`), not answer `already_authenticated`.

### Logout over HTTP (observed 2026-10-19, GH-135)

The HTTP driver does not run page JS, and under it `sii auth logout` always reported
`serverClosed: false`. A scrubbed probe on a live session (owner's empresa account) showed
why. The probe sent the classic close as a raw GET with the session cookies and
`redirect: 'manual'`.

| Step | Observed |
| --- | --- |
| `GET zeusr.sii.cl/cgi_AUT2000/autTermino.cgi` | **`200 text/html`, 159 bytes, NO `Location`.** The body only navigates by JS to `accounts.claveunica.gob.cl/api/v1/accounts/app/logout`. |
| Its `Set-Cookie` | Re-sends the session cookies (`CSESSIONID`, `TOKEN`, `NETSCAPE_LIVEWIRE.*`, `RUT_NS`/`DV_NS`, the F5 `TS*` pair, and the www2 `X-SII-STATE-*` pair) with **no clearing** (no `Max-Age=0`, no empty value). |
| The PRE-logout cookies, restored into a fresh session, then `GET` Mi SII | **Login wall** (`zeusr.sii.cl`). |

So SII **does** close the session. The old URL test ("we left `autTermino.cgi`") was a false
negative over HTTP, because the client never leaves that path.

The fix: after the close GET, `logout` restores the **original** cookies into a fresh session
and asks Mi SII.
- `serverClosed` is `true` only when that lands on the login wall: a redirect, or the JS-only
  page above.
- A probe on the same jar is not enough: a cleared jar would bounce even if the server still
  held the session.
- The audit receipt is `result: "ok"` only for a proven close, and `"local_only"` otherwise.
- Validated live: `sii auth logout` answered `serverClosed: true`, with an `ok` receipt.

### Client-side error rendering

Client validation errors render via `bootstrap_alert.warning(msg)` into
`#alert_placeholder` (observed empty on load). Observed client messages (RUT/DV
only — never the Clave): `Por favor, ingrese rut y clave.`, `Debe ingresar el
rut completo`, `El RUT ingresado no es valido`, `Dígito Verificador erróneo`,
`Debe ingresar la clave nueva`. Pass these through verbatim (CONVENTIONS).

### Server-side failure response (observed 2026-06-28, one controlled attempt)

A wrong Clave POSTs to `CAutInicio.cgi` and the response **stays on the login
host** — it does NOT leave `zeusr.sii.cl`:

- Landed URL: `https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi` (host `zeusr.sii.cl`).
- The error is rendered as **page body text** (NOT in `#alert_placeholder`, NOT a
  JS `alert()` dialog, NOT an `[class*=error]` node), followed by an `Aceptar`
  button. Observed message (wrong Clave):
  > La Clave Tributaria ingresada no es correcta, verifique que su teclado no está
  > con opción "mayúsculas" e inténtelo nuevamente.
  > El código de este mensaje es `01.01.203.500.720.20`

This is the **fast-fail signal**: after the submit navigation settles, if the host
is still `zeusr.sii.cl` the login was rejected. (Waiting only for the host to
*change* — the original bug — hangs until timeout, since a failure never leaves
the host.) The verbatim cause is the body line BEFORE `El código de este mensaje
es …`; `adapters/node/portal.ts#readLoginError` extracts and surfaces it
(CONVENTIONS), with a no-retry fallback if the shape changes.

**Account-lock safety (ADR-004):** each wrong-Clave submit counts toward SII's
lockout, so `credentialLogin` makes **exactly one** attempt and NEVER retries.
Still NOT observed (deliberately — triggering it risks a real lockout): the
**locked-account** page, distinct from this wrong-Clave page. Capture it
opportunistically only; until then both map to "stop, surface verbatim".

### código → `LoginFailedError.reason` (observed 2026-06-28; classified #124)

`LoginFailedError` carries the classification as DATA so a downstream consumer never
regex-parses the message: `reason` + `codigo` (the verbatim message is unchanged).
`parseSiiLoginErrorDetail` (`auth/login-error.ts`) sets it; `WRONG_CLAVE_CODIGO` is the
single códigos classified as `wrong-clave`.

| código | `reason` | meaning |
| --- | --- | --- |
| `01.01.203.500.720.20` | `wrong-clave` | the Clave Tributaria is incorrect (observed 2026-06-28) |
| any other código | `unknown` | `codigo` kept; NOT assumed to be a wrong Clave |
| (no código line / shape changed / timeout) | `unknown` | `codigo: null`; the generic no-retry fallback message |

The **locked-account** código is NOT yet observed (triggering it risks a real lock), so
it stays `unknown` until captured — the safe direction: a consumer treats `unknown` as
"blocked", never as "retry".

## The www2 app-session layer (the `www2` login, ADR-026; MCP-only since ADR-027)

Observed 2026-09-11/12 (#110). `www2.sii.cl/app/*` (the "nueva plataforma" apps and their
`/app/<name>-api/*` JSON facades — first the Carpeta Tributaria) do NOT ride the classic
`.sii.cl` cookies this login captures. They need a **www2 app session** minted by an OAuth2
code flow, and `sii auth login --www2` runs it as a SECOND cookies-only login in the same
headed browser, right after the classic one.

### Flow (`--www2`)

1. Classic login as above (headed) → `~/.sii/session.json` written, as always.
2. **Same browser** navigates to the app page `https://www2.sii.cl/carpetatributaria/generarcteregular`.
   An app-session-less browser bounces to `/bifurcacion/?originalUrl=…&type=CT` (the auth chooser)
   → `/app/session/login` → `https://www2.sii.cl/oauthsii-v1/?response_type=code&client_id=<uuid>&redirect_uri=https://www2.sii.cl/app/session/create&scope=user_info&state=CT<hex>`.
   That page is a full **Clave + reCAPTCHA Enterprise** login — the user types the Clave INTO SII's
   page (never our process; never headless — reCAPTCHA gates it, ADR-026 §1).
3. The task polls `GET /app/session/status?originalUrl=<app page>` (the SPA's own liveness read),
   paced by `Clock.sleep` (2 s), until it answers **200 JSON** or the 5-min budget runs out. Success
   shape (synthetic): `{"seconds":5999,"userId":"11111111-1","userProfiles":["00000"],"userAuthType":"CT","authTime":<ms>,"userRte":"11111111-1"}`.
   `userId` is the canonical RUT and keys every `cte-api` path.
4. **Persist BOTH layers.** The classic jar is snapshotted BEFORE step 2, because the OAuth page
   **deletes the classic cookies from the browser context on mount** (`deleteCookie("TOKEN")`,
   `"CSESSIONID"`, every `NETSCAPE_LIVEWIRE.*`). The stored jar = classic cookies (from the snapshot)
   ∪ www2 cookies (after step 3), merged by `name+domain+path` — every classic cookie kept, www2
   cookies added. `session.www2 = { savedAt, expiresAt }`, where `expiresAt` is the
   **`X-SII-STATE-*`** state cookie's own expiry (~100 min; suffix varies — see below).

### The app-session cookies (observed 2026-09-12)

httpOnly, on `.sii.cl` (so a cookies-only capture holds them; they SSO-carry like the classic ones):

| Cookie | secure | TTL | Role |
| --- | --- | --- | --- |
| `X-SII-STATE-TYPE` | (varies) | ~100 min | literal-named state marker |
| `X-SII-STATE-<X>` | yes | ~100 min | the app session — suffix VARIES: `-CT` (spike 2026-09-12) and `-CL` (first --www2 login, same day) both seen; not stable |

Both cookies share ONE expiry, so the layer's `expiresAt` is read from ANY `X-SII-STATE-*` cookie
(max expiry), never a fixed name — keying on a single suffix returned null on the `-CL` login.

After the OAuth login, Mi SII (`siihome.cgi`) stayed authenticated on these too (no `zeusr` bounce),
i.e. the legacy side ALSO accepts `X-SII-STATE-*` — whether every legacy/SDI surface does is the
open spike (#117). `--console` / `--keyring` never get a `--www2` variant (reCAPTCHA; ADR-026 §1).

### Status & logout

- `sii auth status` prints a www2 line from the STORED expiry (no live call); `--refresh` reads
  `/app/session/status` live and reports the layer authenticated/absent.
- `sii auth logout` best-effort closes the www2 session (`GET /app/session/close?originalUrl=…`,
  the SPA's own `$logout`), then the classic close, each in its own session restored from the
  pre-logout cookies, then wipes local state. See below for what the close does and does not do.
- Audit: `auth_login_www2` records rut + result only (no cookie value); `logout` adds `www2Closed`.

### Logout of the www2 layer over HTTP (observed 2026-10-19, GH-146)

A scrubbed probe on a fresh `www2` login (owner's persona account) sent the close through
`HttpPortalDriver` with a logging `fetch`, then probed with the PRE-close cookies restored into
fresh sessions. Cookie names only; no value was printed.

| Step | Observed |
| --- | --- |
| `GET www2.sii.cl/app/session/close?originalUrl=…` | **`307`**, `Location: accounts.claveunica.gob.cl/api/v1/accounts/app/logout?redirect=…`. |
| Its `Set-Cookie` | **Deletes** (empty value, `Max-Age=0`, 1970 `Expires`, `Domain=.sii.cl`) the www2 pair (`X-SII-STATE-TYPE`, `X-SII-STATE-CL`) **and the classic session cookies**: `TOKEN`, `CSESSIONID`, `NETSCAPE_LIVEWIRE.*`, `RUT_NS`/`DV_NS`, plus analytics. Re-sends the F5 `TS*` cookies. |
| The Clave Única hop | `204`, empty body, deletes its own `csrftoken`/`sessionid`. Nothing navigates further. |
| The same jar, then `GET /app/session/status` | `401` (the jar was cleared). |
| The PRE-close cookies in a fresh session, then `/app/session/status` | **`200` session JSON: still live.** |
| Then `autTermino.cgi` with the full PRE-close jar, and both probes again | Mi SII: **login wall** (classic closed). `/app/session/status`: **still `200`**. |

What this means:
- **SII does not revoke the www2 app session** (observed for a `userAuthType: "CT"`, Clave
  Tributaria, session). Neither its own close nor the classic one ends it server-side; the
  cookies stay valid until they expire (~100 min). The SPA's `$logout` only clears vuex and
  navigates to that URL (`chunk-vendors.659f67b1.js`, fetched 2026-10-19), so there is no
  other call to make. `barrasii.js` holds two closes: `urlRedirect`, the same relative
  `/app/session/close` with Clave Única's logout as `originalUrl`, and `cerrarSesion()`, which
  goes to `renta.w.sii.cl/app/session/close` instead. That host was not probed.
- **The old landing-URL test read a false "closed"**: the 307 leaves the close path while the
  session stays valid. `www2Closed` is now decided like `serverClosed` (#135): the PRE-close
  cookies in a fresh session must be refused by `/app/session/status`, after both closes.
  Today that answers `false`.
- **The www2 close empties the classic jar.** This is derived, not seen on the wire: the 307's
  deletions above are applied by the jar (the same jar then got a `401`), so on one shared
  session `autTermino.cgi` would go out without `TOKEN`/`CSESSIONID` and close nothing. That
  was `logout`'s order. Each close now runs in its own session restored from the PRE-close
  cookies.
- When the layer is not proven closed, the result carries `www2ValidUntil` (the stored
  expiry), and both surfaces say the www2 session stays valid at SII until then.
- Validated live (the stored session after the probes): `sii auth logout --json` answered
  `serverClosed: true, www2Closed: false, www2ValidUntil: <the layer's expiry>`, with an `ok`
  receipt. The classic session had already been closed by the probe's `autTermino.cgi`, so
  that `true` proves the state, not this run's close. The shared-jar fix is covered by fakes.
