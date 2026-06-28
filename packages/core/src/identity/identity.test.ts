import { describe, it, expect } from 'vitest';
import { InMemoryKeyValueStore } from '../adapters/fake/index.js';
import {
  clearOperatingRut,
  formatOperableEntry,
  initOperateState,
  operatingContext,
  readOperateState,
  setOperatingRut,
  type OperableEntry,
} from './identity.js';
import { ValidationError } from '../errors/index.js';

const PERSONA = '20000042-0';
const EMPRESA = '77777777-7';
const OTRA = '12345670-K';

const personaOperable: OperableEntry[] = [
  { rut: PERSONA, razonSocial: 'Juan Pérez', isSelf: true },
  { rut: EMPRESA, razonSocial: 'Mi Empresa SpA', isSelf: false },
];

async function personaStore(): Promise<InMemoryKeyValueStore> {
  const store = new InMemoryKeyValueStore();
  await initOperateState(store, {
    selfRut: PERSONA,
    accountType: 'persona',
    operable: personaOperable,
  });
  return store;
}

describe('identity / operate', () => {
  it('defaults operatingRut to self on init', async () => {
    const store = await personaStore();
    const state = await readOperateState(store);
    expect(state).not.toBeNull();
    expect(operatingContext(state!).isSelf).toBe(true);
  });

  it('switches to a represented empresa in the operable set (any format)', async () => {
    const store = await personaStore();
    const state = await setOperatingRut(store, '77.777.777-7');
    const ctx = operatingContext(state);
    expect(ctx.operatingRut).toBe(EMPRESA);
    expect(ctx.isSelf).toBe(false);
    expect(ctx.razonSocial).toBe('Mi Empresa SpA');
  });

  it('rejects a RUT not in the operable set', async () => {
    const store = await personaStore();
    await expect(setOperatingRut(store, OTRA)).rejects.toBeInstanceOf(ValidationError);
  });

  it('an empresa account cannot operate as anything', async () => {
    const store = new InMemoryKeyValueStore();
    await initOperateState(store, {
      selfRut: EMPRESA,
      accountType: 'empresa',
      operable: [{ rut: EMPRESA, razonSocial: 'Mi Empresa SpA', isSelf: true }],
    });
    await expect(setOperatingRut(store, PERSONA)).rejects.toBeInstanceOf(ValidationError);
  });

  it('clearOperatingRut returns to self', async () => {
    const store = await personaStore();
    await setOperatingRut(store, EMPRESA);
    const ctx = operatingContext(await clearOperatingRut(store));
    expect(ctx.isSelf).toBe(true);
    expect(ctx.operatingRut).toBe(PERSONA);
  });

  it('formatOperableEntry renders rut + name + self/current markers (shared by CLI + MCP)', () => {
    const self: OperableEntry = { rut: '20000042-0', razonSocial: 'Juan Pérez', isSelf: true };
    const empresa: OperableEntry = {
      rut: '77777777-7',
      razonSocial: 'Mi Empresa SpA',
      isSelf: false,
    };
    // Self, currently operating: both markers.
    expect(formatOperableEntry(self, '20000042-0')).toBe(
      '20.000.042-0 Juan Pérez (tú mismo, operando ahora)',
    );
    // Empresa, not current: name, no markers.
    expect(formatOperableEntry(empresa, '20000042-0')).toBe('77.777.777-7 Mi Empresa SpA');
    // Empresa currently operating: the "operando ahora" marker only.
    expect(formatOperableEntry(empresa, '77777777-7')).toBe(
      '77.777.777-7 Mi Empresa SpA (operando ahora)',
    );
    // Razón social == rut (SII returned no name) → omit it, don't repeat the RUT.
    expect(
      formatOperableEntry(
        { rut: '77777777-7', razonSocial: '77777777-7', isSelf: false },
        '20000042-0',
      ),
    ).toBe('77.777.777-7');
  });
});
