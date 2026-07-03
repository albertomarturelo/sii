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
5. **Logout.** `goto` `https://zeusr.sii.cl/cgi_AUT2000/autTermino.cgi`;
   server-side close is best-effort (redirect OFF that path ⇒ closed), then the
   local session + operate state are wiped. Observed: the `goto` redirected OFF
   `autTermino.cgi` (server close detected).

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
breadth here is why a future `profile` task should expose a curated typed shape
+ a `raw` carrying the full payload (CONVENTIONS: curated + raw for 30+ fields):

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
| `eMail` | string | | PII |
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

**Headless form-fill, NOT a hand-built POST.** Fill `#rutcntr` + `#clave`, click
`#bt_ingresar`, and let SII's own JS derive `rut`/`dv`/`referencia` and submit.
Reverse-engineering the POST body is fragile (the JS owns the rut/dv split and
the referencia/code fields) and buys nothing — there is **no CAPTCHA and no
CSRF token** to defeat (`referencia` is just a redirect target). This reuses the
existing Playwright `PortalDriver` seam (a `credentialLogin` sibling to
`interactiveLogin`).

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
