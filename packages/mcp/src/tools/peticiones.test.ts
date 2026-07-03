import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type Runtime } from '@albertomarturelo/sii-core';
import { connect, datos, toolText } from '../test-helpers.js';

// Synthetic //OK peticionesUsuario response (no SII, no PII) — see the CLI suite.
const OK =
  '//OK[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,0,0,0,0,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,0,0,9,8,0,0,0,1770724800000,6,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,0,0,7,0,0,0,0,1769947200000,6,0,0,0,0,0,0,0,5,2,4,0,0,0,0,0,0,0,0,900123,3,0,0,0,0,0,0,0,0,0,0,0,0,2,1,1,["[Lcl.sii.sdi.difsj.sispad.to.PeticionTo;/1","cl.sii.sdi.difsj.sispad.to.PeticionTo/1","java.lang.Integer/1","java.util.ArrayList/1","cl.sii.sdi.difsj.sispad.to.EstadoPeticionTo/1","java.sql.Timestamp/1","Petición Recepcionada por el SII","Falta adjuntar documento sintético.","Peticion en espera de Antecedentes","cl.sii.sdi.difsj.sispad.to.MateriaTo/1","Materia sintética de prueba"],0,5]';

describe('@albertomarturelo/sii-mcp peticiones tools (in-memory client, fake runtime, no SII)', () => {
  it('peticiones_list returns the curated petitions as JSON (read-only)', async () => {
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          requestText: (url) => (url.endsWith('/peticion') ? OK : ''),
          cookies: { TOKEN: 't' },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'peticiones_list', arguments: {} });
    const parsed = JSON.parse(toolText(res)) as {
      peticiones: {
        numero: number;
        estadoActual: string;
        timeline: { mensaje: string | null }[];
      }[];
    };
    expect(parsed.peticiones).toHaveLength(1);
    expect(parsed.peticiones[0]?.numero).toBe(900123);
    expect(parsed.peticiones[0]?.estadoActual).toBe('Peticion en espera de Antecedentes');
    expect(parsed.peticiones[0]?.timeline[0]?.mensaje).toBe('Falta adjuntar documento sintético.');

    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'peticiones_list')?.annotations?.readOnlyHint).toBe(true);
  });
});
