# Wire contract — empresas autorizadas (operable set)

Observed at `https://www4.sii.cl/consdcvinternetui/` on **2026-06-20**, confirmed
working **2026-06-26** (prod, persona-natural session). Ported from the proven
Python `sii-cli` (`portal/representacion.py`) — first-hand observation, no
third-party library (ADR-004). All values below are **synthetic / redacted**; a
represented empresa's RUT + razón social are PII and MUST NOT land here.

Surface: `@albertomarturelo/sii-core` `portal/representacion.ts` (`fetchEmpresasAutorizadas`),
called best-effort on login to populate the operable set (ADR-005). Uses the
`PortalSession.requestJson` seam (an authenticated JSON POST from the session's
browser context — the primitive for all `www4.sii.cl` SDI facades).

## Endpoint

- `POST https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getDcvEmpresasAutorizadas`
- **GET → 405** — must be POST.
- **Session-keyed.** Returns the authorizations of the session principal (NOT of
  an addressed RUT) — same posture as BHE / whoami. There is no operating-RUT
  parameter (ADR-005). The result IS the source of valid operate targets.

### Headers (same as the sibling RCV facades)

| header | value |
| --- | --- |
| `Content-Type` | `application/json` |
| `Origin` | `https://www4.sii.cl` |
| `Referer` | `https://www4.sii.cl/consdcvinternetui/` |
| `Accept` | `application/json, text/plain, */*` |

### Request body

```json
{
  "metaData": {
    "namespace": "cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDcvEmpresasAutorizadas",
    "conversationId": "<TOKEN cookie on www4.sii.cl, empty value accepted>",
    "transactionId": "<fresh uuid v4>",
    "page": null
  },
  "data": {}
}
```

- `data` is **empty `{}`** — confirmed working live 2026-06-26 (no operating params).
- `conversationId` = the `TOKEN` cookie on `www4.sii.cl`. May not exist yet if the
  session was minted against Mi-SII; the endpoint accepts the empty value.

## Response

Rows under `data[]` (defensive fallbacks: `datos` / `empresas` / `items`). Parsed
**alias-tolerantly** (observed name first). Each row, observed keys:

| logical field | observed key (aliases) | notes |
| --- | --- | --- |
| empresa RUT body | `usrEmpRut` (`rutEmpresa`, `empRut`) | digits |
| empresa DV | `usrEmpDv` (`dvEmpresa`, `empDv`) | check digit |
| empresa RUT combined | `usrEmpRutDv` (`rutDvEmpresa`) | fallback when body+DV absent |
| razón social | `razonSocONombreEmp` (`razonSocial`, `nombreEmpresa`) | **came `null`** in the observed call; PII |
| privilegios | `usrPrivilegios` (`privilegios`) | |
| querying user | `usrUsuarioRut` / `usrUsuarioDv` | **came `null`** — do NOT rely on for `isSelf` |
| deauth metadata | `usrFechaDesautorizacion` / `empFechaDesautorizacion` | in `raw` |

- The list **includes the account's OWN RUT**, flagged `isSelf` (matched against
  the session-principal RUT from the sidecar, since `usrUsuarioRut` came null).
- **Empty `data[]`** = the account represents no empresa (operates only its own
  RUT) — a legitimate result, NOT an error.

### Error envelope

The shared SDI envelope: `respEstado.codRespuesta != 0` ⇒ SII signaled an error.
The message (`respEstado.msgeRespuesta`, fallback `codError`) is surfaced
**verbatim** (`RepresentacionError`, ADR-004) — never translated, never silently
returned as empty (which would be indistinguishable from "no representations").

## Curated shape (`EmpresaAutorizada`)

`{ rut: canonical | null, razonSocial: string | null, privilegios: string | null,
isSelf: boolean, raw: <full row> }` — curated + `raw` (CONVENTIONS). On login,
rows with a parseable `rut` map to `OperableEntry { rut, razonSocial, isSelf }`;
`razonSocial` is PII → never audited (only the count).

## Live-validated 2026-06-28

Confirmed against a real persona session (read-only, via the Node adapter's
`requestJson`): `getDcvEmpresasAutorizadas` returned `count=2` — one represented
empresa (`isSelf:false`) + the account's own RUT (`isSelf:true`, correctly
flagged). Findings:

- The POST authorizes **without navigating to the SPA first** — the session
  carries a domain-wide `.sii.cl` cookie that covers `www4.sii.cl`; no www4-
  specific cookie and no `conversationId` were needed (sent empty). So login's
  `resolveOperable` (restore → fetch, no SPA nav) works as written.
- `razonSocONombreEmp` came **null** again (curated `razonSocial` falls back to the
  RUT in `OperableEntry`); `usrPrivilegios` also null for this account.
