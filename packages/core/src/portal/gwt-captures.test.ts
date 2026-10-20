// A PRIVATE check of the protocol-7 codec against a real rfiInternet capture (spike #138). The
// captures carry an empresa's data, so they live outside the repo; this suite runs only when
// SII_F29_CAPTURES points at a capture's `bodies/` directory (the request/response files plus the
// permutation `.cache.html` body), and is skipped otherwise, like any live test. It prints counts
// and method names only, never values.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Gwt7Codec, type Gwt7Node, parseGwtPermutation } from './gwt.js';
import { RFI_READ_LAYOUT, RFI_WRITE_LAYOUT } from './rfi-schema.js';

const dir = process.env['SII_F29_CAPTURES'];

describe.skipIf(!dir)('gwt protocol 7 against a private capture', () => {
  const files = dir ? readdirSync(dir).sort((a, b) => parseInt(a) - parseInt(b)) : [];
  const read = (f: string): string => readFileSync(join(dir!, f), 'utf8');
  const permFile = files.find((f) => f.endsWith('.res.txt') && read(f).includes("strongName = '"));
  const perm = parseGwtPermutation('capture', permFile ? read(permFile) : '');
  const codec = new Gwt7Codec(
    { write: RFI_WRITE_LAYOUT, read: RFI_READ_LAYOUT },
    perm.sigs,
    (m) => new Error(m),
  );
  const requests = files.filter((f) => f.endsWith('.req.txt') && read(f).startsWith('7|'));

  it('re-encodes every captured request byte for byte', () => {
    expect(requests.length).toBeGreaterThan(0);
    for (const f of requests)
      expect(codec.encodeRequest(codec.decodeRequest(read(f))), f).toBe(read(f));
  });

  it('decodes every captured //OK response with some declared return type', () => {
    const responses = files.filter((f) => f.endsWith('.res.txt') && read(f).startsWith('//OK'));
    for (const f of responses) {
      const ok = [undefined, 'java.lang.String', 'V', 'Z'].some((ret) => {
        try {
          codec.decodeResponse(read(f), ret);
          return true;
        } catch {
          return false;
        }
      });
      expect(ok, f).toBe(true);
    }
  });

  it("re-encodes guardarBorradorRfiValidado's Borrador as the inyectarBorradorRfi request", () => {
    const calls = requests.map((f) => ({ f, text: read(f), call: codec.decodeRequest(read(f)) }));
    const guardar = calls.find((c) => c.call.method === 'guardarBorradorRfiValidado');
    const inyectar = calls.find((c) => c.call.method === 'inyectarBorradorRfi');
    if (!guardar || !inyectar) return; // a capture without the filing (run5 blocked it)
    const borrador = files
      .filter((f) => f.endsWith('.res.txt') && parseInt(f) > parseInt(guardar.f))
      .map((f) => {
        try {
          return codec.decodeResponse(read(f)) as Gwt7Node | null;
        } catch {
          return null;
        }
      })
      .find((r) => r?.cls === 'cl.sii.sdi.dim.rfi.to.Borrador');
    expect(borrador).toBeDefined();
    const rebuilt = codec.encodeRequest({
      ...inyectar.call,
      params: [{ type: inyectar.call.params[0]!.type, value: borrador! }],
    });
    expect(rebuilt).toBe(inyectar.text);
  });
});
