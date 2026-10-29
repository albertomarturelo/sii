# ADR-032: `bienes-raices` — the predios a RUT pays and their cuotas, from Mi SII

## Status

Accepted — 2026-10-28 (amended 2026-10-29: the public cuota breakdown, #251)

## Context

A taxpayer can fall behind on contribuciones (impuesto territorial) without noticing: nobody
pushes a reminder (#236). The spike of 2026-10-28 (headed locate, then browser-free probes over
the HTTP driver) found two SII sources:

- **Mi SII** home, accordion « Bienes raíces »: `POST misiir.sii.cl/cgi_misii/CViewCarta.cgi`,
  form `opc=34&VIEW=1&rnd=<random>`, answers JSON from the SDI service
  `cl.sii.sdi.lob.bbrr.serviciosecontribuciones…PropiedadesApplicationService/getPropiedades`.
  It lists « las propiedades a las que Ud. paga las contribuciones habitualmente » (owned or
  not), each with a map of its **unpaid** cuotas. It works with the classic cookies-only session,
  no browser.
- **`www2.sii.cl/vica`** « Mis bienes raíces »: ficha, avalúo, exenciones, but only for the
  predios **registered** to the RUT, with no payment status, behind the www2 app layer whose
  bridge to the classic session was observed only that day (#241).

ADR-030 admits a source into `alertas` only when SII itself shows it; TGR stays out. Mi SII shows
the vencida / vigente count per predio, so that rule holds here.

## Decision

- **Verb `sii bienes-raices list` / MCP `bienes_raices_list`** (`readOnlyHint`), read-only. The
  artifact is SII's « Avalúos y contribuciones de bienes raíces » (ADR-024); a later `avaluo` or
  `ficha` belongs under the same verb. Facade `portal/bienes-raices-misii.ts`, task
  `tasks/bienes-raices.ts`.
- **Session-keyed** (ADR-005): the request carries no RUT, Mi SII answers for the principal. No
  `--rut`; a representing pointer is refused up front with `assertOperatingSelf`.
- **Transport:** `PortalSession.requestForm` (the CGI takes `x-www-form-urlencoded`, which
  `requestJson` does not send), then `JSON.parse` + a zod envelope (`data`: record or null,
  `metaData.errors`), `.loose()`. A dead jar lands on `LOGIN_HOST` (Mi SII's JS bounce, #139) and
  the seam raises `SessionExpiredError`. A body that is not JSON, or an envelope that does not
  parse, is "scraper roto". `metaData.errors` non-empty ⇒ SII's message verbatim. `data: null` or
  `{}` is a legitimate "no predios".
- **Curated row, NO `raw`:** `{ rol, comuna: { codigo, nombre }, manzana, predio, direccion,
  destino, propietario, cuotas[], cuotasVencidas, cuotasVigentes }`. `propietario` is SII's own
  boolean. Dropped: `nombrePropietario` (a third party's or the user's own name), the map keys
  (the predio key is `<RUT>-<rol>`), and the fields whose meaning was not observed (`pac`,
  `ind*`, `*CNP`, `agnoVigDesde`). The dirección is PII: the CLI help and the MCP description say
  so; the audit records the RUT and counts only.
- **Cuota:** `{ anio, semestre, cuota, condicion, vencida, fechaVencimiento, totalPago }`. Fields
  as SII's own client reads them (`misii.min.js`, `getCuotas` / `formateaGrilla`, read
  2026-10-28). `vencida` is SII's rule: `condicion == "VENCIDA"`; `condicion` stays verbatim.
  `fechaVencimiento` accepts the two formats SII's `dateOrderKey` accepts (`YYYY-MM-DD…`,
  `D[-/]M[-/]YYYY`) and becomes `YYYY-MM-DD`; anything else is `null`, never a guess.
  `totalPago`: a number as is, an es-CL string (`$ 12.345`) parsed, anything else `null`.
- **`alertas` source `bienes_raices`** (ADR-030 amendment), one SII call:
  - `contribuciones_vencida` for every cuota with `vencida`;
  - `contribuciones_por_vencer` for a vigente cuota due within 30 days of today, or whose date
    did not parse (better shown than hidden);
  - id `bienes_raices:<comuna>-<manzana>-<predio>:<anio>-<semestre>-<cuota>:<vencida|por_vencer>`,
    so a cuota resurfaces once when it turns vencida; `fecha` = the due date, `estado` =
    `condicion`, and an optional `contribucion: { rol, comuna, cuota, monto }` (the `vencimiento`
    precedent: present only on these alertas, other alertas unchanged).
- **Live validation still pending:** the cuota's live types and date format. The parsers above are
  built to read an unexpected shape as `null`, and the first real cuota must be checked against
  them before the row is ticked ✅.

## Amendment (2026-10-29, #251): the cuota breakdown from SII's public consulta; vica set aside

Spike #251 looked for the avalúo, the exenciones and each cuota's amount within the plazo next to
the total with interest. Wire detail: `sii-contract/bienes-raices.md`.

- **vica is set aside.** It lists only the predios SII's rol registers to the RUT
  (`por-rut` answers `204` otherwise), so a payer who is not the registered owner sees nothing,
  and its rows were not observed. From a cold browser it needs the www2 OAuth login (reCAPTCHA,
  ADR-026), and it sits behind a Queue-it waiting room. Avalúo, exenciones and ficha wait for an
  account with a registered predio and for #241.
- **The breakdown comes from SII's public consulta** (`www4.sii.cl/cuotaanualbienesraicespubinternetui`,
  SDI `buscarPropiedades`). It takes `{codigoComuna, manzana, predio}`, needs no session and no
  cookie (observed from Node), and returns the predio with its unpaid cuotas. Per cuota, SII's own
  client reads `valor` (within the plazo), its parts, `reajustes`, `intereses`, `condonacion` and
  `totalPago`. Transport: `PortalDriver.requestPublic` (ADR-014).
- **How it joins `list`:** Mi SII stays the source of WHICH predios the RUT pays (session-keyed).
  For each predio with unpaid cuotas, one paced public call adds the breakdown to its cuotas; a
  failed call leaves that breakdown `null` and the result says so, and Mi SII's own cuota stays.
  If the first real Mi SII cuota (#250) already carries these fields, read them there and drop the
  public call. The build is its own issue.
- **Not used:** `getPagos` (the payment history) returns, for any rol, the RUT of whoever paid.
  The payment operations are never called (ADR-029: the project never pays).
- Rejected for the breakdown: vica's `cuotas-contribuciones` (registered owners only, OAuth).

## Alternatives Considered

1. **vica (`www2`) as the source.** Rejected for now: registered owners only (a payer who does
   not own the predio sees nothing), no payment status, row shape never observed, and it rests on
   the www2 bridge (#241). Its avalúo and exenciones can join the verb later, with their own spike.
2. **Both sources merged in `list`.** Rejected: two transports and two failure modes in one row,
   and the vica half cannot be validated today.
3. **The cuota status from TGR.** Rejected by ADR-030: another institution, its own spike and ADR.
4. **Every cuota por pagar as an alerta.** Rejected: a cuota months away repeats every day as
   noise. **Vencidas only:** rejected, the alerta would come after the interest starts.
5. **Verb `contribuciones` or `predios`.** Rejected: SII names the section « bienes raíces », and
   avalúo / ficha would sit badly under a verb named after the tax.
6. **Keeping `raw`.** Rejected: the row carries the owner's name; prefer dropping `raw` over a
   denylist (CONVENTIONS).

## Consequences

- Easier: one browser-free call answers « debo contribuciones? », and the daily `alertas` routine
  catches a cuota before and after it falls due.
- New shape: the first read through `requestForm` that answers JSON. If a second CGI does the
  same, the pattern goes into CONVENTIONS.
- Risk: the cuota parsers rest on SII's client code until a real cuota is observed. A wrong guess
  reads as `null` (a por-vencer alerta with no date), not as a wrong value.
- `alertas` gains a default source: one more paced call, new alertas for accounts that owe
  contribuciones (an `Added` line, a minor bump).
