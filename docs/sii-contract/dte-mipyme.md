# Wire contract — Factura electrónica (Portal MIPYME)

The SII's **free** facturación electrónica portal ("Sistema de facturación gratuito del SII",
`www.sii.cl/servicios_online/1039-1183.html`). All CGIs live under
`https://www1.sii.cl/cgi-bin/Portal001/`; the borradores listing is served by the MIPYME SPA on
`www4.sii.cl`. The `.sii.cl` Clave-Tributaria session cookie SSO-carries to both.

**Observed first-hand 2026-09-08** (own session, DTE 33, a real borrador created → listed →
previewed → deleted). No third-party source (ADR-004).

> **Scope: borradores only (ADR-023).** The emission path is documented here so the boundary is
> unambiguous, but `mipeGenXMLFirma.cgi` is NEVER called by this codebase.

## Authorization model — empresa-keyed

Not body-RUT (RCV) and not session-keyed (F22/F29/BHE). The portal has its **own** authorization
list: the empresas that registered the authenticated user as *usuario autorizado*. The working
empresa is whatever RUT was last POSTed to `mipeSelEmpresa.cgi`, and it scopes the form, the
borrador CRUD **and** the borradores listing. Every operation therefore selects the empresa first.

## 1. Empresa chooser — THREE observed shapes

```
GET  /cgi-bin/Portal001/mipeSelEmpresa.cgi?DESDE_DONDE_URL=OPCION%3D33%26TIPO%3D4
POST /cgi-bin/Portal001/mipeSelEmpresa.cgi   { DESDE_DONDE_URL: "OPCION=33&TIPO=4", RUT_EMP: "76192083-9" }
```

`Content-Type: text/html; charset=ISO-8859-1`. What the GET answers depends on **how many
empresas list the account as *usuario autorizado***:

### (a) Two or more — the chooser (observed 2026-09-08)

The options are **unclosed** and repeat the RUT in the label:

```html
<select class="form-control" name="RUT_EMP">
  <optgroup label="Seleccione una opción">
    <option value="77111222-6">TALLER DEL SUR LTDA 77111222-6
    <option value="76192083-9">ACME REPUESTOS SPA 76192083-9
  </optgroup>
</select>
```

The POST forwards to the factura form. Getting the chooser **back** means SII refused the empresa.

### (b) None — an empty chooser (observed 2026-09-09)

The same `<select>` with an empty `<optgroup>` and zero `<option>` (163 bytes). Seen on an
**empresa** account: the portal is normally operated by the representing **persona**, which is the
account SII registers as usuario autorizado — the empresa account itself usually is not. This is
the only shape that means "not authorized".

### (c) Exactly one — a launcher, NO chooser (observed 2026-09-09, #95)

HTTP 200, 593 bytes, no form and no select — a JS shim that jumps straight to the destination.
The session is **already scoped** to that empresa; nothing is POSTed (a POST has no chooser to
accept it).

```html
<title>Facturacion Electronica - Launcher</title>
<script language=JavaScript>
function start_pop() {
  var     nwp;
  window.location = "/Portal001/menuFacturaElectronica.html";
  FacturaOpenEnlace("/cgi-bin/Portal001/mipeGenFacEx.cgi?PTDC_CODIGO=33");
  return true;
}
</script>
<body onLoad="javascript:start_pop();">
```

`mipeLaunchPage.cgi?OPCION=33&TIPO=4` answers the identical shim; `OPCION=2&TIPO=4` the same
shape pointing at `mipeAdminDocsEmi.cgi?…&NUM_PAG=1`. Both wired DTE types were checked:
`DESDE_DONDE_URL=OPCION=33` and `OPCION=34` return byte-identical shims apart from the
`PTDC_CODIGO` they launch (observed 2026-09-09).

The RUT read off the header box is **Mod-11 checked** before it is used: it becomes the value
`--empresa` is validated against, so a garbled scrape must fail as "scraper roto" rather than
silently reject a legitimate empresa.

**Where the empresa's identity comes from on (c).** The chooser never names it, so it is read
off the factura form itself (`mipeGenFacEx.cgi?PTDC_CODIGO=33`, `goto` + `evaluate`):

- **RUT** — the DTE header box, the recuadro every documento tributario carries top-right:
  `<div class="well well-sm"><strong>Rut 76192083-9</strong> FACTURA ELECTRÓNICA N° folio no
  asignado</div>`. That box shows the **emisor** by construction of the document.
- **Razón social** — `EFXP_RZN_SOC`, JS-populated like the rest of the emisor block (wait for it).

**Not** the navbar's `Rut:` (`ul#conAutenticacion`, drawn by `imprimeRutEncabezado()`), not the
page global `cook_rut`, and not the `NETSCAPE_LIVEWIRE.rut`/`.dv` or `RUT_NS`/`DV_NS` cookies —
all of those are the **logged-in principal**, which on a persona account is a different RUT from
the empresa it invoices for (verified 2026-09-09 by comparison against the session RUT). A
`--empresa` that does not match the scoped one is refused exactly as on (a).

`DESDE_DONDE_URL` is an unkeyed `OPCION=<tipo DTE>&TIPO=4` pair; `OPCION` is the DTE code
(33 factura, 34 exenta, 46 factura de compra, 43 liquidación, 110 exportación).

## 2. The factura form — `mipeGenFacEx.cgi`

```
GET /cgi-bin/Portal001/mipeGenFacEx.cgi?PTDC_CODIGO=33                       # blank
GET /cgi-bin/Portal001/mipeGenFacEx.cgi?PTDC_CODIGO=33&ES_BORR=TRUE&VALOR=<id>
      &IGUAL=CODIGO&RUT=<body>&DV=<dv>&TPO_DOC_GEN=33                        # an existing borrador
```

**The static HTML carries EMPTY values.** The emisor context (`EFXP_CDG_SII_SUCUR`,
`EFXP_DIR_ORIGEN`, `EFXP_GIRO_EMIS`, `EFXP_ACTECO`, `EFXP_EMAIL_EMISOR`) and the whole detail
grid are populated **client-side** by the page's JS (`datosArray`, `dibujaDetalles`). A cold
`requestForm` GET therefore reads blanks — the form must be driven through
`PortalSession.goto` + `evaluate`, like the BTE inline-JS-map facade (CONVENTIONS).

Form name: `VIEW_EFXP`. Its default action is `mipeDisplayPreView.cgi`.

### Fields that matter

| Field | Notes |
| --- | --- |
| `PTDC_CODIGO` | DTE type (33). |
| `CANT_DET` | Number of detail rows. Grow it with `modCantLineaDet(btn)`; ceiling `cantTotCol = 10`. |
| `ES_BORR` | `FALSE` on the emisión path, `TRUE` for borrador operations. |
| `EHDR_CODIGO` | Borrador id — empty = create, set = update. |
| `EFXP_CDG_SII_SUCUR` | Sucursal, JS-populated. |
| `EFXP_FCH_EMIS` | `YYYY-MM-DD` (`<input type=date>`). |
| `EFXP_CIUDAD_ORIGEN` | **Emisor ciudad. SII leaves it BLANK but its own validator demands it** — the caller must supply it. It also does NOT survive the *Corregir* round trip. |
| `EFXP_RUT_RECEP` / `EFXP_DV_RECEP` | Receptor RUT, split. |
| `EFXP_RZN_SOC_RECEP`, `EFXP_DIR_RECEP`, `EFXP_CMNA_RECEP`, `EFXP_CIUDAD_RECEP`, `EFXP_GIRO_RECEP`, `EFXP_CONTACTO` | Receptor block. Comuna/ciudad are FREE TEXT — no código lookup (unlike BHE). |
| `EFXP_NMB_nn` | Item name (`nn` = `01`…`10`). |
| `DESCRIP_nn` | Checkbox whose `onclick` **draws** the `EFXP_DSC_ITEM_nn` textarea. The textarea does not exist until it is clicked. |
| `EFXP_QTY_nn`, `EFXP_UNMD_nn`, `EFXP_PRC_nn`, `EFXP_PCTD_nn` | Cantidad, unidad, precio unitario, % descuento. |
| `EFXP_SUBT_nn` | Line subtotal — computed by the page's JS on `change`. |
| `EFXP_FMA_PAGO` | `1` contado, `2` crédito, `3` sin costo. |
| `EFXP_MNT_NETO`, `EFXP_TASA_IVA` (19), `EFXP_IVA`, `EFXP_MNT_TOTAL` | Totals, JS-computed (`IVA = round(neto × 0.19)`). |

### Two observed hazards

1. **Receptor autofill.** Firing a `change`/`blur` on `EFXP_RUT_RECEP` makes the portal re-POST
   the form to look the RUT up in SII's registry — it comes back with `EFXP_RZN_SOC_RECEP`,
   `EFXP_DIR_RECEP`, `EFXP_CMNA_RECEP`, `EFXP_CIUDAD_RECEP` and `EFXP_GIRO_RECEP` filled from the
   registry, but the **page reloads and the detail grid is wiped**. Assign the receptor fields
   *without* dispatching events.
2. **Client-side validation is authoritative.** `validaFacEx(btn)` (in
   `Portal001/JS/validaFacEx.js`) `alert()`s the exact refusals SII would otherwise bounce
   ("Debe ingresar Ciudad del contribuyente emisor", "Debe ingresar el campo : Giro del
   contribuyente receptor"). Run it in-page and surface its message verbatim — posting an
   invalid document instead just gets redirected back to the form with the same alert.

## 3. Borrador CRUD

Both take the **whole `VIEW_EFXP` body** with `ES_BORR=TRUE`, and answer `200` with an HTML
confirmation page (so success is decided by the TEXT, not the status):

```
POST /cgi-bin/Portal001/mipeGrabaBorrador.cgi     → "Su documento borrador ha sido grabado/actualizado con éxito"
POST /cgi-bin/Portal001/mipeEliminaBorrador.cgi   → "... ha sido eliminado ..."
```

Create vs update is decided by `EHDR_CODIGO`. **`mipeGrabaBorrador.cgi` does not return the new
id** — re-read the listing and diff.

Observed in the page (`Button_Update_Borrador` / `Button_Delete_Borrador` onclick):

```js
VIEW_EFXP.action='/cgi-bin/Portal001/mipeGrabaBorrador.cgi';   document.getElementById('ES_BORR').value='TRUE';
VIEW_EFXP.action='/cgi-bin/Portal001/mipeEliminaBorrador.cgi'; document.getElementById('ES_BORR').value='TRUE';
```

## 4. Borradores listing (SPA JSON)

```
GET https://www4.sii.cl/mipymeinternetui/services/data/borradorService/listaBorrador
```

`application/json;charset=ISO-8859-1`. A **bare JSON array** — *not* the SDI `respEstado`
envelope, so no zod envelope parse applies. Each row carries ~250 form columns, almost all
`null`; only these are populated for a listing:

| Key | Meaning |
| --- | --- |
| `ehdr_CODIGO` | Borrador id |
| `ptdc_CODIGO` / `ptdc_CODIGO_DESC` | `"33"` / `"Factura Electronica"` |
| `efxp_FCH_EMIS` | `"2026-09-08 15:49:20"` |
| `efxp_RUT_RECEP` / `efxp_DV_RECEP` | Receptor RUT |
| `efxp_RZN_SOC_RECEP` | Receptor razón social |
| `efxp_RZN_SOC` | Emisor razón social |
| `efxp_IVA`, `efxp_MNT_TOTAL` | Montos, as digit strings |

Scoped to the empresa selected in step 1. Max 100 borradores (stated on the page).

**The text is DOUBLE-ENCODED.** The response declares `charset=ISO-8859-1` but carries UTF-8
bytes of an already-mojibaked string: `Á` arrives as `C3 83 C2 81`, i.e. the UTF-8 encoding of
(`Ã`, U+0081). A *correct* UTF-8 decode therefore still yields `CorporaciÃ³n` / `VicuÃ±a`
(observed 2026-09-08). Undo the extra layer by re-encoding the decoded string as Latin-1 and
decoding it as UTF-8 again — guarded, so legitimately-accented text is left alone. This affects
DISPLAY only; nothing sent to SII changes.

Related endpoints on the same service: `rutEmpresa` (current empresa), `getProperty/<key>`.

## 5. Preview PDF — "Validar y visualizar"

Two hops. `Button_Update` ("Validar y visualizar") posts `VIEW_EFXP` to:

```
POST /cgi-bin/Portal001/mipeDisplayPreView.cgi     → text/html, the review page
```

The review page ("REVISIÓN DE DOCUMENTO TRIBUTARIO ELECTRÓNICO") carries the document as ~245
**hidden inputs** in a form named `PreViewDTE`, plus an iframe `framePdf`
(`/Portal001/PreViewFrame.html`) which posts that same body to:

```
POST /cgi-bin/Portal001/mipePreView.cgi            → application/pdf
                                                     content-disposition: inline; filename=<rut>-<n>.pdf
```

That is the real PDF, stamped **"VISTA PREVIA · DOCUMENTO NO VALIDO"** with *"FOLIO NO ASIGNADO"*.
The hidden inputs are uniform and double-quoted:

```html
<input type="hidden" name="EFXP_RZN_SOC" value="ACME SPA" maxlength="110" size="50">
```

Success is decided by `content-type` + the `%PDF` magic, never by HTTP status (ADR-022).

## 5b. Body encoding — windows-1252, not UTF-8

**Every `Portal001` page declares `charset=ISO-8859-1`**, and the HTML spec requires a browser to
treat a document so labelled as **windows-1252**. Form bodies must therefore be percent-encoded
in that charset, not UTF-8.

Getting this wrong is silent and destructive: `URLSearchParams` encodes UTF-8, so `Diseño` goes
out as `Dise%C3%B1o`, SII stores the mojibake, and it is then **printed on the document** as
`DiseÃ±o` (observed 2026-09-08 — both in the saved borrador and in the preview PDF).

Two details the Latin-1 range alone does not cover:

- SII's own `<select>` option text contains characters from the **0x80–0x9F block** (e.g. U+2018
  inside `ENSEÃ‘ANZA`). Encoding those as strict ISO-8859-1 turns them into `&#8216;` in the
  rendered document; windows-1252 maps them back to single bytes, round-tripping SII's value
  byte-faithfully.
- Anything outside windows-1252 entirely is sent as an HTML numeric reference (`&#<n>;`), which
  is what a browser does for an unrepresentable character.

Some values SII serves are **already mojibaked in its own database** (a giro stored as
`ENSEÃ‘ANZA`). Those are round-tripped unchanged — repairing them would alter data sent to SII.
The listing endpoint is a separate case: see § 4's note on double-encoding.

## 5c. The preview PDF is posted by the iframe's OWN form

`mipeDisplayPreView.cgi` returns the review page, whose `PreViewDTE` form holds ~245 hidden
inputs. **That is not the body the PDF CGI receives.** `PreViewFrame.html` owns a form of its
own — `name="VIEW"`, **239 inputs** — and its `Enviar()` copies **238** values across from
`PreViewDTE` before submitting (observed 2026-09-08):

```js
function Enviar() {
   var f_frame  = document.forms["VIEW"];
   var f_pagina = window.top.document.forms["PreViewDTE"];
   f_frame.elements["INDICA_PRIMERA_EJECUCION"].value = f_pagina.elements["INDICA_PRIMERA_EJECUCION"].value;
   … 237 more assignments …
   f_frame.submit();
}
```

The odd one out is **`EFXP_FOLIO`**, which is *not* copied and keeps the frame's own declared
default — an unsigned preview has no folio:

```html
<input type="hidden" name="EFXP_FOLIO"  value="0">
```

Posting all 243 review-page hidden inputs, with `EFXP_FOLIO` empty, makes SII answer **200** with
its generic `Error al contribuyente` page (an `alert(...)` carrying a support code) instead of the
PDF. So the field list **and its defaults** must be read from `PreViewFrame.html` at runtime — a
field absent from the review page falls back to the frame's declared `value`, never to `''`.

## 6. Documentos emitidos (read-only)

Reached from *Ver documentos emitidos* — `mipeLaunchPage.cgi?OPCION=2&TIPO=4`. The empresa
chooser, however, is asked for a **DTE-type** destination (`DESDE_DONDE_URL=OPCION=33&TIPO=4`,
the `desdeDonde()` default), not `OPCION=2`. That is deliberate and safe: selecting the empresa
is **session state independent of the destination** the chooser forwards to, so the listing is
scoped identically either way (verified 2026-09-09 — the listing returns the empresa's documents
after a `OPCION=33` selection).

It is not cosmetic on the **single-empresa** path, though: there SII answers a launcher that
jumps to whatever `OPCION` named (§ 1c), so the value decides which page is loaded. `OPCION=33`
lands on the factura form, which is exactly where the emisor identity is read from — so the
DTE-type destination is the one that path needs.

### Listing

```
GET /cgi-bin/Portal001/mipeAdminDocsEmi.cgi
      ?RUT_RECP=&FOLIO=&RZN_SOC=&FEC_DESDE=&FEC_HASTA=&TPO_DOC=&ESTADO=&ORDEN=&NUM_PAG=1
```

`text/html; charset=ISO-8859-1`. All filters optional. `TPO_DOC` ∈ 33, 34, 43, 46, 52, 56, 61,
110, 111, 112; `ESTADO` ∈ `EMI` (Documento Emitido) / `PRV` (Pre-View). Paged by `NUM_PAG`.

**The row markup is MALFORMED** — the receptor cell is never closed (observed 2026-09-08):

```html
<tr> <td> <a href="/cgi-bin/Portal001/mipeGesDocEmi.cgi?ALL_PAGE_ANT=2&CODIGO=99000001">
  <img src="/Portal001/button_edit.gif"></a></td>
  <td>64000001-5 <td>RAZON SOCIAL</td> <td>Factura Electronica</td> <td>5</td>
  <td>2026-09-08</td> <td>990000</td> <td>Documento Emitido</td> </tr>
```

So rows are split on the `mipeGesDocEmi.cgi?…CODIGO=` anchor and cells on `<td`, never with a
strict HTML parser. Columns: receptor RUT · razón social · tipo · folio · fecha · monto · estado.
`CODIGO` is `DHDR_CODIGO`, SII's internal id and the key the PDF is fetched by.

### The emitted document's PDF

```
GET /cgi-bin/Portal001/mipeDisplayPDF.cgi?DHDR_CODIGO=<codigo>
      → application/pdf
        content-disposition: inline; filename=<rut>.pdf
```

A plain authenticated GET — no review page, no iframe form, unlike the borrador preview. The
detail page (`mipeGesDocEmi.cgi?ALL_PAGE_ANT=2&CODIGO=<codigo>`) embeds it in an iframe and is
sent as the `Referer`. The result is the REAL document: folio assigned, timbre electrónico, and
none of the "VISTA PREVIA / DOCUMENTO NO VALIDO" watermark. `Content-Disposition` carries only
the RUT — no folio — so the local filename is composed by the caller (ADR-022).

Success is decided by `content-type` + `%PDF` magic, never by HTTP status.

**Addressing.** `FOLIO` is a server-side filter, so a document is found by folio whatever page
it lives on — one request. `CODIGO` (`DHDR_CODIGO`) has **no** filter, so reaching a document
by its internal id means walking `NUM_PAG` until it appears; the walk is paced and bounded, and
the not-found error reports how many pages were read.

**Behaviour past the last page is NOT observed** — this CGI may return an empty listing or, as
legacy CGIs often do, CLAMP to the last page. The walk therefore stops on an empty page **or on
a page whose rows repeat the previous one**, so a clamping CGI costs two requests rather than the
full bound.

## 7. Emission — OUT OF SCOPE (documented for the boundary only)
The review page's `Firmar` button:

```js
function goSignDTE(btn) { document.forms["PreViewDTE"].action = "/cgi-bin/Portal001/mipeGenXMLFirma.cgi";
                          document.forms["PreViewDTE"].submit(); }
```

**Notable:** signing is **server-side**. There is no applet, no browser certificate, no
`.pfx` — the Clave Tributaria session alone is enough for SII to sign and emit a legally-binding
factura. That is precisely why this codebase stops at the borrador (ADR-023).
