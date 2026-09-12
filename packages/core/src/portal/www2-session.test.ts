import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import type { PublicResponse } from '../seams/index.js';
import { NotAuthenticatedError, Www2SessionError } from '../errors/index.js';
import { readWww2Session } from './www2-session.js';

// Synthetic data only (no SII, no real PII): userId 20000042-0.
const USER_ID = '20000042-0';
// The observed session JSON shape (2026-09-12), synthetic values.
const STATUS_OK = JSON.stringify({
  seconds: 5999,
  userId: USER_ID,
  userProfiles: ['00000'],
  userAuthType: 'CT',
  authTime: 1789000000000,
  userRte: USER_ID,
});
const PAGE = 'https://www2.sii.cl/carpetatributaria/generarcteregular';

const scripted = (status: PublicResponse | string) =>
  new FakePortalSession({ requestText: () => status });

describe('www2 app-session read (fake session, no SII)', () => {
  it('GETs /app/session/status with originalUrl + Referer, via requestText, and returns {userId}', async () => {
    const session = scripted(STATUS_OK);
    const app = await readWww2Session(session, PAGE);
    expect(app).toEqual({ userId: USER_ID, userAuthType: 'CT' });
    const req = session.lastTextRequest!;
    expect(req.url).toBe(
      'https://www2.sii.cl/app/session/status?originalUrl=https%3A%2F%2Fwww2.sii.cl%2Fcarpetatributaria%2Fgenerarcteregular',
    );
    expect(req.options?.method).toBe('GET');
    expect(req.options?.headers?.Referer).toBe(PAGE);
    expect(session.lastRequest).toBeNull(); // never touches an app API
  });

  it('works without originalUrl (observed: same answer), then sends no Referer', async () => {
    const session = scripted(STATUS_OK);
    await readWww2Session(session);
    expect(session.lastTextRequest!.url).toBe('https://www2.sii.cl/app/session/status');
    expect(session.lastTextRequest!.options?.headers?.Referer).toBeUndefined();
  });

  it('a numeric userId is stringified (the path key is verbatim text)', async () => {
    const app = await readWww2Session(scripted(JSON.stringify({ userId: 20000042 })));
    expect(app).toEqual({ userId: '20000042', userAuthType: null });
  });

  it('a bare 401 (the classic cookies-only session — observed) is Www2SessionError, a NotAuthenticated', async () => {
    const err = await readWww2Session(scripted({ status: 401, body: '' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Www2SessionError);
    expect(err).toBeInstanceOf(NotAuthenticatedError);
    expect((err as Error).message).toContain('HTTP 401');
    expect((err as Error).message).toContain('sii auth login --www2');
  });

  it('a 200 that is the SPA shell HTML (a cold hit) is "no session" too, never a parse crash', async () => {
    await expect(readWww2Session(scripted('<!doctype html><html lang="es">…'))).rejects.toThrow(
      /sin JSON de sesión/,
    );
  });

  it('a 200 JSON without userId is "no session" (the id keys every API path)', async () => {
    await expect(readWww2Session(scripted(JSON.stringify({ seconds: 1 })))).rejects.toBeInstanceOf(
      Www2SessionError,
    );
  });
});
