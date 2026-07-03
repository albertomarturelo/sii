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

A GWT object graph. Curated (NO `raw`), one row per `PeticionTo`. The decoded field
POSITIONS (observed 2026-07-03) — the wire has no field names, so these are the contract:

| curated field | source in the decoded graph | notes |
| --- | --- | --- |
| `numero` | `PeticionTo.field[12]` (boxed `Integer`) | the petition number |
| `materia` | `PeticionTo.field[26]` (`MateriaTo`) `.field[10]` | free text (may embed a third-party RUT → PII) |
| `estadoActual` | the timeline entry with the latest `fecha` | see lifecycle below |
| `timeline[]` | `PeticionTo.field[21]` (`ArrayList<EstadoPeticionTo>`) | most-recent-first after sorting by `fecha` |
| `timeline[].estado` | `EstadoPeticionTo.field[10]` | glosa; strip the `(Subrogancia … [NAME])` suffix |
| `timeline[].fecha` | `EstadoPeticionTo.field[7]` (`java.sql.Timestamp`) | ISO-8601 |
| `timeline[].mensaje` | `EstadoPeticionTo.field[9]` | SII's verbatim note to the taxpayer (what's pending / why), when present |

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

## Decoder — schema-driven, derived from the compiled permutation (ADR-020)

Decoded in-house by `portal/gwt.ts` (no third-party GWT library — ADR-004). The reader
walks the payload BACKWARD; each value is resolved by its position's DECLARED TYPE, never
guessed (a sample-only heuristic was tried and **rejected** — GWT has no per-object framing,
so a correct read needs the exact field layout of every type, and different petitions expose
different types — `HojaTrabajoGeneralTo`, `AutorizacionSispadTo`, … — so samples alone can't
be complete). Read primitives:

- `readInt` → 1 token · `readLong` → **2 tokens, value = a + b** (GWT high·2³² + low) ·
  `readString` → 1 token (`>0` ⇒ `stringTable[t-1]`, else null) · `readObject` → 1 token
  (`0` null, `<0` back-ref, `>0` ⇒ a type signature: instantiate, add to the seen list BEFORE
  its fields, then run that class's ops).
- Boxed leaves: `Integer`/`Short`/`Boolean` = 1, `Long`/`java.util.Date`/`java.sql.Date` = 2,
  **`Timestamp` = 3** (long ms + int nanos), `String` = a readString. `ArrayList`/`Vector` =
  size + N `readObject`. Object arrays (`[L…;`) = size + N `readObject`; primitive arrays
  (`[C`,`[I`,`[Z`,`[B`,`[S` = 1 token each; `[J` = 2; `[D`/`[F` = 1) by the `[` prefix.

**The per-type field schema** (`portal/gwt-schema.ts`, 109 classes) is DERIVED first-hand from
the compiled permutation's generated `FieldSerializer` deserialize functions (strong-name
`A4775626553B7F6CC42EAB2808331B0E`, GWT 2.0.3), NOT hand-modeled — each field's op
(`o`=readObject, `s`=readString, `i`=readInt/bool/short, `l`=readLong, `L`=collection) is read
straight from the JS, superclass deserializers inlined in position. Keyed by **class name** (the
per-type CRC in the wire sig rotates on recompile; the field layout does not) → a mere recompile
still resolves; a class whose fields actually change ⇒ "scraper roto" (loud).

**Regenerating the schema** (after a SII redeploy that changes types): fetch a permutation
`.cache.html` (authenticated GET; the module bootstrap `sispadinternet.nocache.js` lists the
strong-names) and re-run the extractor `peticiones-schema-extract.py` (this dir) against it →
`gwt-schema.ts`. The serialization-policy hash (`POc='…'`) for the REQUEST is self-healed at
runtime the same way (ADR-020).

**Live-validated 2026-07-03** end-to-end (persona session, 4 real petitions + an empresa
capture, 1): full-consume of both, correct números / materias / timelines / fechas / SII
messages. (#73 / #74)
