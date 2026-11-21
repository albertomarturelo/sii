# Reporting an issue on sii

How to tell whether something deserves an issue on
[albertomarturelo/sii](https://github.com/albertomarturelo/sii), and how to draft it without
leaking the user's tax data. It serves two readers (ADR-037):

- **A model using the sii MCP.** It only recommends. It drafts and the user publishes. Talk to the
  user in their own language.
- **A model working in the repo** (`issue-propose` skill). It reads this file first, then applies
  that skill's repo-only gates.

## Worth an issue

- **A sii bug**: a tool returns a kind classed `likely bug` below, or a `suspect` one whose
  condition holds.
- **A missing capability**: the user needs something from SII that no tool does, and it is not a
  non-goal (below). Describe the user's task, not an implementation.

Not worth an issue: a failure the user can fix (log in again, install Chromium, wait out a rate
limit), SII being down, a question about tax law, or anything already reported (search first).

## Error kinds

Every tool error carries a stable `type` (ADR-012). Branch on it, never on the message text.

| type | class | why |
| --- | --- | --- |
| `login_rejected` | not a sii bug | SII judged the Clave and refused it. Never suggest retrying: failed logins lock the account. |
| `login_blocked` | not a sii bug | SII blocked the account, or the local rejection latch is set. A person must act. |
| `login_queued` | not a sii bug | SII put the login in a queue. Wait and try later. |
| `login_failed` | suspect | The login failed without SII judging the Clave. Report it only if the user then logs in fine on SII's own page. Never retry to find out. |
| `not_authenticated` | not a sii bug | No session. The user logs in (`auth_login`). |
| `session_expired` | suspect | Normally the session just ended: log in again. A bug if it appears right after a fresh login. |
| `www2_session_required` | not a sii bug | The surface needs the second session layer: `auth_login` with `www2`. |
| `rate_limited` | not a sii bug | SII is limiting requests. Never retry; wait. |
| `validation` | suspect | Usually the input is wrong. A bug only if SII's own site accepts the same input. |
| `credential_not_found` | not a sii bug | The CLI found no Clave in the OS keyring. Setup, not a bug. |
| `browser_required` | not a sii bug | The surface needs Chromium: `npx playwright install chromium`. |
| `unexpected_response` | likely bug | SII answered something sii does not understand; SII may have changed a page or format. |
| `sii_error` | suspect | SII refused the operation. A bug if SII's own site does the same thing fine, or if the session was old (a dead session once read as `sii_error`, #287). |
| `network` | not a sii bug | The connection failed. Check the network and try once more. |
| `aborted` | not a sii bug | The caller cancelled the call. |
| `unexpected` | likely bug | sii could not classify the error at all. |

## Non-goals (do not propose them)

Previred or any institution other than SII; multi-tenant or SaaS use; holding a third party's
Clave; SII's certification sandbox; third-party SII libraries; emitting facturas through the
Portal MIPYME (sii writes borradores only, ADR-023); a password argument on any MCP tool.

## Redaction — the hard rule

The issue is public the moment it exists, and its edit history keeps whatever it ever said.

- **Describe the shape, never the values.** « the row has no `monto` field », not the amount.
- **Never include:** a RUT (the user's or anyone's), nombre or razón social, dirección, email,
  teléfono, monto, folio, período or date tied to the account, rol of a predio, a session cookie,
  SII's raw response, or which months were filed or empty.
- **Allowed:** the sii package version, the tool name, argument NAMES (not their values), the error
  `type`, whether the user operates as self or as a represented empresa, the OS and client.
- **SII's message** may quote data. Paraphrase it, or omit it if unsure.
- When an example value helps, use an obviously synthetic one (RUT `11.111.111-1`).

## Draft

A bug follows the repo's `bug_report` template:

```markdown
**Title:** fix: <tool> returns <type> when <condition, no values>

## What happened
## Steps to reproduce
## Expected
## Actual        (the `type`, the paraphrased message)
## Environment   (sii version, MCP client, OS; session fresh or old)
## Notes
```

A missing capability follows `feature_request`: Problem / use case, Proposed solution (what the
user would ask for, not code), SII surface, Alternatives considered, Notes.

## Hand it to the user

1. Show the draft and say what you left out and why.
2. Give the duplicate search first:
   `https://github.com/albertomarturelo/sii/issues?q=is%3Aissue+<tool>+<type>`
3. Then the template link, for the user to paste the draft into:
   `https://github.com/albertomarturelo/sii/issues/new?template=bug_report.md` (or
   `feature_request.md`). Never put the draft in the URL.

The user publishes. Over the MCP a model never opens an issue itself.
