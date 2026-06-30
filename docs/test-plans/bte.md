# Test plan — BTE/BHE (Boletas de Honorarios Electrónicas)

Live/manual plan for the `bte list` read surface, both surfaces. Wire contract:
[`../sii-contract/bte.md`](../sii-contract/bte.md).

**BTE is session-keyed (ADR-005):** it always reads the **session principal**, takes **no
`--rut`/`rut`**, and **rejects** a representing operate pointer **up front** with an actionable
"log in as the empresa" message. Reading an empresa's BHE means being logged in **as the
empresa** (logout→login).

**Architecture:** the only read surface that is **not** an SDI-JSON facade — it reads the legacy
`loa.sii.cl/cgi_IMT/` CGIs' inline JS maps via `goto`/`evaluate` (the `.sii.cl` cookie SSO-carries
to `loa.sii.cl`). **PII posture:** curated boleta, **NO `raw`** (live BUG-1, 2026-06-30): the row
mixes counterparty data with the taxpayer's OWN identity on both sides (emitidas `usuemisor` = self
emitter, recibidas `nombre_receptor` = self receptor), so — like F22/F29 — BTE exposes only the
curated tax fields and **no `raw`**. The own identity (`nombre_contribuyente`/`rut_arrastre` in the
meta; `usuemisor`/`nombre_receptor` in the row) is never surfaced.

**Scope:** `bte list <periodo>` returns ONE month's boletas (EMITIDAS by default; `--recibidas`).
Montos are es-CL parsed; `estado` is `VIG`/`ANUL`. An empty month is a clean 0-boleta result, not
an error. **Live status:** emitidas TS-live-validated 2026-06-30; **recibidas rows are ported from
Python (not yet TS-live-confirmed)** — the recibidas cases below are the priority to validate.

> ⚠️ Production + your real honorarios. See [`README.md`](README.md) before running.

## Preconditions

1. On branch `feature/GH-20-bte-read`, `pnpm build` (so `packages/mcp/dist/main.js` includes the
   BTE tool and `packages/cli/dist/main.js` the `bte` command).
2. **Restart Claude Desktop / reload the `sii` MCP server**; confirm `bte_list` is listed.
3. Be logged in **as the contributor whose BHE you want** (reads the principal). Note your RUT as
   `SELF` (and, for the session-keyed case, an `EMPRESA` you represent).
4. Pick a **`<MES_EMI>`** with boletas you **emitted** (e.g. `2026-05`), a **`<MES_REC>`** with
   boletas you **received** (if any — needed for the recibidas validation), a **`<MES_VACÍO>`** with
   none, and ideally a **`<MES_MULTI>`** with many boletas (to test pagination > page 0).

---

## MCP cases (Claude Desktop / Claude Code)

MCP clients drive tools from natural language. Type the prompt; verify the tool fired and the
result. Inputs — `bte_list`: `periodo` (YYYYMM/YYYY-MM), `recibidas?` (boolean; default EMITIDAS).

| # | Prompt to type | Tool / args | Expected result / PASS |
|---|---|---|---|
| M0 | "¿Qué herramientas del servidor sii tienes?" | — | Lists `bte_list` (+ `auth_*`, `operate`, `rcv_*`, `f22_*`, `f29_*`, `dte_authorized`). |
| M1 | "Inicia sesión en el SII" | `auth_login` (no password) | Browser flow; you type the Clave. PASS: Clave never crosses the tool arg / chat. |
| M2 | "¿Quién soy?" | `auth_status` | Shows `SELF`. Record it. |
| **Emitidas** ||||
| M3 🎯 | "Muéstrame mis boletas de honorarios emitidas de `<MES_EMI>`" | `bte_list {periodo:"<MES_EMI>"}` | JSON `{rut, periodo, side:"EMITIDAS", totalBoletas, totales:{honorarios,retencionEmisor,retencionReceptor,liquido}, boletas[]}`, each `{folio, fecha, contraparteRut, contraparteNombre, totalHonorarios, honorariosLiquidos, retencionReceptor, estado:"VIG"|"ANUL", fechaAnulacion, socProfesional}` — **no `raw` key**. PASS: `boletas.length == totalBoletas`. |
| M4 | "¿A quién le emití boletas en `<MES_EMI>`?" | (reads M3) | Lists the **receptores** (`contraparteRut` + `contraparteNombre`). |
| M5 🔒 | "En esas boletas, ¿aparece mi propio nombre o RUT como titular del informe?" | (reads M3) | PASS only if the taxpayer's OWN identity does NOT appear anywhere — and there is **no `raw` key at all** (the regression source for BUG-1: `raw.usuemisor`/`raw.nombre_receptor`). Counterparty RUT/nombre ARE expected. Any own-identity leak → FAIL (record it). |
| M6 | "Mis boletas emitidas de `<MES_VACÍO>`" | `bte_list {periodo}` | `totalBoletas:0`, `boletas:[]` — clean negative, not an error. |
| **Recibidas (validates the ported side)** ||||
| M7 🎯 | "Muéstrame las boletas de honorarios que **recibí** en `<MES_REC>`" | `bte_list {periodo:"<MES_REC>", recibidas:true}` | `side:"RECIBIDAS"`; `contraparteRut`/`contraparteNombre` are the **emisor** (`rutemisor`/`nombre_emisor`). PASS: rows parse (this is the priority live check — see report-back). |
| M8 | "¿Alguna de esas boletas está anulada?" | (reads M3/M7) | If any: `estado:"ANUL"` + a non-null `fechaAnulacion`. Vigentes: `estado:"VIG"`, `fechaAnulacion:null`. |
| **Cross-cutting** ||||
| M9 🔑 | "Opera como la empresa `<EMPRESA>`" then "mis boletas emitidas de `<MES_EMI>`" | `operate {rut}` → `bte_list` | **Session-keyed proof:** `bte_list` **rejects** — *"Las boletas de honorarios son session-keyed… inicia sesión como ella (logout→login)"* — echoing the **empresa RUT** (NOT the razón social). Result `isError`. **No SII call** made. |
| M10 | "Vuelve a operar como yo" then "mis boletas de `<MES_EMI>`" | `operate {self:true}` → `bte_list` | Now succeeds, reads `SELF`. |
| M11 | "Mis boletas del mes 'abc'" / "de 2026-13" | `bte_list {periodo}` | Validation error (*"Período inválido…"* / mes 1–12), **before** any SII call. Result `isError`. |
| M12 | "Cierra sesión" then "mis boletas de `<MES_EMI>`" | `auth_logout` → `bte_list` | `NotAuthenticated` with a re-login hint. Result `isError`. |

---

## CLI cases (`sii bte …`)

The `sii` binary is not on `$PATH`; run it as `node packages/cli/dist/main.js …` from the repo
root (or `alias sii='node packages/cli/dist/main.js'`). **Output is JSON by default** (pipe to
`jq`); add **`--human`** for the readable rendering. The `operating as:` header + diagnostics go to
STDERR (human mode only). Check `echo $?` for the exit code where noted.

| # | Command | Expected output / PASS |
|---|---|---|
| C1 | `sii auth login` | Browser opens, you type the Clave, lands off `zeusr.sii.cl`. PASS: login OK, Clave never on argv. |
| C2 | `sii auth status --human` | Prints your RUT + `operating as:` header. Record it as `SELF`. |
| **Emitidas** ||
| C3 🎯 | `sii bte list <MES_EMI> --human` | Header `BHE EMITIDAS <MES_EMI> — <rut>`, then per boleta `  folio=<n>  <DD/MM/YYYY>  <contraparte rut>  <nombre>  líquido=<monto>` (anuladas tagged `[ANULADA]`), then `N boleta(s); líquido total=<monto>.`. PASS: count + total render. |
| C4 🔒 | Inspect C3 output for OWN-identity PII | PASS only if the taxpayer's own nombre/RUT-as-titular does NOT appear (counterparty data does). Any own-identity leak → FAIL (record it). |
| C5 | `sii bte list <MES_VACÍO> --human` | `Sin boletas en el período.` — clean negative, not an error. Exit 0. |
| C6 | `sii bte list <MES_EMI>` (JSON, default) `\| jq '.boletas[0] \| has("raw")'` | `false` — there is **no `raw` key** (BUG-1). `jq '.boletas[0]'` shows only curated fields. PASS: STDOUT is pure JSON (header on STDERR). |
| C7 | `sii bte list <MES_EMI> --emitidas --human` | Identical to C3 (explicit emitidas = default). |
| **Recibidas (validates the ported side)** ||
| C8 🎯 | `sii bte list <MES_REC> --recibidas --human` | Header `BHE RECIBIDAS <MES_REC> — <rut>`; `contraparte` is the **emisor**. PASS: rows parse with `contraparteRut`/`contraparteNombre` populated (priority live check). |
| **Cross-cutting** ||
| C9 🔑 | `sii operate <EMPRESA>` then `sii bte list <MES_EMI>` | **Session-keyed proof:** **rejected** with *"Las boletas de honorarios son session-keyed… inicia sesión como ella (logout→login)"* echoing the **empresa RUT** (NOT the razón social). Non-zero exit, **no SII call**. |
| C10 | `sii operate --self` then `sii bte list <MES_EMI>` | Now succeeds, reads `SELF`. |
| C11 | `sii bte list 2026-13` / `sii bte list abc` | Validation error *"Período inválido…"* / mes 1–12, before any SII call. Non-zero exit. |
| C12 | `sii auth logout` then `sii bte list <MES_EMI>` | `NotAuthenticated` (actionable re-login hint), **exit code 2**. |
| C13 | `sii bte list <MES_EMI>` (JSON) `\| jq '.error // .side'` | In JSON mode an error surfaces as `{"error":"<verbatim>"}`; success as the result object. PASS: STDOUT parseable. |
| C14 📄 | `sii bte list <MES_MULTI>` (a month with many boletas) `\| jq '{total:.totalBoletas, got:(.boletas\|length)}'` | **Pagination check:** `got == total` even when `total` exceeds one page. PASS confirms `pagina_solicitada++` advances (the contract's open TBD). If `got < total` → FAIL (record: page size + whether a cursor is needed). |

---

## Cross-checks & report back → feeds `sii-contract/bte.md`

Capture (synthetic/redacted only here; keep real folios/RUTs/montos/PII out of git):

- **Recibidas rows (PRIORITY — ported, not TS-live-confirmed)** — from C8/M7, confirm the recibidas
  row fields (`rutemisor`+`dvemisor`, `nombre_emisor`, `fecha_boleta`, `retencion_receptor`,
  `cod_comuna`, …) parse into `contraparteRut`/`contraparteNombre`/etc. Note any alias mismatch and
  extend `portal/bte.ts` `ALIASES` with an `// observed …` citation. Then drop the "recibidas
  ported" caveat in the contract.
- **Pagination > page 0** — from C14, confirm `pagina_solicitada++` advances and `boletas.length`
  reaches `total_boletas`; record the page size + whether `pagina_sig_codigo` (cursor) is needed.
- **`estado` labels** — record any value beyond `N` (VIG) / `S` (ANUL); extend the label map + cite.
- **Monto forms** — confirm row montos are es-CL dot-formatted (`"1.300.000"`) and meta `suma_*` are
  plain; that the parser yields correct integers.
- **`porcentaje_retencion`** (monthly meta) — record its value + meaning if it can be pinned.
- **CLI ↔ MCP parity** — `bte_list {periodo}` boletas match `sii bte list <periodo>` (same folios,
  contrapartes, montos, totals).
- **PII** — confirm there is **no `raw` key** and the own-identity (meta `nombre_contribuyente`/
  `rut_arrastre`; row `usuemisor`/`nombre_receptor`) NEVER surfaces. Only the curated tax fields +
  the **counterparty** `contraparteRut`/`contraparteNombre` appear. The audit log carries only
  action/result/period/side (no montos, no names).

When done, refresh the dates/fields in `docs/sii-contract/bte.md` and tick the live-validation in
`docs/CURRENT_STATUS.md`.
