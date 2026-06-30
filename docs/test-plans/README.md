# Test plans (manual / live)

Hand-run test plans for exercising each module against **real SII**, through both
surfaces — the **CLI** (`sii …`) and the **MCP** server (`f22_status`, … in Claude
Desktop / Claude Code). These are the **live counterpart** to the automated `vitest`
suites (which run against fakes, no SII): vitest proves the logic in isolation; these
plans prove the wire contract + the full surface path against production.

They double as the **live re-validation** the `docs/sii-contract/*.md` files flag as
pending: run the plan, then refresh the contract's observation dates + fields.

## ⚠️ These hit production

There is no `SII_ENV` switch — prod is the only target (ADR-004). A live run uses your
real session and surfaces **your own PII** (nombre, RUT, renta, cuenta). Never paste that
output anywhere shared. Login makes **one** attempt (account-lock safety) — never retry a
failed login. Never hammer SII; respect the pacing the tasks already apply.

## Layout — one file per module

| File | Module | Surfaces | Wire contract |
|---|---|---|---|
| [`f22.md`](f22.md) | F22 — Declaración Anual de Renta (estado) | `sii f22 status` · MCP `f22_status` | [`../sii-contract/f22.md`](../sii-contract/f22.md) |
| _(planned)_ `rcv.md` | RCV — Registro de Compras y Ventas | `sii rcv summary\|list` · MCP `rcv_summary`/`rcv_list` | `../sii-contract/rcv.md` |
| _(planned)_ `auth.md` | auth + operate (login/status/logout/operate) | `sii auth …` / `sii operate …` · MCP `auth_*`/`operate` | `../sii-contract/auth-login.md` |
| [`f29.md`](f29.md) | F29 — Declaración Mensual de IVA (Fase 1) | `sii f29 formulario\|overview\|status` · MCP `f29_formulario`/`f29_overview`/`f29_status` | [`../sii-contract/f29.md`](../sii-contract/f29.md) |
| [`bte.md`](bte.md) | BTE/BHE — Boletas de Honorarios (session-keyed) | `sii bte list` · MCP `bte_list` | [`../sii-contract/bte.md`](../sii-contract/bte.md) |
| _(planned)_ `dte.md` | DTE authorized (public consulta) | `sii dte authorized` · MCP `dte_authorized` | `../sii-contract/dte-authorized.md` |

## Each plan's shape

1. **Preconditions** — build state, MCP server connected, who you must be logged in as.
2. **CLI cases** — a table: command → expected output / PASS criterion.
3. **MCP cases** — a table: natural-language prompt → tool that should fire → expected
   result / PASS criterion. (MCP clients drive tools from NL, not flags.)
4. **Cross-cutting** — PII safety, body-RUT vs session-keyed reach (ADR-005), error/exit
   paths.
5. **Report back** — the fields to capture that feed the module's `sii-contract` live
   re-validation (aliases, value forms, new códigos to exclude, error shapes).

Keep PASS criteria observable and binary. Capture **synthetic-only** examples in this
file — never paste real folios/RUTs/montos/PII into a tracked plan.
