// Injectable seams (ADR-003): the external / non-deterministic dependencies the
// core reaches through interfaces. Node defaults live in adapters/node; in-memory
// fakes for tests live in adapters/fake. The core never imports Playwright, fs,
// or a keyring directly — only these interfaces.

export interface Clock {
  now(): Date;
  /** Pause for `ms` (the pacing primitive for multi-call fan-outs — rate-limit
   *  convention, ADR-004). Fakes resolve instantly so tests don't wait. */
  sleep(ms: number): Promise<void>;
}

/** One audit receipt line. The audit module stamps `ts` and drops secret keys. */
export interface AuditEntry {
  readonly action: string;
  readonly result: string;
  readonly rut?: string;
  readonly rutAuth?: string;
  readonly durationMs?: number;
  readonly [extra: string]: unknown;
}

export interface AuditSink {
  record(entry: AuditEntry): void;
}

/** Namespaced local JSON store. Modules use DISTINCT keys (ADR-007) so they never
 *  write the same file: `auth` → 'session', `identity` → 'operate'. */
export interface KeyValueStore {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/** OS secure storage for the optional credential path (ADR-006 / ADR-008).
 *  Declared now; no Node adapter until the keyring increment. */
export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/** A logged-in browser context (cookies loaded). All portal reads go through
 *  here, so the core never imports Playwright. */
export interface JsonRequest {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  /** JSON-serialisable request body (sent as the POST payload). */
  readonly body?: unknown;
}

export interface PortalSession {
  /** Navigate; returns the URL actually landed on (for URL-based auth detection). */
  goto(url: string): Promise<string>;
  /** Evaluate a JS expression in the page; returns its JSON-serialisable result. */
  evaluate<T>(expression: string): Promise<T>;
  /** Issue an authenticated JSON request from the session's browser context (the
   *  session cookies are sent automatically). The primitive behind the SII SPA
   *  JSON facades (the `www4.sii.cl` SDI endpoints — RCV, representación, …).
   *  Resolves the parsed JSON body; rejects on a non-JSON response. */
  requestJson(url: string, options?: JsonRequest): Promise<unknown>;
  /** Value of a cookie visible to `url` (e.g. the SPA conversation `TOKEN`), or
   *  null. Used to seed SDI request metadata. */
  cookie(url: string, name: string): Promise<string | null>;
  /** The cookies-only storage state to persist. */
  storageState(): Promise<unknown>;
  close(): Promise<void>;
}

export interface InteractiveLoginOptions {
  /** Post-login destination passed to the login URL. */
  readonly destination: string;
  /** Give up if the user hasn't landed off LOGIN_HOST within this budget (ms). */
  readonly timeoutMs: number;
}

export interface CredentialLoginOptions {
  /** Full RUT to type into the login form (`<body>-<DV>`); the page JS splits it. */
  readonly rut: string;
  /** The Clave Tributaria — used ONCE to fill the form, never persisted (ADR-010). */
  readonly clave: string;
  /** Post-login destination passed to the login URL. */
  readonly destination: string;
  /** Give up if we haven't landed off LOGIN_HOST within this budget (ms). */
  readonly timeoutMs: number;
}

export interface PortalDriver {
  /** Open a HEADED browser at the login URL; resolve with a session once the user
   *  lands off LOGIN_HOST. Rejects (LoginFailedError) on timeout / window close. */
  interactiveLogin(options: InteractiveLoginOptions): Promise<PortalSession>;
  /** HEADLESS console login (ADR-010): fill the real SII form with RUT + Clave and
   *  submit, resolving a session once landed off LOGIN_HOST. The Clave is used here
   *  and never stored (cookies-only result). CLI-only — never wired into MCP. */
  credentialLogin(options: CredentialLoginOptions): Promise<PortalSession>;
  /** Restore a (headless) session from persisted cookies for reads / liveness. */
  restore(storageState: unknown): Promise<PortalSession>;
}

/** The set of seams a task needs. The composition root (runtime.ts) builds it. */
export interface Runtime {
  readonly clock: Clock;
  readonly audit: AuditSink;
  readonly store: KeyValueStore;
  readonly portal: PortalDriver;
  readonly secrets?: SecretStore;
}
