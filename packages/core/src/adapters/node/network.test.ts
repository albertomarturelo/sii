import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import { asNetworkError, overNetwork } from './network.js';
import { HttpPortalDriver } from './http.js';
import { NetworkError, classifyError } from '../../errors/index.js';

const URL_WITH_QUERY = 'https://misiir.sii.cl/cgi_misii/siihome.cgi?rut=11111111';

/** The shape undici rejects with: a bare TypeError whose cause holds the reason. */
const fetchFailed = (cause: unknown): TypeError => new TypeError('fetch failed', { cause });
const sysError = (code: string, message: string): Error =>
  Object.assign(new Error(message), { code });

describe('asNetworkError (#215)', () => {
  it('keeps the cause code and message, and the host only (never the path or query)', () => {
    const e = asNetworkError(
      fetchFailed(
        sysError(
          'ECONNRESET',
          'Client network socket disconnected before secure TLS connection was established',
        ),
      ),
      URL_WITH_QUERY,
    );
    expect(e).toBeInstanceOf(NetworkError);
    expect(e).toMatchObject({ host: 'misiir.sii.cl', causa: 'ECONNRESET' });
    expect(e?.message).toContain(
      'Sin respuesta de misiir.sii.cl: ECONNRESET Client network socket',
    );
    expect(e?.message).not.toContain('siihome');
    expect(e?.message).not.toContain('11111111');
    expect(classifyError(e)).toEqual({ type: 'network' });
  });

  it('reads an AggregateError (every address failed) through its first error', () => {
    const agg = new AggregateError([sysError('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.1:443')]);
    expect(asNetworkError(fetchFailed(agg), URL_WITH_QUERY)).toMatchObject({
      causa: 'ECONNREFUSED',
    });
  });

  it('turns our timeout signal into TIMEOUT', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(asNetworkError(timeout, URL_WITH_QUERY)).toMatchObject({ causa: 'TIMEOUT' });
  });

  it('leaves anything that is not a transport failure alone (a bug stays `unexpected`)', () => {
    expect(asNetworkError(new TypeError('Invalid header value'), URL_WITH_QUERY)).toBeNull();
    expect(asNetworkError(new Error('boom'), URL_WITH_QUERY)).toBeNull();
  });

  it('bounds a long cause message to one readable line', () => {
    const e = asNetworkError(fetchFailed(sysError('EPROTO', 'x'.repeat(1000))), URL_WITH_QUERY);
    expect(e!.message.length).toBeLessThan(400);
  });

  it('overNetwork rethrows a non-network error unchanged', async () => {
    const bug = new RangeError('bug');
    await expect(overNetwork(URL_WITH_QUERY, () => Promise.reject(bug))).rejects.toBe(bug);
  });
});

describe('HttpPortalDriver over a TLS handshake reset (real fetch, local socket, #215)', () => {
  // What the contador bot's egress proxy did to one SII host: accept the TCP connection, then
  // drop it before TLS completes. A local server reproduces it with Node's own fetch, no SII.
  let server: Server;
  let port = 0;

  async function listen(): Promise<void> {
    server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : 0;
  }

  it('surfaces a NetworkError naming the host and the cause, not a bare "fetch failed"', async () => {
    await listen();
    try {
      const driver = new HttpPortalDriver();
      const err: unknown = await driver
        .requestPublic(`https://127.0.0.1:${port}/cgi`, { method: 'GET' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetworkError);
      expect(err).toMatchObject({ host: `127.0.0.1:${port}` });
      expect((err as NetworkError).causa).toMatch(/^E[A-Z]+$/);
    } finally {
      server.close();
    }
  });
});
