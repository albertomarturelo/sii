import { describe, it, expect } from 'vitest';
import { makeRuntime, run } from '../test-helpers.js';

describe('sii operate command (fake runtime, no SII)', () => {
  it('operate with no argument reports the current context', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate');
    expect(out).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate --self reports operating as self', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate', '--self');
    expect(out).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate <rut> validates against the operable set (self is operable)', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate', '11111111-1');
    expect(out).toContain('Operando como tú mismo: 11.111.111-1.');
  });

  it('operate --list lists the operable set with markers', async () => {
    const rt = makeRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'operate', '--list');
    expect(out).toContain('11.111.111-1');
    expect(out).toContain('tú mismo');
    expect(out).toContain('operando ahora');
  });

  it('operate --list without a session says so', async () => {
    const out = await run(makeRuntime(), 'operate', '--list');
    expect(out).toContain('No hay sesión activa.');
  });
});
