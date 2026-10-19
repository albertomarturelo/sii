# Contador bot

An autonomous agent that acts as a Chilean accountant for **your own** SII accounts. It
drives the `sii` CLI on the agent's computer. It is written for **Grok Bot** (xAI's persistent
agent: skills, routines, memory, a cloud computer with a terminal). The skills are plain
markdown, so any agent with a shell, a scheduler and memory can use them.

| File | For whom | What |
| --- | --- | --- |
| [`prompt.md`](prompt.md) | You → Grok | The block you paste to create the Bot: role, hard rules, approval protocol, routines |
| [`skill-init.md`](skill-init.md) | The Bot | Initialization: registers your RUTs, gets each Clave onto the computer without it passing through the chat, verifies each account with one login |
| [`skill-sii.md`](skill-sii.md) | The Bot | The knowledge base: session loop, error kinds, commands, F29 rules and workflow |

## What it does

- **Reminds you before every F29 is due**, per account: on the days you choose, on the due date,
  and after it if you are late.
- **Prepares a monthly borrador.** It starts from SII's propuesta (`sii f29 formulario`),
  cross-checks it against the RCV and last month's position, and lists what the propuesta may
  be missing.
- **Confirms the filing** once it shows as `Vigente`, and downloads the receipt (`sii f29 pdf`).
- **Keeps its knowledge current.** Weekly, it compares its installed version with npm, reads the
  CHANGELOG, stores a summary, and proposes the upgrade. You approve each upgrade.

## What it does not do (yet)

- **File the F29.** `sii f29 submit` is planned (spike #138, posture in a pending ADR-029) and
  not shipped. Until it is, you file at SII yourself, from the borrador. The prompt's approval
  protocol is written for when it lands. The weekly update routine tells you when `--help`
  shows it, and only then is it used.
- **Pay.** Never. When filing exists, you get SII's payment link and pay in your own browser.
- **Anything else that writes at SII** (BHE emission, DTE borradores): forbidden by its rules.
- **Carpeta Tributaria:** its www2 session needs reCAPTCHA in a browser, which an agent cannot
  pass.

## Setup

1. **Have a release that contains this folder** (`v0.12.2` or later). The prompt fetches the
   skills at a tag, so the Bot's instructions always match the binary it installs.
2. **Create the Bot.** Open a new one-to-one conversation with Grok Bot. Paste the block from
   `prompt.md`, with `<tag>` replaced.
3. **Initialize.** The Bot runs `inicializar-sii`. It asks in the chat for your RUTs and settings
   (nothing secret). For each Clave it asks you to **take control of its computer** and run a
   small script that you can read first: `/workspace/sii-setup/guardar-clave.sh <rut>`. The Clave
   is typed into the terminal, not the chat, and lands in `/workspace/.sii-secrets/<rut>` (mode
   `600`). The Bot then verifies each account with **one** login and shows you `sii whoami` to
   confirm.
4. **Add the Auto-review rules** the Bot lists at the end (Settings → General → Auto-review →
   "Ask first"): `sii f29 submit … --confirm`, `npm i -g`, `sii auth unblock`, and commands
   that pair `.sii-secrets` with a reader such as `cat` or `cp`. Not the login itself, which
   mentions that folder too: an unattended approval expires, and the routine would stall. These make the platform stop those actions for your approval,
   independently of the Bot's own rules.

## Security model, and what it does not cover

- **The Clave never goes through the chat.** Grok Bot's docs say not to send passwords in
  ordinary chat. Its masked secret requests only exist for supported connections, and nothing
  says a CLI can read them. So the handoff is the platform's own "take control" path, plus a
  file only the CLI's stdin reads.
- **The rejection latch protects the account.** If SII rejects a Clave, every unattended login
  for that RUT refuses without contacting SII (ADR-028). Lifting it is yours: in the takeover
  terminal, `sii auth unblock --rut <rut>`. The Bot's rules forbid it from running that, and an
  Auto-review rule backs that up.
- **Approval to file is yours, in three layers:**
  1. the Bot's protocol: you type `APRUEBO F29 <periodo> <rut> TOTAL <monto>` yourself;
  2. the CLI's `--confirm <total>` echo;
  3. the platform's "Ask first" card.

  The echo alone is not approval, because an agent can copy the total from the preview
  (ADR-029). That is why the first and third layers exist.
- **Residual risk, which you accept:**
  - The Grok Bot computer is **shared by all your Bots**, so another of your Bots could read the
    secrets folder. Keep SII work on this Bot only.
  - An agent that controls a machine can, in principle, read any secret on it, and anyone who
    compromises or prompt-injects it gets the full Clave. Use it only for accounts that are
    yours.
- **Persistence:** Grok Bot only guarantees `/workspace`. The CLI keeps its state in `~/.sii`,
  so the skill links `~/.sii → /workspace/.sii` and re-checks the link on every run. It also
  reinstalls the pinned CLI version if the computer was recycled.

## Keeping it current

`skill-sii.md` describes the CLI at the release it ships with. A PR that changes a command,
a flag or an error kind updates it in the same PR (see [the integrations index](../README.md)).
The Bot re-reads both skills at the new tag when it upgrades.

## Sources (Grok Bot, read 2026-10-19)

- [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations): skills as
  reusable instructions with approval boundaries; routines with schedules, time zone, up to 50
  per Bot.
- [Approvals, security and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy):
  "Do not send a password or one-time code in ordinary chat"; Take over / Take control; masked
  secret requests for supported connections; Auto-review "Ask first" rules; approvals for
  unattended work expire after about 10 minutes.
- [Computer and apps](https://docs.x.ai/grok-bot/computer-and-apps): the shared cloud computer,
  `/workspace` as durable storage, command-line credentials shared across Bots.
