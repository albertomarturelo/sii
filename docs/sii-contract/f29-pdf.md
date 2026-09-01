# Wire contract — F29 PDF artifacts (`formCompacto` / `formSolemne`)

First-hand observation, no third-party library (ADR-004). All values below are
**synthetic / redacted** — folios, RUTs, `codInt` and montos are taxpayer data and MUST
NOT land here. Scope is **read-only**.

Observed live on **2026-08-31** (prod, empresa session, `form=029`) during the spike for
issue #80.

## Summary

A filed F29 exposes **two PDF artifacts**, both served by plain **authenticated `GET`
servlets** under `www4.sii.cl/rfiInternet/` — NOT by the `rfiInternet` GWT-RPC app whose
warm-up fragility gated F29 Fase 2 (ADR-013). Both are keyed by `folio` + an
authorization token SII calls `codInt`.

**The key finding: `codInt` is the `codigo` field the Fase-1 estado facade already
returns.** `getDeclaracionConEstados` serves `{folio, codigo, …}` per declaración, and
that `codigo` is exactly the `codInt` the PDF servlet demands (verified across two
distinct períodos). `portal/f29.ts` already parses it into
`DeclaracionEstadoF29.codigo`. **No GWT-RPC, no SPA warm-up, no new discovery call is
needed** — the existing Fase-1 read already carries everything the download requires.

## Endpoints

Base: `https://www4.sii.cl/rfiInternet/` (host from config `HOSTS.portalApi`).
Method: `GET`. Auth: the `.sii.cl` session cookie rides along. Response: `application/pdf`
(single page), rendered natively by the browser's PDF viewer.

| Artifact | Path | Query params |
| --- | --- | --- |
| **Formulario compacto** — the filed form as SII prints it | `formCompacto` | `folio`, `rut` (body, **no DV**), `form=029`, `codInt` |
| **Certificado solemne** — the formal certificate of declaración | `formSolemne` | `folio`, `rut` (body), **`dv`**, `form=029`, `codInt` |

Synthetic example:

```
GET https://www4.sii.cl/rfiInternet/formCompacto?folio=9999999999&rut=11111111&form=029&codInt=888888888
GET https://www4.sii.cl/rfiInternet/formSolemne?folio=9999999999&rut=11111111&dv=1&form=029&codInt=888888888
```

`formSolemne` takes `dv` and `formCompacto` does not — SII's own inconsistency, observed.
The **same `codInt` serves both artifacts** for a given folio.

### Where `codInt` comes from

`getDeclaracionConEstados` (already implemented, `fetchF29Estado`) returns per declaración
(synthetic):

```json
{"estadoDeclaracionId":1,"monto":0.0,"folio":9999999999,"estado":"Vigente",
 "declFechaCreacion":"01/07/2026 09:00:00","enNegocio":true,"codigo":888888888,
 "tingcodingreso":40}
```

`codigo` → `codInt`. The mapping is **per declaración**, not per session and not per
document: every folio of a período (including superseded / rejected ones) carries its own
`codigo`, so each is independently downloadable.

`tingcodingreso` is a newly observed field (values `18` / `40` seen); its meaning is not
established and it is not curated.

## Artifact contents

**`formCompacto`** — the printed F29: header block (folio `[07]`, RUT `[03]`, período
`[15]`), the identity band (razón social, dirección, comuna — **PII**), the código grid
with glosas and values, the totals ladder (91 / 92 / 93 / 795 / 94), SII's reception
stamp, and a payment band: *Tipo de Declaración · Corrige a Folio(s) · Banco · Medio de
Pago · Fecha de Presentación*.

**The stamp encodes payment state** (observed across two períodos):

| Stamp text | Meaning |
| --- | --- |
| `RECIBIDA POR INTERNET` | filed, nothing paid (código 91 = 0) |
| `RECIBIDA Y PAGADA POR INTERNET` | filed **and paid** — the payment band carries banco + medio de pago + fecha |

So for a **paid** F29 the `formCompacto` **is** the payment receipt: no separate Tesorería
(TGR) artifact is needed for proof of payment of the declaración itself.

**`formSolemne`** — "CERTIFICADO DECLARACIÓN DE FORMULARIO 29": a prose certificate
naming the contribuyente, RUT, período and presentation date, a short list of headline
códigos (504 / 77 / 91 / 537 / 562 observed), a signature block, the *Comprobante
Transacción Electrónica* stamp, and a red advisory paragraph about rectifying. It is dated
**at generation time**, so the same folio produces a byte-different PDF each day.

Both artifacts are **PII-dense** (razón social, dirección, comuna, full financial
position). They must never be parsed into the LLM's context or the audit log; the bytes
go to disk and only a path + metadata is surfaced (see the ADR gated on this spike).

## Quirks

- **`codInt` is mandatory.** Omitting it returns HTML, not a PDF, with SII's verbatim
  message — pass it through unchanged (ADR-004):
  `Ha ocurrido un Error al generar documento PDF` / `No está autorizado para realizar esta acción.`
- **The estado facade silently returns `data:[]` without a `conversationId`.** Sending the
  SDI envelope with an empty `conversationId` yields HTTP 200 and an EMPTY array — not an
  error — for períodos that demonstrably have declaraciones. The `TOKEN` cookie must be
  set as `conversationId` (which `postSdi` already does). A caller that skipped it would
  read a false "nada presentado".
- **`rfiInternet/?opcionPagina=formCompleto` is a different beast.** The "Ver Formulario
  Completo" link at the foot of the compacto PDF points at the **GWT app**
  (`?codigo=…&opcionPagina=formCompleto&form=29&folio=…` — note it names the param
  `codigo`, further confirming the identity) and **bounces a live session to the
  `zeusr.sii.cl` login wall** because it needs the SPA warm-up chain. That is the Fase-2
  fragility (ADR-013), and it does NOT affect the two servlets above, which were verified
  to keep working from the same session immediately afterwards.
- **"Verificar declaración por terceros" is a verifier, not a document.** The solemne PDF
  itself states the declaración can be checked there using the listed códigos; it produces
  no PDF and is out of scope.
- A período can hold **several folios** (e.g. one `Vigente` plus prior
  `Rechazada por pago inconcluso` ones); each has its own `codigo` and its own PDF.

## Verified: cold authenticated GET from Node

Confirmed live 2026-08-31 with a plain Node `fetch` carrying only the session's `.sii.cl`
cookies — **no browser involved in the download**. The Playwright session is used solely to
restore the cookie jar; the transfer itself is a cold HTTP GET (the ADR-020 posture).

| Probe | status | content-type | bytes | body |
| --- | --- | --- | --- | --- |
| `formCompacto`, valid `codInt` | 200 | `application/pdf` | ~34 KB | `%PDF-` |
| `formSolemne`, valid `codInt` | 200 | `application/pdf` | ~42 KB | `%PDF-` |
| `formCompacto`, wrong `codInt` | **200** | `text/html;charset=ISO-8859-1` | ~0.8 KB | SII error page |
| `formCompacto`, no cookies | **200** | `text/html` | ~17 KB | login wall, final host `zeusr.sii.cl` |

**Two traps that shape the implementation:**

1. **SII answers `200` on BOTH failure modes.** A wrong `codInt` and a dead cookie jar are
   `200`, not `4xx`/`3xx`. Success detection MUST be by `content-type: application/pdf` +
   the `%PDF-` magic bytes, **never by status code**.
2. **The login wall is a followed redirect.** With no (or a dead) cookie jar the request
   lands on `zeusr.sii.cl` with `200` and an HTML body. Detection is **URL-based** — the
   final URL's host is `LOGIN_HOST` → `SessionExpiredError` — consistent with
   `requestForm` / `requestText` (CONVENTIONS).

**`Content-Disposition` is generic** and carries no folio or período:

- `formCompacto` → `inline; filename=pdfFormularioCompactoV2.pdf`
- `formSolemne` → `inline; filename=pdfFormSolemne.pdf`

So SII's suggested filename is useless for archiving several months; the local filename must
be composed by us from período + folio + artifact type.

## Still not verified

- Only `form=029` was observed. `F3600` appears in the same Consulta Integral grid and may
  use the same servlets with a different `form`; untested.
