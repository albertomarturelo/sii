// In-memory fakes for tests — never touch the real SII / fs / clock.
import { HOSTS } from '../../config/index.js';
import { writeSession } from '../../auth/session.js';
import { initOperateState } from '../../identity/index.js';
import type { AccountType } from '../../identity/index.js';
import type {
  AuditEntry,
  AuditSink,
  BinaryRequest,
  BinaryResponse,
  Clock,
  CredentialLoginOptions,
  FormRequest,
  InteractiveLoginOptions,
  JsonRequest,
  FileSink,
  KeyValueStore,
  PortalDriver,
  PortalSession,
  PublicRequest,
  PublicResponse,
  Runtime,
  SecretStore,
  TextRequest,
} from '../../seams/index.js';

export class FixedClock implements Clock {
  /** Each `sleep(ms)` is recorded (not awaited) so a test can assert pacing without
   *  actually waiting. */
  readonly slept: number[] = [];
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(d: Date): void {
    this.current = d;
  }
  sleep(ms: number): Promise<void> {
    this.slept.push(ms);
    return Promise.resolve();
  }
}

export class RecordingAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): void {
    this.entries.push(entry);
  }
}

export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, string>();
  async read<T>(key: string): Promise<T | null> {
    const raw = this.data.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }
  async write<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export interface FakeSessionScript {
  /** URL the session "lands on" after goto (defaults to the requested URL). */
  landingUrl?: string;
  /** Per-URL landing, consulted before `landingUrl`; `undefined` falls through. Lets a test
   *  script server state that changes mid-test (a logout that kills the session, #135). */
  gotoLanding?: (url: string) => string | undefined;
  /** Result for `evaluate(expression)`. */
  evaluate?: (expression: string) => unknown;
  /** The Mi SII identity snapshot (`DatosCntrNow`). Since ADR-027 the auth flows read identity
   *  from the Mi SII HTML (not `evaluate`), so the fake synthesises that HTML for a
   *  `requestText(HOSTS.miSii)` from this — falling back to `evaluate` so pre-ADR-027 fixtures
   *  (`evaluate: datos`) keep working untouched. */
  datos?: () => unknown;
  /** Result for `requestJson(url, options)` — the SDI facade JSON envelope. */
  requestJson?: (url: string, options?: JsonRequest) => unknown;
  /** Result for `requestForm(url, options)` — an authenticated form-POST (BHE emit,
   *  ADR-017). Return the decoded body string (status 200) or a full PublicResponse. */
  requestForm?: (url: string, options?: FormRequest) => PublicResponse | string;
  /** Result for `requestText(url, options)` — an authenticated raw-body request (GWT-RPC
   *  reads, ADR-020). Return the decoded body string (status 200) or a full PublicResponse;
   *  `undefined` defers to the fake's default (incl. the Mi SII identity synthesis, ADR-027). */
  requestText?: (url: string, options?: TextRequest) => PublicResponse | string | undefined;
  /** Result for `requestBinary(url, options)` — an authenticated download (F29 PDFs,
   *  ADR-022). Return the raw bytes (content-type defaults to `application/pdf`) or a
   *  full BinaryResponse to script an error page / odd content-type. */
  requestBinary?: (url: string, options?: BinaryRequest) => BinaryResponse | Uint8Array;
  /** Cookie name → value map for `cookie(url, name)`. */
  cookies?: Record<string, string>;
  /** The cookies-only state `storageState()` returns; a FUNCTION is called on every read, so a
   *  test can script a jar that GAINS cookies mid-session (the `--www2` step, ADR-026). */
  storageState?: unknown | (() => unknown);
}

export class FakePortalSession implements PortalSession {
  closed = false;
  /** The last requestJson call — lets a test assert the URL/body sent to SII. */
  lastRequest: { url: string; options?: JsonRequest } | null = null;
  /** Every URL passed to goto, in order — lets a goto/evaluate facade (BTE) assert
   *  navigation + pagination without a real browser. */
  readonly gotos: string[] = [];
  constructor(private readonly script: FakeSessionScript = {}) {}
  async goto(url: string): Promise<string> {
    this.gotos.push(url);
    return this.script.gotoLanding?.(url) ?? this.script.landingUrl ?? url;
  }
  async evaluate<T>(expression: string): Promise<T> {
    return (this.script.evaluate?.(expression) ?? null) as T;
  }
  async requestJson(url: string, options?: JsonRequest): Promise<unknown> {
    this.lastRequest = options ? { url, options } : { url };
    return this.script.requestJson?.(url, options) ?? null;
  }
  /** The last requestForm call — lets a test assert the emit form fields sent to SII. */
  lastFormRequest: { url: string; options?: FormRequest } | null = null;
  async requestForm(url: string, options?: FormRequest): Promise<PublicResponse> {
    this.lastFormRequest = options ? { url, options } : { url };
    const r = this.script.requestForm?.(url, options);
    if (r === undefined) return { status: 200, body: '' };
    return typeof r === 'string' ? { status: 200, body: r } : r;
  }
  /** The last requestText call — lets a test assert the GWT-RPC body/URL sent to SII. */
  lastTextRequest: { url: string; options?: TextRequest } | null = null;
  async requestText(url: string, options?: TextRequest): Promise<PublicResponse> {
    this.lastTextRequest = options ? { url, options } : { url };
    const r = this.script.requestText?.(url, options);
    if (r !== undefined) return typeof r === 'string' ? { status: 200, body: r } : r;
    // Synthesise the Mi SII identity HTML (ADR-027): the auth flows now read `DatosCntrNow`
    // from the landing's HTML, so a login/whoami/status fixture that set `datos` (or the older
    // `evaluate: datos`) still serves identity without being rewritten.
    if (url === HOSTS.miSii) {
      // Pass a DatosCntrNow-flavoured expression so a fixture that branches its `evaluate` on the
      // expression (the pre-ADR-027 `evaluate: (e) => e.includes('DatosCntrNow') ? … : …` style)
      // returns the identity branch, not a map/else branch.
      const d = this.script.datos?.() ?? this.script.evaluate?.('DatosCntrNow');
      if (d !== undefined && d !== null) {
        return { status: 200, body: `<script>var DatosCntrNow = ${JSON.stringify(d)};</script>` };
      }
    }
    return { status: 200, body: '' };
  }
  /** The last requestBinary call — lets a test assert the download URL sent to SII. */
  lastBinaryRequest: { url: string; options?: BinaryRequest } | null = null;
  async requestBinary(url: string, options?: BinaryRequest): Promise<BinaryResponse> {
    this.lastBinaryRequest = options ? { url, options } : { url };
    const r = this.script.requestBinary?.(url, options);
    if (r === undefined) return { status: 200, contentType: null, bytes: new Uint8Array() };
    return r instanceof Uint8Array ? { status: 200, contentType: 'application/pdf', bytes: r } : r;
  }
  async cookie(_url: string, name: string): Promise<string | null> {
    return this.script.cookies?.[name] ?? null;
  }
  async storageState(): Promise<unknown> {
    const s = this.script.storageState;
    return (typeof s === 'function' ? (s as () => unknown)() : s) ?? { cookies: [] };
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

export interface FakeDriverScript {
  loginSession?: FakeSessionScript | (() => FakeSessionScript);
  credentialSession?: FakeSessionScript | (() => FakeSessionScript);
  restoreSession?: FakeSessionScript | (() => FakeSessionScript);
  /** When set, interactiveLogin rejects with this (simulate timeout / window close). */
  failLogin?: Error;
  /** When set, credentialLogin rejects with this (simulate bad Clave / lock / timeout). */
  failCredentialLogin?: Error;
  /** Result for `requestPublic(url, options)` — a public (unauthenticated) consulta.
   *  Return the decoded body string (status defaults to 200) or a full PublicResponse. */
  requestPublic?: (url: string, options?: PublicRequest) => PublicResponse | string;
  /** When set, requestPublic rejects with this (simulate a network / CGI failure). */
  failPublic?: Error;
}

export class FakePortalDriver implements PortalDriver {
  interactiveLoginCalls = 0;
  credentialLoginCalls = 0;
  restoreCalls = 0;
  /** The last RUT + Clave passed to credentialLogin — lets a test assert the Clave
   *  reached the driver but was NOT persisted anywhere (cookies-only, ADR-010). */
  lastCredential: { rut: string; clave: string } | null = null;
  constructor(private readonly script: FakeDriverScript = {}) {}
  async interactiveLogin(_options: InteractiveLoginOptions): Promise<PortalSession> {
    this.interactiveLoginCalls++;
    if (this.script.failLogin) throw this.script.failLogin;
    const s =
      typeof this.script.loginSession === 'function'
        ? this.script.loginSession()
        : this.script.loginSession;
    return new FakePortalSession(s ?? {});
  }
  async credentialLogin(options: CredentialLoginOptions): Promise<PortalSession> {
    this.credentialLoginCalls++;
    this.lastCredential = { rut: options.rut, clave: options.clave };
    if (this.script.failCredentialLogin) throw this.script.failCredentialLogin;
    const s =
      typeof this.script.credentialSession === 'function'
        ? this.script.credentialSession()
        : this.script.credentialSession;
    return new FakePortalSession(s ?? {});
  }
  async restore(_storageState: unknown): Promise<PortalSession> {
    this.restoreCalls++;
    const s =
      typeof this.script.restoreSession === 'function'
        ? this.script.restoreSession()
        : this.script.restoreSession;
    return new FakePortalSession(s ?? {});
  }
  requestPublicCalls = 0;
  /** The last public request — lets a test assert the URL/form sent (no session). */
  lastPublicRequest: { url: string; options?: PublicRequest } | null = null;
  async requestPublic(url: string, options?: PublicRequest): Promise<PublicResponse> {
    this.requestPublicCalls++;
    this.lastPublicRequest = options ? { url, options } : { url };
    if (this.script.failPublic) throw this.script.failPublic;
    const r = this.script.requestPublic?.(url, options);
    if (r === undefined) return { status: 200, body: '' };
    return typeof r === 'string' ? { status: 200, body: r } : r;
  }
}

/** In-memory FileSink: records what would have been written, touching no filesystem.
 *  `files` maps the absolute path to the bytes, so a test asserts both destination and
 *  payload (ADR-022). */
export class InMemoryFileSink implements FileSink {
  readonly files = new Map<string, Uint8Array>();
  async write(dir: string, name: string, bytes: Uint8Array): Promise<string> {
    const path = `${dir.replace(/\/+$/, '')}/${name}`;
    this.files.set(path, bytes);
    return path;
  }
}

/** Seed an authenticated cookies-only session + operate state directly into a runtime's store
 *  — so a surface test that just needs "logged in as self" doesn't drive the login command
 *  (which, since ADR-027, prompts for a Clave on the CLI). Synthetic RUT, no SII touched. */
export async function seedSession(
  runtime: Runtime,
  opts: { rut?: string; accountType?: AccountType } = {},
): Promise<void> {
  const rut = opts.rut ?? '11111111-1';
  const accountType = opts.accountType ?? 'persona';
  await writeSession(runtime.store, {
    rut,
    cookies: { cookies: [] },
    savedAt: runtime.clock.now().toISOString(),
  });
  await initOperateState(runtime.store, {
    selfRut: rut,
    accountType,
    operable: [{ rut, razonSocial: rut, isSelf: true }],
  });
}

/** In-memory SecretStore: the keyring stand-in, so a test never reads the real one
 *  (ADR-003 / ADR-025). `entries` is keyed by account exactly as the keyring's username. */
export class InMemorySecretStore implements SecretStore {
  constructor(readonly entries: Map<string, string> = new Map()) {}
  readonly reads: string[] = [];
  async get(account: string): Promise<string | null> {
    this.reads.push(account);
    return this.entries.get(account) ?? null;
  }
  async set(account: string, secret: string): Promise<void> {
    this.entries.set(account, secret);
  }
  async delete(account: string): Promise<void> {
    this.entries.delete(account);
  }
}
