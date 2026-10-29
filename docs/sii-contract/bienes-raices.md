# Wire contract — Bienes raíces (Mi SII « Bienes raíces » panel)

First-hand observation, no third-party library (ADR-004). Located 2026-10-28 (spike #236): a
headed browser to find the call, then browser-free probes over the HTTP driver with a
cookies-only session. Decision: ADR-032. Every value below is **synthetic**: roles, comunas,
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
- Not curated (meaning not observed): `pac`, `indExistencia`, `indHistorial`, `indBcovid`, the
  `*CNP` triple, `agnoVigDesde` / `semestreVigDesde`. `nombrePropietario` is dropped as PII.

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

## Related, not used (ADR-032 alternatives)

`https://www2.sii.cl/vica/` (« Mis bienes raíces », from `sii.cl/servicios_online/1048-4544.html`)
serves `/app/vica/<userId>/v1/…`: `mis-bbrr/obtener/cabecera` (GET), `mis-bbrr/obtener/por-rut`
(GET, the predios **registered** to the RUT), and JSON POSTs taking
`{comuna, manzana, predio}` such as `contribuciones/obtener/cuotas-contribuciones` (the semester's
amounts: `montoCuotaNeta`, `montoAvaluoAfecto`, `montoAseoMunicipal`, `montoTotal`,
`montoReajuste`, `montoInteresMultas`…, with `fechaVencimiento` / `fechaPago` null). Avalúo,
exenciones and the ficha (`detalle-avaluo-bien-raiz`, `exenciones`) need more parameters from a
`por-rut` row. That app sits on the www2 layer, reached with the classic session since #241.
