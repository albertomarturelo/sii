// In-memory fakes for tests — never touch the real SII / fs / clock.
import type {
  AuditEntry,
  AuditSink,
  Clock,
  InteractiveLoginOptions,
  KeyValueStore,
  PortalDriver,
  PortalSession,
} from '../../seams/index';

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(d: Date): void {
    this.current = d;
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
  storageState?: unknown;
}

export class FakePortalSession implements PortalSession {
  closed = false;
  constructor(private readonly script: FakeSessionScript = {}) {}
  async goto(url: string): Promise<string> {
    return this.script.landingUrl ?? url;
  }
  async evaluate<T>(expression: string): Promise<T> {
    return (this.script.evaluate?.(expression) ?? null) as T;
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
  restoreSession?: FakeSessionScript | (() => FakeSessionScript);
  /** When set, interactiveLogin rejects with this (simulate timeout / window close). */
  failLogin?: Error;
}

export class FakePortalDriver implements PortalDriver {
  interactiveLoginCalls = 0;
  restoreCalls = 0;
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
  async restore(_storageState: unknown): Promise<PortalSession> {
    this.restoreCalls++;
    const s =
      typeof this.script.restoreSession === 'function'
        ? this.script.restoreSession()
        : this.script.restoreSession;
    return new FakePortalSession(s ?? {});
  }
}
