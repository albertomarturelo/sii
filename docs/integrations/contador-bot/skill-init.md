# Skill: initialization (`/inicializar-sii`)

Run this once when the bot is created, and again whenever the user wants to add, remove or
re-key an account. It registers the SII accounts the bot will operate. It also gets each Clave
Tributaria into a file on the computer **without the Clave ever passing through the
conversation**. Then it verifies each account with exactly one login.

**Inputs:** the conversation with the user, and the Grok Bot computer (terminal + `/workspace`).
**Output:** `sii.accounts` and `sii.version` in memory, one verified session per account, and
the routines of [`prompt.md`](prompt.md) created.
**Needs approval:** installing the CLI, and every login (step 5).

## The one rule this skill exists for

**Never ask for a Clave in the chat, and never accept one there.** Grok Bot's own guidance
says not to send passwords in ordinary chat: a chat message goes into the transcript and the
model's context. This project's posture is the same (ADR-006): the Clave never reaches a model.

If the user pastes a Clave in the chat anyway:
- don't use it, and don't repeat it;
- tell them it is now in the conversation history and recommend changing it at SII (in Mi SII, at sii.cl);
- then continue with the secure handoff below.

## Step 1. Who may be registered

Ask, and record the answer. Register only:
- the user's **own** RUT;
- **empresas they legally represent and whose Clave they hold themselves**.

Refuse to register a third party's account, a client's for example, even if the user has
their Clave. Holding someone else's Clave is outside this tool's terms (ADR-004). Suggest
SII's own representation mechanisms instead.

## Step 2. Account data (chat, nothing secret)

For each account, ask for and confirm:

| Field | Example | Notes |
| --- | --- | --- |
| `rut` | `11111111-1` | With guion and dígito verificador. Validated locally by the CLI at login (step 5): a malformed RUT fails without contacting SII |
| `alias` | `personal`, `mi-empresa` | How the user will refer to it |
| `tipo` | `persona` / `empresa` | Confirmed later by `sii whoami` |
| `f29Vencimiento` | `20` or `12` | `20` if it issues electronic invoices and declares online, else `12` (skill-sii § 5) |
| `ivaHabitual` | `sí` / `no` | Whether the account normally has IVA movement (otherwise F29 "sin movimiento") |
| `recordatorios` | `[5, 2, 0]` | Days before the due date to remind; default `[5, 2, 0]` |
| `canal` | this conversation | Where reminders go; never a group chat (amounts and RUTs are private) |

The time zone is `America/Santiago` unless the user says otherwise.

## Step 3. Prepare the computer

Ask the user to approve, then:

```bash
node --version                     # needs v20 or later
v=$(npm view @albertomarturelo/sii-cli version) && npm i -g "@albertomarturelo/sii-cli@$v" && sii --version
mkdir -p -m 700 /workspace/.sii /workspace/.sii-secrets /workspace/sii-setup
[ -L ~/.sii ] || ln -s /workspace/.sii ~/.sii
```

Record the installed version in memory as `sii.version`. Then write this helper. It contains no
secret, and the user can read it before running it:

```bash
cat > /workspace/sii-setup/guardar-clave.sh <<'EOF'
#!/usr/bin/env bash
# Stores the Clave Tributaria of ONE RUT for the sii CLI. Run it yourself, in the terminal,
# while you have control of the computer. Nothing is echoed; only "listo" is printed.
set -euo pipefail
rut="${1:?uso: guardar-clave.sh <rut>}"
umask 077
mkdir -p /workspace/.sii-secrets
IFS= read -rsp "Clave Tributaria de $rut (no se ve al escribir): " clave; echo
[ -n "$clave" ] || { echo "Clave vacía: no se guardó nada."; exit 1; }
printf '%s\n' "$clave" > "/workspace/.sii-secrets/$rut"
unset clave
echo listo
EOF
chmod 700 /workspace/sii-setup/guardar-clave.sh
```

## Step 4. The secure handoff, one account at a time

Tell the user, in their language, something like:

> Para guardar la Clave del RUT 11111111-1 sin que pase por este chat:
> 1. Toma el control del computador (**Take control**) y abre una terminal.
> 2. Escribe: `bash /workspace/sii-setup/guardar-clave.sh 11111111-1`
> 3. Escribe tu Clave cuando la pida. No se verá mientras escribes.
> 4. Cuando veas `listo`, elige **I'm done** y avísame.

Then check that the file exists, **without reading it**:

```bash
test -s /workspace/.sii-secrets/11111111-1 && stat -c '%a' /workspace/.sii-secrets/11111111-1
```

It must print `600`. If the file is missing or empty, ask the user to repeat the step. If the
takeover view has no terminal, **stop**: tell the user the handoff is not possible on this
setup. Never fall back to the chat.

## Step 5. Verify each account: exactly one login

With the user's approval, for each account in turn:

```bash
sii auth login --rut 11111111-1 --clave-stdin < /workspace/.sii-secrets/11111111-1
sii whoami
```

- **Success:** show the user the `whoami` result (tipo, razón social/nombre) and ask them to
  confirm it is the right account. Store `tipo` from it. Before the next account, run
  `sii auth logout`: one session at a time.
- **`login_rejected`:** SII rejected the Clave, and the CLI has latched that RUT, so every
  unattended login for it is refused from now on.
  - Do **not** try again.
  - Tell the user to repeat step 4 with the right Clave.
  - Then, still in the takeover terminal, they lift the latch themselves with
    `sii auth unblock --rut 11111111-1`. You never run that command.
  - Then verify again: one login.
- **`login_queued`:** SII's waiting room. Try this account again later, never in a loop.
- **Any other error:** stop and report `error` and `type` verbatim.

## Step 6. Memory and routines

Save in memory:
- `sii.accounts`: the table of step 2, with `tipo` confirmed;
- `sii.version`;
- `sii.initDate`;
- `sii.knowledge`: the `skill-sii.md` tag it matches, `v<sii.version>`.

Never save a Clave, a cookie or a file's content.

Create the routines listed in [`prompt.md`](prompt.md) § Routines, and show the user each one's
next run time.

## Step 7. What the user must set themselves

Tell the user to add these **Auto-review "Ask first"** rules (Settings → General →
Auto-review), so the platform stops these actions for approval even if you were wrong about one:

- any command containing `sii f29 submit` together with `--confirm`;
- any command containing `npm i -g` or `npm install -g`;
- any command containing `sii auth unblock`;
- any command that reads a file under `/workspace/.sii-secrets/` other than the login's stdin
  redirect.

Also tell them plainly about the residual risk:
- The Grok Bot computer is shared by **all** of their Bots, so another Bot on the account
  could read `/workspace/.sii-secrets/`. Give the SII work to this Bot only.
- An agent that controls a machine can, in principle, read any secret on it. That is why only
  the user's own accounts are registered (step 1).
