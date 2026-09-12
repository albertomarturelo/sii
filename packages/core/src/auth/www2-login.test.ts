import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FakePortalSession,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { Runtime } from '../seams/index.js';
import { LoginFailedError, SessionExpiredError } from '../errors/index.js';
import {
  WWW2_POLL_MS,
  mergeStorageState,
  waitForWww2Session,
  www2ExpiresAt,
} from './www2-login.js';

// Synthetic cookies only (names as observed, values invented) — no SII, no PII.
const classic = (name: string) => ({ name, domain: '.sii.cl', path: '/', value: 'c' });
const STATE_CT = { name: 'X-SII-STATE-CT', domain: '.sii.cl', path: '/', expires: 1789006000 };
const STATE_CL = { name: 'X-SII-STATE-CL', domain: '.sii.cl', path: '/', expires: 1789006000 };
const STATE_TYPE = { name: 'X-SII-STATE-TYPE', domain: '.sii.cl', path: '/', expires: -1 };
const STATUS_OK = JSON.stringify({ userId: '20000042-0', userAuthType: 'CT', seconds: 5999 });

describe('mergeStorageState (classic jar + www2 jar, ADR-026)', () => {
  it('keeps every classic cookie the OAuth page wiped, adds the www2 ones', () => {
    const before = { cookies: [classic('NETSCAPE_LIVEWIRE.rut'), classic('TOKEN')] };
    const after = {
      cookies: [STATE_CT, { name: 'X-SII-STATE-TYPE', domain: '.sii.cl', path: '/' }],
    };
    const merged = mergeStorageState(before, after) as { cookies: { name: string }[] };
    expect(merged.cookies.map((c) => c.name)).toEqual([
      'NETSCAPE_LIVEWIRE.rut',
      'TOKEN',
      'X-SII-STATE-CT',
      'X-SII-STATE-TYPE',
    ]);
  });

  it('on a same name+domain+path collision the www2 (fresher) value wins, without duplicating', () => {
    const before = { cookies: [{ ...classic('dtCookie'), value: 'old' }] };
    const after = { cookies: [{ ...classic('dtCookie'), value: 'new' }] };
    const merged = mergeStorageState(before, after) as { cookies: { value: string }[] };
    expect(merged.cookies).toHaveLength(1);
    expect(merged.cookies[0]!.value).toBe('new');
  });

  it('same name on a DIFFERENT domain/path is a different cookie (both kept)', () => {
    const before = { cookies: [classic('TS01')] };
    const after = { cookies: [{ name: 'TS01', domain: 'www2.sii.cl', path: '/' }] };
    expect((mergeStorageState(before, after) as { cookies: unknown[] }).cookies).toHaveLength(2);
  });

  it("tolerates the fakes' scalar entries and falls back when a side is not a cookie list", () => {
    expect(mergeStorageState({ cookies: ['a'] }, { cookies: ['b', 'a'] })).toEqual({
      cookies: ['a', 'b'],
    });
    expect(mergeStorageState('not-a-state', { cookies: ['b'] })).toEqual({ cookies: ['b'] });
    expect(mergeStorageState({ cookies: ['a'] }, null)).toEqual({ cookies: ['a'] });
  });
});

describe('www2ExpiresAt', () => {
  const ISO = new Date(1789006000 * 1000).toISOString();
  it('reads the expiry off any X-SII-STATE-* cookie (the suffix varies: -CT and -CL both seen)', () => {
    expect(www2ExpiresAt({ cookies: [classic('TOKEN'), STATE_CT] })).toBe(ISO);
    expect(www2ExpiresAt({ cookies: [classic('TOKEN'), STATE_CL] })).toBe(ISO);
  });
  it('a session-scoped -TYPE never masks the dated state cookie (takes the max)', () => {
    expect(www2ExpiresAt({ cookies: [STATE_TYPE, STATE_CL] })).toBe(ISO);
  });
  it('null when no X-SII-STATE-* cookie is present or all are session-scoped', () => {
    expect(www2ExpiresAt({ cookies: [classic('TOKEN')] })).toBeNull();
    expect(www2ExpiresAt({ cookies: [STATE_TYPE] })).toBeNull();
    expect(www2ExpiresAt('nope')).toBeNull();
  });
});

describe('waitForWww2Session (the headed OAuth step, fake session)', () => {
  const runtime = (clock: FixedClock): Runtime => ({
    clock,
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver(),
  });

  it('opens the www2 app page, polls the session read (paced) until the user completes the login', async () => {
    const clock = new FixedClock(new Date('2026-09-12T00:00:00Z'));
    let reads = 0;
    const session = new FakePortalSession({
      requestText: () => (++reads < 3 ? { status: 401, body: '' } : STATUS_OK),
    });
    const app = await waitForWww2Session(runtime(clock), session);
    expect(app.userId).toBe('20000042-0');
    expect(session.gotos).toEqual(['https://www2.sii.cl/carpetatributaria/generarcteregular']);
    expect(reads).toBe(3);
    expect(clock.slept).toEqual([WWW2_POLL_MS, WWW2_POLL_MS]); // paced via the Clock seam
  });

  it('gives up with LoginFailedError when the budget runs out (classic session untouched)', async () => {
    const clock = new FixedClock(new Date('2026-09-12T00:00:00Z'));
    const session = new FakePortalSession({
      requestText: () => {
        clock.set(new Date(clock.now().getTime() + 200_000)); // each read: +200 s
        return { status: 401, body: '' };
      },
    });
    await expect(waitForWww2Session(runtime(clock), session)).rejects.toThrow(LoginFailedError);
    await expect(waitForWww2Session(runtime(clock), session)).rejects.toThrow(/www2 no completado/);
  });

  it('propagates anything that is not "no app session yet" (a dead classic jar) unretried', async () => {
    const session = new FakePortalSession({
      requestText: () => {
        throw new SessionExpiredError('bounced to zeusr');
      },
    });
    await expect(
      waitForWww2Session(runtime(new FixedClock(new Date())), session),
    ).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
