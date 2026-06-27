import { describe, it, expect } from 'vitest';
import { recordAudit } from './audit';
import { FixedClock, RecordingAuditSink } from '../adapters/fake/index';

describe('recordAudit', () => {
  it('stamps ts and drops secret-substring keys', () => {
    const clock = new FixedClock(new Date('2026-06-27T00:00:00Z'));
    const audit = new RecordingAuditSink();

    recordAudit(
      { clock, audit },
      {
        action: 'auth_login',
        result: 'ok',
        rut: '20000042-0',
        password: 'drop-me',
        sessionToken: 'drop-me',
        cookieJar: 'drop-me',
      },
    );

    const e = audit.entries[0]!;
    expect(e.ts).toBe('2026-06-27T00:00:00.000Z');
    expect(e.action).toBe('auth_login');
    expect(e.rut).toBe('20000042-0');
    expect(e.password).toBeUndefined();
    expect(e.sessionToken).toBeUndefined();
    expect(e.cookieJar).toBeUndefined();
  });
});
