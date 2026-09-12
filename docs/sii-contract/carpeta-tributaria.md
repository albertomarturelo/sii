# Wire contract — Carpeta Tributaria (`www2.sii.cl` · `cte-api-carpetatributaria`)

First-hand observation, no third-party library (ADR-004). All values below are
**synthetic / redacted** — RUTs, emails and repository codes are taxpayer data and MUST NOT land
here. Scope so far is **read-only** (#110, the `instituciones` catalog); the Regular PDF flow
(#109) is recorded from the shipped bundle so its shape is reviewable, not because it is wired.

Observed live on **2026-09-11 / 2026-09-12** (prod, persona session minted by `sii auth login`;
then a headed spike in which the owner completed SII's OAuth login by hand) during #110,
from the public bundles (`/carpetatributaria/js/app.c2aeeb0d.js`, the shared session library
`/carpetatributaria/js/chunk-vendors.659f67b1.js`, `/bifurcacion/js/index.js`,
`/oauthsii-v1/js/app.f2621e19.js`, `/barrasii/js/barrasii.js`) and from cookies-only probes
through the `PortalSession` seam. A contributor first reported the flow on 2026-09-02 (fork
`golazoia/sii`); the finding below corrects their warm-up claim.

## The finding that gates everything: www2 has its OWN session layer

`www2.sii.cl/app/*` (the "nueva plataforma" apps and their `/app/<name>-api/*` JSON facades) is
**not** authorized by the classic `.sii.cl` `NETSCAPE_LIVEWIRE.*` / `TOKEN` / `CSESSIONID`
cookies that `sii auth login` captures and that SSO-carry to `www1` (MIPYME), `www3` (SISPAD),
`www4` (SDI) and `loa` (BHE). It is authorized by a **www2 app session** minted by an OAuth2
authorization-code flow:

```text
/app/session/login?originalUrl=<app URL>&type=CT
  → 302 https://www2.sii.cl/oauthsii-v1/?response_type=code&client_id=<uuid>
        &redirect_uri=https://www2.sii.cl/app/session/create&scope=user_info&state=CT<hex>
  → (SPA) GET /oauthsii-v1-ms/authorization/v1/validatePreLogin/?<same query>
        → 200 {"success":true,"institutionName":"…","reCaptchaEnabled":true,"reCaptchaSiteKey":"…"}
  → (user) POST /oauthsii-v1-ms/authorization/v1/authorize
        {response_type, client_id, redirect_uri, scope, state, user:<rut>, password:<clave>,
         token_captcha:<reCAPTCHA Enterprise "login" token>, action_captcha:"login"}
        → {action:"AUT", redirect_uri:<…/app/session/create?code=…>}   (or PEND / OBT / "641" = bot)
  → GET /app/session/create?code=…  → mints the app session (cookie-based: the SPA's fetch/axios
        calls carry NO Authorization header) → 302 originalUrl
```

What the cookies-only session gets instead, **verified 2026-09-11** on every path tried:

| Probe (classic cookies only) | Result |
| --- | --- |
| `GET /app/session/status?originalUrl=…` cold (no navigation) | `200 text/html` — the SPA shell, **not** a session JSON |
| `GET /app/session/status?…` after `goto` of the app page | **`401`**, empty body, no content-type |
| `GET …/cte-api-carpetatributaria/{rut}/…/instituciones` (any order, any RUT form) | **`401`**, empty body |
| `goto` the app page, wait 8 s | the SPA bounces to `/bifurcacion/?originalUrl=…&type=CT` (the auth chooser) |
| `goto /app/session/login?…&type=CT` | lands on `/oauthsii-v1/…` — a **full Clave login form** (RUT + Clave + reCAPTCHA Enterprise); no SSO, stays there |
| `goto /app/session/legacy/bridge2/?originalUrl=…` | 302 to `https://homer.sii.cl/` (the classic home) — no app session |
| `goto /app/session/legacy/bridge/?originalUrl=…` | 200, blank page — no app session |
| `goto` the zeusr login URL with the app page as destination | the classic login form (as always); untested past the form |

Two traps worth writing down:

- **The `oauthsii-v1` page deletes the classic session cookies on mount** (`mounted()`:
  `deleteCookie("TOKEN")`, `"CSESSIONID"`, every `NETSCAPE_LIVEWIRE.*`). Navigating a restored
  classic jar there inside a context you intend to keep would log that context out of Mi SII.
  `withSession` discards its context, so the stored `~/.sii/session.json` was never affected.
- **`…/obtenerValorParametro` is NOT the PDF** (#111): a live session gets `200 text/plain` with a
  bare URL — the SPA's `fe()` reads the "cambiar email/teléfono" widget URL from it.

### What the app session IS (headed spike, 2026-09-12)

A Chromium context restored from the cookies-only session was pointed at the app page; the SII
bounced it to `/bifurcacion` → `/oauthsii-v1/`, the owner typed the Clave there (reCAPTCHA passed
as a human), and `/app/session/create` landed back on the app. Observed afterwards:

- **The app session is a cookie pair on `.sii.cl`, httpOnly:** `X-SII-STATE-CT` (`secure`) and
  `X-SII-STATE-TYPE`, both expiring **~100 min** after `authTime` (`seconds: 5999` at read time).
  Domain-wide and cookie-based ⇒ a **cookies-only `storageState()` capture holds it** exactly like
  the classic jar — no token, no header. (Also set: a Queue-it pass for `ctributariaregular`, a
  `TS*` load-balancer cookie on `www2`, and Google's `_GRECAPTCHA`.)
- **The classic cookies were gone afterwards** — none of `NETSCAPE_LIVEWIRE.*` / `TOKEN` /
  `CSESSIONID` remained in the context (the OAuth page deletes them on mount) — **and Mi SII still
  authenticated** (`siihome.cgi` → 200, no `zeusr` bounce). So the legacy side accepts
  `X-SII-STATE-*` too; whether every legacy/SDI surface this tool uses (`DatosCntrNow`, www4 SDI,
  `loa` CGIs, MIPYME) does is the next thing to verify before an ADR relies on it.
- `/app/session/status` with or without `originalUrl` answers the same JSON.

**Consequence.** No cookies-only "warm-up" opens the `cte-api`. Reaching it means minting the www2
app session, which is a **login of its own** (Clave + reCAPTCHA, in SII's real page) and therefore
an auth-posture decision — ADR-006 territory, and a good fit: the user types into SII's page and
the cookies-only capture then holds `X-SII-STATE-*` too. That needs an ADR before any code
(CLAUDE.md). Until then the facade **detects** the missing layer via the session read below and
fails with an actionable message; the `instituciones` parse + `--institucion` validation are built
and unit-tested, and the wire shapes below are **live-observed** (via the spike, not via the task).

Open questions for that ADR: (a) whether the classic `zeusr` login, given a `www2` destination,
mints `X-SII-STATE-*` on the way (SII's own menus may route through it) — untested, it needs a real
login attempt, never done casually (account lock); (b) whether a session minted at `oauthsii-v1`
covers every legacy surface, i.e. whether ONE login could replace the classic one.

## Session read — `GET /app/session/status`

The SPA's own liveness/identity read (vendors `j()`), issued on every route change:

```
GET https://www2.sii.cl/app/session/status?originalUrl=https%3A%2F%2Fwww2.sii.cl%2Fcarpetatributaria%2Fgenerarcteregular
Accept: application/json, text/plain, */*
Referer: https://www2.sii.cl/carpetatributaria/generarcteregular
```

- `200` + JSON → the app session, committed to the vuex store as `session`. **Observed 2026-09-12**
  (synthetic values):

  ```json
  {"seconds":5999,"userId":"11111111-1","userProfiles":["00000"],"userAuthType":"CT",
   "authTime":1789000000000,"userRte":"11111111-1"}
  ```

  **`userId` is the canonical RUT `<body>-<dv>`** and keys every API path (below); `userAuthType`
  `"CT"` = Clave Tributaria (the chooser type); `seconds` = time left; `userRte` echoed the same RUT
  on a persona session (its meaning on a representación is unobserved). The facade requires only
  `userId` and takes it as-is.
- `401` → no app session (the SPA then calls `$login` → `/bifurcacion`). `451` → `/bifurcacion/no-rep.html`.
- Reached via **`requestText`** (a non-JSON body is expected; a dead classic jar is still caught
  URL-based by the `LOGIN_HOST` bounce).

## API base and the `{userId}` path key

```
https://www2.sii.cl/app/cte-api-carpetatributaria/{userId}/recurso/v2/carpeta-tributaria/…
```

`app.js` builds every URL as `${J}/${session.userId}/recurso/v2/carpeta-tributaria/…` with
`J = "/app/cte-api-carpetatributaria"` and `userId` read from `localStorage.vuex.session.userId`.
The facade therefore keys the path by the **`userId` from the session read, verbatim** — it never
formats a RUT for it. Observed: the canonical `<body>-<dv>` RUT (which is what the contributor
used).

Headers the SPA sends: `Accept: application/json, text/plain, */*`; the app page as `Referer`.
The axios instance blocks `TRACE`/`OPTIONS` client-side only.

## Endpoints

| Call | Path (after the base) | Notes |
| --- | --- | --- |
| **instituciones** (#110) | `GET …/instituciones` | bare JSON array; the live `enfinCodigo` catalog |
| filtros | `GET …/filtros` | `{instituciones:[], agnos:[], nombreCn}` observed (empty for a taxpayer with no Carpetas) — not wired |
| buscar | `GET …/buscar?agno=<YYYY>` or `?institucion=<enfinCodigo>` | the Carpetas already generated — not wired |
| **generar** (#109) | `POST …/generar` | see below |
| **pdfInicial** (#109) | `GET …/pdfInicial/{carpCodigoRepositorio}` | `{ "base64": "JVBERi…" }` |
| anular | `PUT …/anular` `{anularCarpetaTributariaDtoList:[…]}` | write — NOT in scope |
| mandatos | `…/recurso/v1/mandatos/{instituciones,generar,revocar}` | a different product — NOT in scope |

### `instituciones` — the live catalog (#110)

```
GET …/{userId}/recurso/v2/carpeta-tributaria/instituciones
```

Response **observed 2026-09-12** (`200 application/json`, **67 rows**): a **bare JSON array**, no
SDI `respEstado` envelope. Eight keys per row (synthetic values; the entities are public
registrants — bancos, corredoras, cooperativas — not taxpayer data):

```json
[
  { "enfinCodigo": "1005", "enfinDescripcion": "BANCO SINTÉTICO UNO S.A.", "enfinAbreviacion": "BSU",
    "enfinFechaVigDesde": "2024-09-05", "enfinFechaVigHasta": null, "enfinTipo": 4,
    "enfinRutInstitucion": 77777777, "enfinDvInstitucion": "7" },
  { "enfinCodigo": "016", "enfinDescripcion": "COOPERATIVA DE PRUEBA", "enfinAbreviacion": "CDP",
    "enfinFechaVigDesde": "2016-04-03", "enfinFechaVigHasta": null, "enfinTipo": 3,
    "enfinRutInstitucion": 76000000, "enfinDvInstitucion": "K" }
]
```

`enfinCodigo` is **not normalised**: 3-digit zero-padded (`"001"`, `"016"`, `"059"`) and 3–4 digit
unpadded (`"950"`, `"1005"`) codes coexist, so it is a string compared verbatim. `enfinFechaVigHasta`
was `null` on every row seen (all vigentes). The contributor's stale `1011` is indeed absent.

Curated projection (alias-tolerant, observed name first — ADR-004 / ADR-011):

| Curated | Wire aliases | Type |
| --- | --- | --- |
| `codigo` | `enfinCodigo`, `codigo` | string, verbatim |
| `descripcion` | `enfinDescripcion`, `descripcion` | string \| null |
| `abreviacion` | `enfinAbreviacion`, `abreviacion` | string \| null (blank → null) |
| `tipo` | `enfinTipo`, `tipo` | int \| null (3 and 4 seen; SII's class) |
| `rut` | `enfinRutInstitucion` + `enfinDvInstitucion` | canonical RUT \| null (Mod-11-checked) |
| `vigenteDesde` / `vigenteHasta` | `enfinFechaVigDesde` / `enfinFechaVigHasta` | `YYYY-MM-DD` \| null |

Rules: an empty array is a legitimate "no rows"; a non-array body, or a row without its
`enfinCodigo`, is "scraper roto" (loud). **No catalog is ever hardcoded** — a contributor's
hardcoded code (`1011`) had already gone stale and SII rejected it. `resolveInstitucion` validates
`--institucion` against this list before `/generar` and names the valid codes on a miss.

### `generar` + `pdfInicial` — the Regular PDF (#109, recorded, not wired)

From `app.js` (`_()` and `Z()`), synthetic values:

```
POST …/{userId}/recurso/v2/carpeta-tributaria/generar
Content-Type: application/json
{
  "carpMailReceptor": "receptor@example.com",
  "carpTipo": 1,
  "enfinCodigo": "042",
  "carpRutReceptor": "11111111",
  "carpDvReceptor": "1",
  "carpNombreOtraInstitucion": ""
}
→ { "carpCodigoRepositorio": 99999999, "carpClaveCarpeta": "XXXXXXXXXX" }

GET …/{userId}/recurso/v2/carpeta-tributaria/pdfInicial/99999999
→ { "base64": "JVBERi0x…" }        (~500 KB, 10–20 s reported; `JVBERi` = base64 "%PDF")
```

The Carpeta is the most PII-dense SII document: descriptor only, never bytes (ADR-022 / ADR-006).

## Auth mode

**Session-keyed** (ADR-005) — the app session IS the principal; the path's `{userId}` is that
principal's id, not a chosen body RUT. A representing operate pointer is rejected up front, like
F29. Whether a persona's app session can address a represented empresa's `{userId}` is
**unprobed** (blocked by the same session layer).

## Status

| Item | State |
| --- | --- |
| Session-layer finding (this page) | **Observed live 2026-09-11**; the cookie pair + legacy reach **2026-09-12** |
| `/app/session/status` 200 JSON body | **Observed 2026-09-12** (headed spike) |
| `/instituciones` shape | **Observed 2026-09-12** (67 rows) via the spike; the task itself still blocked on the session layer |
| `generar` / `pdfInicial` | bundle-derived, not wired (#109) |
