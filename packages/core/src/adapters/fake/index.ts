// In-memory fakes for tests — never touch the real SII / fs / clock.
import type {
  AuditEntry,
  AuditSink,
  Clock,
  CredentialLoginOptions,
  InteractiveLoginOptions,
  JsonRequest,
  KeyValueStore,
  PortalDriver,
  PortalSession,
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
  /** Result for `evaluate(expression)`. */
  evaluate?: (expression: string) => unknown;
  /** Result for `requestJson(url, options)` — the SDI facade JSON envelope. */
  requestJson?: (url: string, options?: JsonRequest) => unknown;
  /** Cookie name → value map for `cookie(url, name)`. */
  cookies?: Record<string, string>;
  storageState?: unknown;
}

export class FakePortalSession implements PortalSession {
  closed = false;
  /** The last requestJson call — lets a test assert the URL/body sent to SII. */
  lastRequest: { url: string; options?: JsonRequest } | null = null;
  constructor(private readonly script: FakeSessionScript = {}) {}
  async goto(url: string): Promise<string> {
    return this.script.landingUrl ?? url;
  }
  async evaluate<T>(expression: string): Promise<T> {
    return (this.script.evaluate?.(expression) ?? null) as T;
  }
  async requestJson(url: string, options?: JsonRequest): Promise<unknown> {
    this.lastRequest = options ? { url, options } : { url };
    return this.script.requestJson?.(url, options) ?? null;
  }
  async cookie(_url: string, name: string): Promise<string | null> {
    return this.script.cookies?.[name] ?? null;
  }
  async storageState(): Promise<unknown> {
    return this.script.storageState ?? { cookies: [] };
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
}
