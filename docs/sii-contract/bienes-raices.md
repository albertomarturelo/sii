# Wire contract — Bienes raíces (Mi SII « Bienes raíces » panel)

First-hand observation, no third-party library (ADR-004). Located 2026-10-28 (spike #236): a
headed browser to find the call, then browser-free probes over the HTTP driver with a
cookies-only session. The public consulta and vica were mapped 2026-10-29 (spike #251) from their
own client code, a guarded headed browser and a session-less Node probe. Decision: ADR-032 and its
amendment. Every value below is **synthetic**: roles, comunas,
addresses, names and amounts are taxpayer data and never land here.

Surface: `@albertomarturelo/sii-core` `portal/bienes-raices-misii.ts`, called by the
`bienesRaicesList` task (`sii bienes-raices list` / `bienes_raices_list`) and by the `alertas`
source `bienes_raices`, both under `withSession`.

## Transport — a Mi SII JSON CGI, form-POST

| | |
| --- | --- |
| endpoint | `POST https://misiir.sii.cl/cgi_misii/CViewCarta.cgi` (`HOSTS.miSiiCarta`) |
| request | `application/x-www-form-urlencoded`: `opc=34&VIEW=1&rnd=<Math.random()>` |
| response | `200 application/json` |
| seam | `PortalSession.requestForm` + `JSON.parse` (the CGI takes a form, not a JSON body) |
| browser | not needed: the HTTP driver reads it with the classic `.sii.cl` cookies |

Source of the call: Mi SII's own `callMessageBBRR()` in `https://misiir.sii.cl/misii/js/misii.min.js`
(read 2026-10-28), fired by the home's « Bienes raíces » accordion (`cargarBienesRaicesHomeUnaVez`).
`rnd` is a cache-buster; the same CGI serves the other home panels under other `opc` values.

## Auth — session-keyed (ADR-005)

The request carries no RUT: Mi SII answers for the session principal. The task takes no `--rut`
and refuses a representing pointer before contacting SII.

**A missing session does not bounce.** A POST without session cookies answers
`200 application/json` with (observed 2026-10-28):

```json
{"codigoResp":-2, "glosaRespuesta":"Error: Autenticacion"}
```

So `codigoResp: -2` is the login wall on this CGI and the facade raises `SessionExpiredError`
(kind `session_expired`). Reading it as "no predios" would hide a dead session.

## Response — success

The SDI service behind it is named in `metaData.namespace`:
`cl.sii.sdi.lob.bbrr.serviciosecontribuciones.data.impl.PropiedadesApplicationService/getPropiedades`.

```json
{
  "data": {
    "<RUT>-<rol>": {
      "descripcionComuna": "COMUNA SINTETICA",
      "comuna": 99001, "manzana": 123, "predio": 45,
      "comunaCNP": 99001, "manzanaCNP": 123, "predioCNP": 45,
      "direccion": "CALLE FALSA 123",
      "nombrePropietario": "PROPIETARIO SINTETICO",
      "destino": "HABITACIONAL",
      "propietario": true,
      "pac": false,
      "indExistencia": "S",
      "agnoVigDesde": 2020, "semestreVigDesde": 1,
      "indHistorial": 0, "indBcovid": 0,
      "cuotas": { "<key>": { "condicion": "VENCIDA", "fechaVencimiento": "…", "agno": 2026,
                             "semestre": 1, "cuota": 2, "totalPago": 45678 } },
      "rol": "123-45"
    }
  },
  "metaData": {
    "conversationId": "…", "transactionId": "…", "namespace": "…/getPropiedades",
    "info": null, "errors": null, "page": null, "sorts": null
  }
}
```

- `data` lists « las propiedades a las que Ud. paga las contribuciones habitualmente » (the
  panel's own text): the predios whose contribuciones the RUT pays, **owned or not**.
  `propietario` says whether the RUT is the registered owner. `data: null` or `{}` = no predios.
- The map key is `<RUT>-<rol>`: it carries the RUT, so the facade never exposes it.
- `rol` is `<manzana>-<predio>` as SII prints it; the facade composes it when absent.
- Not curated: `pac`, `indExistencia`, `indHistorial`, `indBcovid`, the `*CNP` triple,
  `agnoVigDesde` / `semestreVigDesde`. `nombrePropietario` is dropped as PII. The public consulta
  (below) returns the same row, and its client gives these flags a meaning: `indExistencia`
  `"N"` = no predio under that rol, `tieneCuotas` = unpaid cuotas exist, `indHistorial` `1` =
  payments made through SII's site exist (`buscaRolPagos.js`, read 2026-10-29).

### `cuotas` — the UNPAID cuotas

`cuotas` is an object; an empty one is a predio with nothing to pay. The fields of its entries
are the ones SII's own client reads (`getCuotas` and `formateaGrilla` in `misii.min.js`, read
2026-10-28):

| field | read by SII's client as | curated as |
| --- | --- | --- |
| `condicion` | `== "VENCIDA"` ⇒ « Pagos vencidos », else « Pagos vigentes » | `condicion` verbatim + `vencida` |
| `fechaVencimiento` | `dateOrderKey`: `YYYY-MM-DD…` or `D[-/]M[-/]YYYY` | `YYYY-MM-DD`, else `null` |
| `agno`, `cuota` | printed `<agno>-<cuota>` (« Año Nº Cuota ») | `anio`, `cuota` |
| `semestre` | carried, not printed | `semestre` |
| `totalPago` | printed untouched (« Total Pago $ ») | number, or an es-CL string parsed; else `null` |

Paid cuotas are not in the map. The panel's counts are SII's: vencidas = entries with
`condicion == "VENCIDA"`, vigentes = the rest. **Pending:** check the first real cuota against
this table (types, date format, the map key) before the row is ticked ✅ (ADR-032).

## Response — failure

`{ codigoResp, glosaRespuesta }` without `data`: `-2` is the missing session (above); any other
code is SII's error, surfaced with `glosaRespuesta` verbatim. A non-empty `metaData.errors` is
surfaced verbatim too. A body that is not JSON, or JSON without `data` / `metaData` /
`codigoResp`, is "scraper roto".

## Public consulta — the cuota breakdown (ADR-032 amendment, #251)

SII's « Pagar Contribuciones y obtener certificados… » app,
`https://www4.sii.cl/cuotaanualbienesraicespubinternetui/` (AngularJS), looks a predio up by its
rol with **no session**. Its own client marks these calls « Servicios no autenticados »
(`comun/service/servicios.js`, read 2026-10-29).

| | |
| --- | --- |
| endpoint | `POST https://www4.sii.cl/cuotaanualbienesraicespubinternetui/services/data/propiedadesService/buscarPropiedades` |
| request | `application/json`, the SDI envelope below; no cookie |
| response | `200 application/json`, the SDI envelope (`data` + `metaData`) |
| seam | `PortalDriver.requestPublic` (ADR-014): session-less, browser-free |
| observed | from Node `fetch`, no browser, no cookie: `200`, `metaData.errors: null` (2026-10-29) |

```json
{
  "metaData": {
    "namespace": "cl.sii.sdi.lob.bbrr.cuotaanualbienesraices.data.impl.PropiedadesApplicationService/buscarPropiedades",
    "conversationId": "NC8SBU1K04Z76",
    "transactionId": "<uuid v4>",
    "page": null
  },
  "data": { "codigoComuna": "99001", "manzana": "123", "predio": "45" }
}
```

`conversationId` is a constant written into SII's client (`createServiceOperation` in `js/utils.js`),
not a session token. The three `data` values are strings, as the client reads them off its form.
`codigoComuna` is a code from `facadeService/getComunas` (public, 347 rows observed).

**Response.** `data` is an array of the same predio row Mi SII returns (above); here it carries
`tieneCuotas` and `codigoTgr`. A rol that does not exist answers `data: []` (observed
2026-10-29); a predio without unpaid cuotas answers `tieneCuotas: 0` and `cuotas: {}` (observed).
The client's messages (`buscaRolPagos.js`): `indExistencia == "N"` ⇒ « No existe una propiedad
asociada a este Nro de Rol de Avalúo. »; `tieneCuotas == 0` ⇒ « Bien Raíz no registra cuotas de
contribuciones no pagadas. »

**Cuota fields.** SII's client copies, per unpaid cuota (`listarCuotas.js`, read 2026-10-29):

| field | meaning (from the client) |
| --- | --- |
| `agno`, `cuota`, `fechaVencimiento`, `condicion` | as in Mi SII (`VIGENTE` / `VENCIDA`) |
| `valor` | the cuota's amount within the plazo |
| `contribucionNeta`, `sobretasa`, `avaluo0025`, `sobretasa00275`, `aseo` | the parts of `valor` |
| `abonoTesoreria`, `condonacion` | credits applied |
| `reajustes`, `intereses` | added once the cuota is overdue |
| `origen` | carried, meaning not read |
| `totalPago` | what is due today (the client sums it for « pago anual ») |

Types and formats are **not observed yet**: no unpaid cuota has been seen in either source (#250).

**Not used.**

- `pagoService/getPagos` (same envelope and body) lists the payments made through SII's site
  for any rol: `numeroTransaccion`, `fechaPago` (`DD/MM/YYYY`), `totalPagado`, `propiedad[]`
  (`valorCuota`, `agnoCuota`, `numeroCuota`, `totalCuota`, `vigente`), and **`rutAutenticado` +
  `dvAutenticado`, the payer's RUT**, to anyone who knows the rol (observed 2026-10-29). PII:
  never curated.
- The payment operations (`getUrlPago`, `getValidarTransaccion`, `getNumTransaccionByTrxBco`,
  the PDF certificates) are never called: the project never pays (ADR-029).

## vica (`www2.sii.cl/vica`) — observed, not used (#251)

« Mis bienes raíces (información integrada) », a Vue SPA whose public bundle
(`/vica/assets/index-<hash>.js`, read 2026-10-29) names every call. All of them hang off
`/app/vica/<userId>/v1`, keyed by the `userId` of `/app/session/status`; axios GETs, and POSTs
with a JSON body.

| call | method · body |
| --- | --- |
| `mis-bbrr/obtener/cabecera` | GET · totals: `totalBienesRaices`, `solicitudesEnCurso`, `contribuciones`, `sobretasaModernizacion`, `beneficiosAdultoMayor`… |
| `mis-bbrr/obtener/por-rut` | GET · the predios SII's rol registers **to the RUT**; `204` = none (« No se encontraron propiedades asociadas al Rut ») |
| `mis-bbrr/obtener/detalle-bien-raiz`, `detalle-avaluo-bien-raiz`, `exenciones` | POST `{comunaCnp, manzanaCnp, predioCnp, ultimoEacAplicado}` (from a `por-rut` row) |
| `contribuciones/obtener/cuotas-contribuciones` | POST `{comuna, manzana, predio}` · `montoCuotaNeta`, `montoReajuste`, `montoInteresMultas`, `montoAseoMunicipal`, `montoAvaluoAfecto`, `montoAbono`, `montoCondonaciones`, two sobretasas, `agnoPeriodo`, `semestrePeriodo` |
| `periodo/get/rol` | GET · plain text, the current semester's label |

Observed live (2026-10-29): every response is Spring's `ResponseEntity` serialized
(`{headers, body, statusCode, statusCodeValue}`). The `por-rut` rows and the per-predio calls were
not observed. From a browser with no cookies the app sends the user
through the www2 OAuth login (`/app/session/login` → `oauthsii-v1` → `/app/session/create`,
ADR-026), which leaves only the `X-SII-STATE-*` pair. The way in from SII's menu passes a Queue-it
waiting room: its cookies were set (`QueueITAccepted-…_consultabbrr`, one on `salaespera.sii.cl`)
inside a redirect, with no page shown. Whether a direct call to `/app/vica/…` meets that queue is
untested. In the other direction,
`/app/session/legacy/bridge` (307) took that www2 session to Mi SII without a second login.
Whether the classic HTTP session opens vica is #241.
