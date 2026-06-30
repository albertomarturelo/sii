# SII wire contract — DTE autorizados (consulta pública de empresas autorizadas a emitir DTE)

> **Ground truth:** the authoritative source for any constant is the cited code in
> [`packages/core/src/portal/dte-public.ts`](../../packages/core/src/portal/dte-public.ts)
> (ADR-004 inline `// observed …` citations). This doc is the curated in-repo
> synthesis. All values below are **synthetic placeholders** — no real PII.

**Status:** wire contract **PORTED** from the proven Python `sii-cli`
(`src/sii/core/portal/dte.py`, observed 2026-06-13, prod), **not yet TS-live-revalidated**.
The endpoint/shape/marker are first-hand-observed there; re-observe from a TS run and
refresh the date when convenient (same posture as `rcv.md`).

This is the FIRST **public, login-free** SII surface (ADR-014): no session, no cookie, no
credential — see the ADR-004 ToS carve-out (a public registry consulta touches no account).

## Entry point & auth

- User path: **`https://palena.sii.cl/cvc/dte/ee_empresas_dte.html`** → public HTML form
  (no SII login). Sibling consultas off the same page: `ee_empresas_nomipyme.html`,
  `ee_empresas_mipyme.html`, `ee_empresas_fiscales.html` (not yet observed).
- Landing: server-rendered HTML, `charset=ISO-8859-1`, `Content-Language: es`.
- **Session: NONE.** No session, no cookie, no credential. The POST succeeds cold (no
  prior GET, no load-balancer cookie, no Referer/User-Agent — all confirmed optional
  2026-06-13). Reached via the **`PortalDriver.requestPublic`** seam (ADR-014), NOT a
  `PortalSession` / `withSession` — there is nothing to authenticate.

## Architecture

Plain HTML form POST to a CGI handler returning a server-rendered HTML report. No JS
facade, no SPA, no JSON. The page ships two `<form>`s + validation JS:

| Surface | Tech | Role |
| --- | --- | --- |
| `ee_empresas_dte.html` | static HTML form (`form2` visible + `form1` hidden) | input collection |
| `validadte.js` → `ee_revisa_ver_emp()` | client JS | validates Mod-11 DV, copies `form2`→`form1`, **rewrites `form1.action` to `/cvc_cgi/dte/ee_empresa_rut`** |
| `cvc_cgi/dte/ee_empresa_rut` | CGI | the actual handler; returns the HTML report |

The static `action="ee_empresa_rut"` (relative to `/cvc/dte/`) is a decoy — the JS
overrides it to the `/cvc_cgi/` path at submit time. POSTing the static path returns
`NO SE ENCONTRÓ LA PÁGINA`. **We skip the JS entirely and POST the CGI path directly**
(no JS/session to drive — `requestPublic`, not Playwright).

## Anti-bot / captcha posture

**None.** No `grecaptcha`, no token, no challenge. A cold POST with just `RUT_EMP`+`DV_EMP`
returns the full report.

## Endpoints

Base: `https://palena.sii.cl` (`HOSTS.dteWs`). Single endpoint, single read.

### `ee_empresa_rut` — consulta empresa autorizada a emitir DTE

`POST https://palena.sii.cl/cvc_cgi/dte/ee_empresa_rut`

Request (`application/x-www-form-urlencoded`):

```
RUT_EMP=<rut sin DV, hasta 8 dígitos>&DV_EMP=<dv, 1 char, K en mayúscula>
```

- `ACEPTAR=Consultar` (submit button name) is accepted but **not required**.
- No cookie / Referer / User-Agent required. `Rut` canonicalises + Mod-11-validates +
  splits BEFORE the call (`tasks/dte.ts`), so we never send an invalid pair.

Response — **authorized** (HTTP 200, `text/html; charset=ISO-8859-1`): a header block + a
`<table>` of authorized docs. Stripped of markup, the meaningful content is:

```text
Rut                       11111111-1
Razón Social/Nombres      <RAZON SOCIAL>
N° Resolución             <n>
Fecha Resolución          <DD-MM-YYYY>
Dirección Regional        <XV | RM | ...>

Código  Descripción                              Autorizado    Desautorizado
33      FACTURA ELECTRONICA                      <DD-MM-YYYY>   <DD-MM-YYYY | vacío>
34      FACTURA NO AFECTA O EXENTA ELECTRONICA   <DD-MM-YYYY>   ...
52      GUIA DESPACHO ELECTRONICA                <DD-MM-YYYY>   ...
56      NOTA DEBITO ELECTRONICA                  <DD-MM-YYYY>   ...
61      NOTA CREDITO ELECTRONICA                 <DD-MM-YYYY>   ...
```

Curated shape (`DteAutorizados`):

- `rut` (subject, canonical), `autorizado: boolean`, `razonSocial`, `nResolucion`,
  `fechaResolucion`, `direccionRegional`, `mensaje` (SII's verbatim "no autorizado"
  sentence; null on the authorized path).
- `documentos: DteAutorizado[]` with `codigo: number`, `descripcion: string|null`,
  `fechaAutorizacion: string|null`, `fechaDesautorizacion: string|null`. Dates keep SII's
  `DD-MM-YYYY` string verbatim (ADR-004); `fechaDesautorizacion` is null while the type is
  currently authorized (empty cell).
- **No `raw`** — the curated set IS the full set (the HTML carries exactly these fields;
  curated+raw is for JSON endpoints with 30+ mostly-null fields, not this table).

Parsing: an **in-house** tag stripper collects each `<tr>` as a list of `<td>` cell texts
(stdlib regex only — no third-party HTML library, ADR-004). A row whose first cell is all
digits is a docs row; otherwise the first cell is a header label, classified by substring
(order matters: "Fecha Resolución" before "N° Resolución"). The seam decodes the
ISO-8859-1 body before parsing; remaining named/numeric entities are normalised.

## Error envelope

No JSON envelope — outcomes are HTML, HTTP 200 either way:

| Condition | Signal |
| --- | --- |
| RUT not authorized / unknown | Body contains `no corresponde a una empresa autorizada` and **no docs table** → clean negative `autorizado:false` + SII's verbatim `mensaje`, `result="ok"` (a valid answer, not a failure). |
| Wrong path (`/cvc/dte/...`) | `NO SE ENCONTRÓ LA PÁGINA` — a coding bug; never hit (we POST the CGI path). |
| Non-200 / network / CGI failure | `DteError` — fail loud, never retry (ADR-004). |
| Body is neither a report nor the known message | `DteError` "scraper roto" — the page changed shape. |

## Field semantics

| Field | Format |
| --- | --- |
| `RUT_EMP` | RUT body, no DV, no dots, ≤8 digits |
| `DV_EMP` | check digit, 1 char, `K` uppercased |
| `Fecha Resolución` / `Autorizado` / `Desautorizado` | `DD-MM-YYYY` (dashes, day-first — RCV/F29 use other encodings) |
| `Código` | numeric DTE type code (`33` factura, `34` exenta, `52` guía despacho, `56` nota débito, `61` nota crédito, `110` factura exportación, …) — stays numeric (CONVENTIONS) |
| charset | ISO-8859-1 — the seam decodes per the declared charset; accents (`ó`, `é`, `°`) survive |

## Representación / `--rut`

N/A in the session sense — there is no authenticated session, so no representación and no
operating-vs-auth RUT distinction. The argument is simply the **subject** of the query
(any RUT, including a counterparty). The audit log records `rut=<subject>` with **no
`rutAuth`** (no authenticated principal). If a session happens to exist, the consulta still
does NOT use it.

## Read / write boundary

- **READ (this surface, #21):** `ee_empresa_rut` — public authorized-DTE consulta.
- **WRITE (out of scope — own ADR):** none here. DTE *emission* lives on the authenticated
  SOAP surface (cert auth), carries legal weight, and is unrelated to this public consulta.

## Open / TBD

- Sibling consultas (`nomipyme` / `mipyme` / `fiscales`) not yet observed — likely the same
  CGI shape with a different segment; capture if a future issue needs them.
- TS-live revalidation of the ported contract (endpoint, headers-optional, marker, charset)
  — refresh the observation date when done.
- Whether the CGI rate-limits public consultas — not observed to trip; a single read here.
