import { describe, it, expect } from 'vitest';
import { InMemoryKeyValueStore } from '../adapters/fake/index.js';
import {
  clearOperatingRut,
  initOperateState,
  operatingContext,
  readOperateState,
  setOperatingRut,
  type OperableEntry,
} from './identity.js';
import { ValidationError } from '../errors/index.js';

const PERSONA = '20000042-0';
const EMPRESA = '78362507-5';
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
    const state = await setOperatingRut(store, '78.362.507-5');
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
});
