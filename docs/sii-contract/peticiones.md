# Wire contract — Peticiones Administrativas (SISPAD)

First-hand observation, no third-party library (ADR-004). Endpoint/payload shapes
**live-captured 2026-07-03** (headed capture + headless replay PoC, issue #73). This
surface has **never existed in the Python `sii-cli`** — it is new to this project.
All values below are **synthetic / redacted** — números, RUTs, materias, functionary
names and dates are PII/taxpayer data and MUST NOT land here.

Surface (planned, #74): `@albertomarturelo/sii-core` `portal/peticiones.ts` (facade over a
`portal/gwt.ts` codec), called by the `peticiones` task under `withSession`. Reached via
the **GWT-RPC read seam** (ADR-020), NOT `requestJson`/`requestForm`.

## Transport — GWT-RPC (not SDI-JSON)

The app is a GWT SPA at `https://www3.sii.cl/sispadinternet/`. The `.sii.cl` session
cookie **SSO-carries** here headlessly (like `loa.sii.cl` for BTE) — a restored
cookies-only session reaches it with no extra login. A **cold authenticated POST works**
— no app warm-up / SPA-driving needed (observed #73). Calls are **GWT-RPC**:

| | |
| --- | --- |
| endpoint | `POST https://www3.sii.cl/sispadinternet/peticion` |
| content-type | `text/x-gwt-rpc; charset=utf-8` (request) |
| required headers | `X-GWT-Module-Base: https://www3.sii.cl/sispadinternet/` |
| NOT required | `X-GWT-Permutation` (replay succeeds without it — observed) |
| service | `cl.sii.sdi.difsj.sispadinternet.web.client.service.aplicacion.peticion.ServicePeticion` |
| method | `peticionesUsuario(Integer rut, String token)` |
| response | `//OK[…]` — a GWT-serialized object graph (int reverse-stack + string table + inline longs) |

## Auth — body-RUT (ADR-005)

The `rut` is a **request parameter**, not session-derived: replaying one session with two
different RUTs returned two different petition sets (observed 2026-07-03). So peticiones is
**body-RUT like RCV** (not session-keyed like F22): the task resolves the operating RUT and
validates `--rut` against the operable set (`resolveOperableTarget`). **Verified 2026-07-03:**
a persona session read her own petitions AND those of the empresa she represents (both in her
operable set) — so the operable-set gate is correct. (An empresa session, operated by its R.L.,
additionally sees the R.L.'s petitions; irrelevant to our model — empresa accounts take no
`--rut`.) Never probe arbitrary RUTs against the live server.

## Request wire shape

The body is the GWT-RPC stream (`version|flags|strTableLen|…strings…|invocation`). Only the
**token** and **rut** vary; the rest is a fixed template:

```
5|0|7|<moduleBase>|<policyHash>|<ServicePeticion iface>|peticionesUsuario|
java.lang.Integer/3438268394|java.lang.String/2004016611|<TOKEN>|1|2|3|4|2|5|6|5|<RUT>|7|
```

- `<policyHash>` — the service serialization-policy strong-name (32-hex). **Validated** by the
  server (a bogus hash fails — #73). **Rotates on SII redeploy** → sourced at runtime by a
  `requestText` GET of the permutation JS (`…cache.html`, where it appears as a `POc='…'`
  constant); cache the last-known-good + self-heal (re-fetch + re-probe candidates) on failure.
  Was stable across the PoC.
- `<TOKEN>` — a GWT UI conversation id, **NOT validated by the server**: a stale/placeholder
  value still returns `//OK` (observed #73 — a token from a different session, and even `"x"`,
  worked). Send a constant placeholder; authorization is by the **session cookie + `<RUT>`**.

## Response wire shape (`//OK[…]`)

A GWT object graph. Curated (NO `raw`), one row per `PeticionTo`:

| curated field | source in the graph | notes |
| --- | --- | --- |
| `numero` | `PeticionTo` id | the petition number |
| `materia` | `MateriaTo` glosa | free text (may embed a third-party RUT → treat as PII, allowlist) |
| `estadoActual` | latest `EstadoPeticionTo` glosa | see lifecycle below |
| `timeline[]` | `EstadoPeticionTo` list | `{ estado, fecha }` per transition, inline `java.sql.Timestamp` longs |

Observed estado lifecycle glosas (SII labels, non-PII — the state machine):

```
Petición Ingresada por Internet → Petición Generada → Petición Recepcionada por el SII →
Petición Admitida por SII → Petición Asignada para Resolución → Petición Asignada para
Revisión → Peticion en espera de Antecedentes → Petición Cerrada
```

`Peticion en espera de Antecedentes` = **SII is waiting on the taxpayer** (a classic
un-notified pending). `//EX[…]` or a `LOGIN_HOST` bounce ⇒ `SessionExpiredError`/"scraper roto".

## PII posture — no `raw`, tight allowlist (ADR-004 / ADR-006)

The `//OK` graph is PII-dense on ALL sides: the taxpayer's own identity (name, address,
email, giro), **SII functionary names + work emails**, and third-party RUTs inside materia
glosas. A per-field denylist is not provably complete → **drop `raw` entirely** and surface
only the allowlisted tracking fields (número, materia glosa, estado, fechas). The audit
records the read only (rut), never petition contents.

**⚠️ Even the allowlisted `estado` glosa can embed functionary PII** — observed
`"Petición Asignada para Resolución (Subrogancia Informal [<NOMBRE APELLIDO>])"` — so the
curated estado must **strip the bracketed `(Subrogancia … [NAME])` suffix** before surfacing.
And an `en espera de Antecedentes` state carries a **respuesta/observación free-text** ("what's
missing", e.g. a note naming a document + an empresa) — valuable to the user but may embed a
RUT/nombre; surface it only after the same sanitization, or omit it in a first cut.

**Decoding note:** a heuristic scan (collect glosas + timestamps by proximity) was tried and
**rejected** — it can't count petitions (needs the real `ArrayList` size), confuses materia with
the observación text, and doesn't pair estado↔fecha. A correct read needs a proper GWT
client-stream reader (read the payload backward; `readObject` resolves a positive token as a
1-based string-table type signature, a negative token as a back-reference, `0` as null; fields
per type in generated-serializer order). Model the types the graph actually contains
(`PeticionTo`, `EstadoPeticionTo`, `EstadoTo`, `DefinicionEstadosTo`, `MateriaTo`,
`FuncionarioTo` + org TOs, `ContribuyenteTo`, `Timestamp`/`Date` longs, `ArrayList`/`Vector`,
`Integer`/`Long`/`Short`), reverse-engineered from the captured samples and guarded by
"scraper roto" on any desync. (#74)
