# Wire contract — RCV (Registro de Compras y Ventas)

Ported from the proven Python `sii-cli` (`portal/rcv.py`) — first-hand
observation, no third-party library (ADR-004). Endpoints/payloads cited from cURL
captured **2026-06-07** (issue #7 spike report; resumen) + Angular bundle
inspection **2026-06-07** (`app.full.min.js?2026428195.js`; detalle). Response
field names: resumen observed in the issue #9 smoke (**2026-06-07**, empresa VENTA
2026-05); detalle in the issue #12 capture (**2026-06-07**, empresa COMPRA 2026-06).
All values below are **synthetic / redacted** — folios, RUTs, razón social and
montos are PII/taxpayer data and MUST NOT land here. **Live-validated from the
TypeScript port 2026-06-28** (persona-natural session, read-only): `getResumen`
COMPRA returned curated rows with the alias keys below matching real data, and
`getDetalle` parsed folios / canonical emisor RUT / ISO dates. See "Live findings".

Surface: `@albertomarturelo/sii-core` `portal/rcv.ts` (`fetchRcvResumen`, `fetchRcvDetalle`), called
by the `rcvSummary` / `rcvList` tasks under `withSession`. Uses the
`PortalSession.requestJson` seam (authenticated JSON POST). The RCV portal is the
Angular SPA at `https://www4.sii.cl/consdcvinternetui/`.

**Body-RUT (ADR-005).** The request body's `rutEmisor`/`dvEmisor` selects which RUT
to query; a session can address any RUT it legally represents. `operate`/`--rut`
feeds this — RCV reaches a represented empresa under the persona's own session.

## Endpoints

| op | endpoint (`POST`, under `…/consdcvinternetui/services/data/facadeService/`) | namespace suffix |
| --- | --- | --- |
| resumen | `getResumen` | `…FacadeService/getResumen` |
| detalle compra | `getDetalleCompra` | `…FacadeService/getDetalleCompra` |
| detalle venta | `getDetalleVenta` | `…FacadeService/getDetalleVenta` |

Namespace prefix: `cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.`. GET → 405.

### Headers (same as the sibling representación facade)

`Content-Type: application/json`, `Origin: https://www4.sii.cl`,
`Referer: https://www4.sii.cl/consdcvinternetui/`, `Accept: application/json, text/plain, */*`.

### Request body — resumen

```json
{
  "metaData": {
    "namespace": "…/getResumen",
    "conversationId": "<TOKEN cookie on www4.sii.cl, empty accepted>",
    "transactionId": "<fresh uuid v4>",
    "page": null
  },
  "data": {
    "rutEmisor": "<operating RUT digits>",
    "dvEmisor": "<operating RUT DV>",
    "ptributario": "<YYYYMM>",
    "estadoContab": "REGISTRO",
    "operacion": "COMPRA | VENTA",
    "busquedaInicial": true
  }
}
```

### Request body — detalle

Same as resumen plus three fields in `data`: `codTipoDoc` (the DTE type from a prior
resumen), `accionRecaptcha` (`RCV_DETC` compra / `RCV_DETV` venta), `tokenRecaptcha`.

**reCAPTCHA (observation, not spec).** The SPA's `recaptchaService.pedirToken`
(bundle 2026-06-07) is a **no-op** returning the literal sentinel `"t-o-k-e-n-web"`;
the bundle never loads Google's reCAPTCHA SDK and SII's backend accepts the sentinel.
Smoke-test before relying on this — SII may tighten the contract.

## Response

Rows under `data[]` (fallbacks `datos`). Envelope validated with **zod** (ADR-011);
per-row curated projection is **alias-tolerant** (observed name first) + `raw`
carries the full row (ADR-004 curated+raw).

### Resumen row — `rsmn*` (counts/amounts) + `dcv*` (type metadata) prefixes

| logical field | observed key (aliases) |
| --- | --- |
| código tipo doc | `rsmnTipoDocInteger` (`codTipoDoc`, `codigoTipoDoc`, `tipoDoc`) |
| descripción | `dcvNombreTipoDoc` (`descTipoDoc`, `glosaTipoDoc`) |
| total documentos | `rsmnTotDoc` (`totDoctos`, `totalDoctos`) |
| monto exento | `rsmnMntExe` (`mntExento`) |
| monto neto | `rsmnMntNeto` (`mntNeto`) |
| monto IVA | `rsmnMntIVA` (`mntIVA`, `montoIVA`) |
| monto total | `rsmnMntTotal` (`mntTotal`) |

Envelope-level `totDocRes` (int) = total document count; no aggregate monto totals at
envelope level (the UI sums rows client-side).

### Detalle row — `det*` prefix

| logical field | observed key (aliases) | notes |
| --- | --- | --- |
| folio | `detNroDoc` (`nroDoc`) | |
| RUT emisor body / DV | `detRutDoc` / `detDvDoc` | canonicalised to `<body>-<DV>` |
| razón social | `detRznSoc` (`rznSoc`) | PII |
| fecha emisión | `detFchDoc` | `DD/MM/YYYY` → ISO `YYYY-MM-DD` |
| fecha recepción | `detFecRecepcion` | `DD/MM/YYYY HH:MM:SS` → ISO |
| montos exento/neto/IVA/total | `detMntExe` / `detMntNeto` / `detMntIVA` / `detMntTotal` | |
| evento receptor (+ leyenda) | `detEventoReceptor` / `detEventoReceptorLeyenda` | |

Tax-special fields (activo fijo, IVA uso común, Ley 18211, tabaco, vehículos, …) are
NOT curated — they remain in `raw`.

### Error envelope + status codes (observed live 2026-06-28)

Shared SDI envelope under `respEstado`. Codes observed:

| `codRespuesta` | meaning | handling |
| --- | --- | --- |
| `0` | OK | parse `data[]` rows |
| `3` | **consulta válida SIN MOVIMIENTOS** for that (RUT, período, lado) — `data` empty, `msgeRespuesta` null | **empty result, NOT an error** |
| other ≠ 0 | real rejection | message (`msgeRespuesta`, fallback `codError`) surfaced **verbatim** (`RcvError`, ADR-004); never retried |

Confirmed live: a persona's self VENTA and a represented empresa's COMPRA both returned
**code 3** (no rows); treating it as an error (the original bug) surfaced a misleading
"SII rechazó…". Empty `data[]` under code 0 is likewise a legitimate "no documents".

## Curated shapes

- `RcvResumen { rut, periodo, side, rows: RcvResumenRow[], totalDocumentos }`.
- `RcvDetalle { rut, periodo, side, codigoTipoDoc, docs: RcvDetalleDoc[] }`, each doc
  curated (~11 fields) + `raw`.

## Live findings (2026-06-28, persona-natural session, read-only)

- **Resumen + detalle field aliases CONFIRMED** against real COMPRA data: curated
  rows populated (`rsmnTipoDocInteger`, `dcvNombreTipoDoc`, `rsmnTotDoc`, `rsmnMntTotal`,
  envelope `totDocRes`; detalle `detNroDoc`, `detRutDoc`/`detDvDoc`, `detFchDoc`,
  `detMntTotal`). No new aliases needed.
- **`codRespuesta` 0 / 3** semantics (table above) — code 3 = sin movimientos.
- **RCV is BODY-RUT — `--rut`/operate reaches a represented empresa (ADR-005).**
  Under the persona's own session, `getResumen` for the represented empresa
  (`rutEmisor`/`dvEmisor` = the empresa) returned **code 0 + a VENTA row** — i.e. the
  operating-RUT override DOES reach the empresa's RCV. This confirms the ADR-005
  body-RUT assumption for RCV (partial answer to the operate-reach spike #15; the
  session-keyed surfaces F29/F22/BHE are still open).
- Extra envelope keys seen (kept in `raw` / ignored): `tieneEmisorAgresivo`, `pDB`,
  `verF29`, `dataCabecera`, `metaData`.

## TODO — remaining

Observe the full `respEstado` code map (auth/expired, rate-limit, bad-params) and the
detalle response for a represented empresa; capture VENTA resumen field names against
non-empty data (only COMPRA had volume in the validated session).
