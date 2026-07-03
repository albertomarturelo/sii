import { describe, it, expect } from 'vitest';
import { HOSTS, NotAuthenticatedError, testing, type Runtime } from '@albertomarturelo/sii-core';
import { datos, run, runJson } from '../test-helpers.js';

// A synthetic //OK peticionesUsuario response (no SII, no PII), built by the core GWT
// encoder: petition #900123, materia + two estados (one "en espera de Antecedentes" with
// a note). Kept as a literal here because the encoder is core-test-internal.
const OK =
  '//OK[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,0,0,0,0,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,0,0,9,8,0,0,0,1770724800000,6,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,0,0,7,0,0,0,0,1769947200000,6,0,0,0,0,0,0,0,5,2,4,0,0,0,0,0,0,0,0,900123,3,0,0,0,0,0,0,0,0,0,0,0,0,2,1,1,["[Lcl.sii.sdi.difsj.sispad.to.PeticionTo;/1","cl.sii.sdi.difsj.sispad.to.PeticionTo/1","java.lang.Integer/1","java.util.ArrayList/1","cl.sii.sdi.difsj.sispad.to.EstadoPeticionTo/1","java.sql.Timestamp/1","Petición Recepcionada por el SII","Falta adjuntar documento sintético.","Peticion en espera de Antecedentes","cl.sii.sdi.difsj.sispad.to.MateriaTo/1","Materia sintética de prueba"],0,5]';

describe('sii peticiones command (fake runtime, no SII)', () => {
  // restore() backs withSession; it scripts the GWT-RPC facade's requestText.
  function makeRuntime(requestText: (url: string) => string): Runtime {
    return {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestText: (url) => requestText(url),
          cookies: { TOKEN: 't' },
        },
      }),
    };
  }
  const okRuntime = (): Runtime => makeRuntime((url) => (url.endsWith('/peticion') ? OK : ''));

  it('peticiones list (--human) prints numbers, estados and the SII note', async () => {
    const rt = okRuntime();
    await run(rt, 'auth', 'login');
    const out = await run(rt, 'peticiones', 'list', '--human');
    expect(out).toContain('#900123');
    expect(out).toContain('Materia sintética de prueba');
    expect(out).toContain('Peticion en espera de Antecedentes'); // estado actual
    expect(out).toContain('Falta adjuntar documento sintético.'); // SII note surfaced
  });

  it('peticiones list emits JSON by default (pipeable)', async () => {
    const rt = okRuntime();
    await run(rt, 'auth', 'login');
    const json = await runJson(rt, 'peticiones', 'list');
    expect(json.peticiones).toHaveLength(1);
    expect(json.peticiones[0].numero).toBe(900123);
    expect(json.peticiones[0].estadoActual).toBe('Peticion en espera de Antecedentes');
  });

  it('requires a session (NotAuthenticated → exit 2)', async () => {
    const rt = okRuntime(); // no login
    await expect(run(rt, 'peticiones', 'list')).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});
