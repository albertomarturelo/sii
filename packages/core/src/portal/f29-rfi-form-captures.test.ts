// A PRIVATE check of the F29 form interpreter against a real filing capture (spike #138). The
// capture carries an empresa's data, so it lives outside the repo; this suite runs only when
// SII_F29_CAPTURES points at a capture's `bodies/` directory, and is skipped otherwise. It asserts
// codes and byte equality only, never values.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Gwt7Codec, type Gwt7Node, parseGwtPermutation } from './gwt.js';
import { fillF29Form } from './f29-rfi-form.js';
import { RFI_READ_LAYOUT, RFI_WRITE_LAYOUT } from './rfi-schema.js';

const dir = process.env['SII_F29_CAPTURES'];

describe.skipIf(!dir)('the F29 form interpreter against a private capture', () => {
  it('fills the received layout into exactly the request the browser sent to validate', () => {
    const files = readdirSync(dir!).sort((a, b) => parseInt(a) - parseInt(b));
    const read = (f: string): string => readFileSync(join(dir!, f), 'utf8');
    const permFile = files.find(
      (f) => f.endsWith('.res.txt') && read(f).includes("strongName = '"),
    );
    const codec = new Gwt7Codec(
      { write: RFI_WRITE_LAYOUT, read: RFI_READ_LAYOUT },
      parseGwtPermutation('capture', permFile ? read(permFile) : '').sigs,
      (m) => new Error(m),
    );
    let received: Gwt7Node | undefined;
    for (const f of files.filter((f) => f.endsWith('.res.txt'))) {
      const t = read(f);
      if (!t.startsWith('//OK') || t.length < 300_000) continue;
      try {
        const r = codec.decodeResponse(t) as Gwt7Node;
        if (r.cls.endsWith('FormularioLayoutTO')) {
          received = r;
          break;
        }
      } catch {
        /* not the layout */
      }
    }
    const validation = files
      .filter((f) => f.endsWith('.req.txt'))
      .map(read)
      .find((t) => t.startsWith('7|') && t.includes('|getBorradorRfiValidado|'));
    expect(received, 'findVersionBorradorById response').toBeDefined();
    expect(validation, 'getBorradorRfiValidado request').toBeDefined();

    // The propuesta screen (run5/run6, filled 2026-10-18) or the customizado one of a sin
    // movimiento filing (run3, 2026-10-29, #221); a rule reads the current month.
    const customizado = files
      .filter((f) => f.endsWith('.req.txt'))
      .some((f) => read(f).includes('|findVersionFormularioPrimitivaByPeriodo|'));
    const { cambios, reglasFallidas } = fillF29Form(
      received!,
      new Date(customizado ? '2026-10-29T00:10:00-03:00' : '2026-10-18T21:00:00-03:00'),
      customizado ? 'customizado' : 'propuesta',
    );
    expect(reglasFallidas).toEqual([]);
    expect(cambios.map((c) => c.codigo).sort()).toEqual(
      (customizado
        ? ['543', '547', '573', '598', '755', '774', '8859']
        : ['537', '543', '547', '573', '598', '755', '77', '773', '774', '778']
      ).sort(),
    );
    const call = codec.decodeRequest(validation!);
    const rebuilt = codec.encodeRequest({
      ...call,
      params: call.params.map((p, k) => (k === 5 ? { ...p, value: received! } : p)),
    });
    expect(rebuilt === validation).toBe(true); // byte for byte, without printing either
  });
});
