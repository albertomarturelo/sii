# ADR-022: Binary download seam + document output contract (F29 PDFs)

## Status

Accepted — 2026-08-31. Scopes the F29 PDF read surface (#80, spike result in
`docs/sii-contract/f29-pdf.md`). Builds on ADR-003 (injectable seams; surfaces call
tasks only), ADR-004 (first-hand observation, verbatim errors, audit), ADR-005
(session-keyed F29), ADR-006 (secrets + PII never reach the LLM), ADR-016 (pure main
barrel, `./node` composition root). **Amends ADR-012** (JSON is the default output) for
the document case.

## Context

The #80 spike established that a filed F29 exposes two PDF artifacts —
`rfiInternet/formCompacto` and `rfiInternet/formSolemne` — as plain **authenticated GET
servlets** keyed by `folio` + `codInt`, and that `codInt` is the `codigo` field the
already-shipped Fase-1 estado facade returns. A cold Node `fetch` carrying the session's
`.sii.cl` cookies retrieves them (verified: `application/pdf`, ~34 KB / ~42 KB, `%PDF-`).

Nothing in the codebase can carry those bytes:

1. **Every portal primitive returns decoded text.** `requestJson` parses JSON and treats
   anything else as a login wall; `requestForm`, `requestText` and `requestPublic` all
   resolve `{status, body: string}` where `body` is charset-decoded. Decoding a PDF as
   text is lossy and irreversible — the bytes would be corrupted before the facade sees
   them.
2. **ADR-012 says a task returns a JSON-serializable object.** A PDF is not one. The rule
   exists so the core stays a clean library contract for both surfaces; a document must
   not silently break it.
3. **The core's main barrel must stay pure** (ADR-016): it may not import `node:fs` at
   import time, so a task cannot simply write the file itself.

These PDFs are **PII-dense**: razón social, dirección, comuna, the full código grid and
the taxpayer's financial position, plus (on the solemne) a certificate naming the
contribuyente. ADR-006 keeps that out of the LLM and out of the audit log — which
directly constrains what an MCP tool may return.

Two failure modes observed that a naive implementation gets wrong: **SII answers HTTP
`200` for a wrong `codInt` (HTML error page) and for a dead cookie jar (redirect to the
`zeusr.sii.cl` login wall)**. Status code is not a success signal here.

## Decision

### 1. A binary primitive on `PortalSession`

```ts
export interface BinaryRequest {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: string;
}
export interface BinaryResponse {
  readonly status: number;
  /** Raw `content-type` header, verbatim (e.g. `application/pdf`). */
  readonly contentType: string | null;
  /** Undecoded response body. `Uint8Array` keeps the pure barrel Node-free. */
  readonly bytes: Uint8Array;
}
interface PortalSession {
  // …goto / evaluate / requestJson / requestForm / requestText / cookie / storageState…
  /** Issue an authenticated request from the session and return the body UNDECODED.
   *  The primitive behind document downloads (F29 PDFs, ADR-022). Login-wall detection
   *  is URL-based (final URL on `LOGIN_HOST`) → `SessionExpiredError`, since a non-text
   *  body is expected. */
  requestBinary(url: string, options?: BinaryRequest): Promise<BinaryResponse>;
}
```

It belongs on `PortalSession` (authenticated, cookie-bearing), not `PortalDriver` — the
mirror of `requestText` (ADR-020). `Uint8Array`, not `Buffer`, so the pure barrel stays
free of `node:` types.

**The adapter follows redirects and reports the final host**; landing on `LOGIN_HOST`
raises `SessionExpiredError` before any bytes are returned.

### 2. A `FileSink` seam for writing

```ts
export interface FileSink {
  /** Write `bytes` to `<dir>/<name>`, creating `dir` if needed. Returns the absolute
   *  path written. Overwrites: the name is deterministic, so a re-download is a refresh. */
  write(dir: string, name: string, bytes: Uint8Array): Promise<string>;
}
```

`Runtime.files` is **optional**, like `secrets` — only document-producing tasks need it, so
an embedded consumer injecting its own seams (ADR-016) is not forced to supply one; a task
that needs it and finds it missing raises an actionable error. `createNodeRuntime` always
wires the default.

Default `NodeFileSink` in `adapters/node/` (`fs/promises`, `mkdir -p`, file mode
**`0600`** — these are PII documents), injected by `createNodeRuntime`. Tests substitute
an in-memory fake and never touch the filesystem. Writing is an external dependency like
any other (ADR-003); the task must not import `node:fs`.

### 3. The document output contract (amends ADR-012)

**A task that produces a document writes the bytes through `FileSink` and returns a
JSON-serializable descriptor — never the bytes, and never base64.**

```ts
interface DocumentoDescargado {
  readonly tipo: 'compacto' | 'solemne';
  readonly path: string;      // absolute path written
  readonly archivo: string;   // basename
  readonly bytes: number;     // size on disk
  readonly contentType: string;
  readonly periodo: string;
  readonly folio: number;
  readonly rut: string;
}
```

ADR-012's intent — the core returns plain JSON objects both surfaces can render — is
preserved: the *result* is still JSON, the payload just lands on disk. Base64 is
explicitly rejected (see Alternatives).

**Filename** — composed by us, since SII's `Content-Disposition` is generic
(`pdfFormularioCompactoV2.pdf`, no folio):
`f29-<periodo>-<tipo>-<folio>.pdf`, e.g. `f29-202605-compacto-9999999999.pdf`.
Deterministic, sorts chronologically, and unambiguous when a período holds several folios.

**Default destination**: `~/.sii/documentos`. The pure core cannot know the user's home, so
`directorio` is a REQUIRED task argument and each SURFACE applies the default from
`DOCUMENTOS_DIR` (exported from the `./node` subpath) — keeping the barrel Node-free
(ADR-016). Both surfaces accept an explicit destination (`--out <dir>` on the CLI,
`directorio` on MCP); a leading `~` is expanded and the path resolved to absolute by the
`NodeFileSink`.

### 4. Success + error detection

A response counts as a document only when **`content-type` is `application/pdf` AND the
body starts with the `%PDF-` magic**. Otherwise:

- final host is `LOGIN_HOST` → `SessionExpiredError` ("re-login").
- body is HTML → decode it (ISO-8859-1) and surface **SII's message verbatim** (ADR-004),
  e.g. `Ha ocurrido un Error al generar documento PDF / No está autorizado para realizar
  esta acción.` Never retried.

HTTP status is never treated as a success signal.

### 5. Surface posture

- **Session-keyed** (ADR-005): F29 authorizes by the session principal. No `--rut`; a
  representing operate pointer is rejected up front, as with the other F29 verbs.
- **CLI**: `sii f29 pdf <periodo> [--tipo compacto|solemne|ambos] [--out <dir>]
  [--folio <n>]`. Emits the descriptor as JSON by default, `--human` for a readable line
  (ADR-012). `--folio` targets one declaración when a período has several; the default is
  the vigente one.
- **MCP**: `f29_pdf` (`periodo`, `tipo`, `directorio`, `folio`), `readOnlyHint`. It
  returns the **descriptor only**; Claude Desktop shows the model where the file landed,
  and the human opens it. The tool description states that the file contains tax PII and
  that its contents are deliberately not returned.
- **Audit**: `{action:'f29_pdf', rut, periodo, folio, tipo, bytes, result}`. The
  destination path is NOT audited (it can encode user-chosen directory names) and the
  document contents never are.

## Alternatives Considered

- **Return base64 bytes from the task / MCP tool.** Rejected on two independent grounds:
  it puts a PII-dense tax document straight into the model's context (ADR-006), and a
  ~34 KB PDF is ~46 KB of base64 — tens of thousands of tokens per call, for content no
  model needs to read. The user wants the *file*, not its bytes in a chat transcript.
- **Widen `requestText`/`PublicResponse` with an optional `bytes` field.** Rejected: it
  makes every text caller carry a field it must ignore, and invites decoding a binary body
  as text by accident. A distinct primitive states the intent at the type level.
- **Let the task call `node:fs` directly.** Rejected: it breaks the pure main barrel
  (ADR-016), makes the write untestable without a real filesystem, and puts an external
  dependency outside the seam layer (ADR-003).
- **Drive the download through the browser (Playwright download event).** Rejected: it
  needs a headed/downloads-configured context and a warm SPA, when the spike proved a cold
  cookie-bearing GET suffices. It would also re-import the Fase-2 fragility this surface
  specifically avoids.
- **Reuse the `rfiInternet` GWT app's `formCompleto` view.** Rejected: it bounces a live
  session to the login wall without the SPA warm-up chain (observed) — that is ADR-013's
  deferred Fase 2, and it yields HTML, not a PDF.

## Consequences

- The core gains its first **binary** I/O path and its first **filesystem-writing** seam.
  Both are narrow and injectable; the fakes keep tests off the disk and off SII.
- `DeclaracionEstadoF29.codigo` stops being dead data — it becomes the authorization token
  for downloads. Its meaning must be documented where it is parsed, so it is not "cleaned
  up" as unused.
- The document contract is reusable: F22, BTE and DTE PDFs (and any future certificate)
  should follow this exact shape rather than inventing a second one. It is written up in
  `docs/CONVENTIONS.md` as the pattern to mirror.
- MCP gains a tool whose *effect* is a file on the user's disk while its *return* stays
  small — a shape worth repeating for any future document surface.
- A wrong `codInt` and an expired session are now distinguishable to the user, because
  detection is content-based rather than status-based.
