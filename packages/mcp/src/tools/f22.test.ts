import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type Runtime } from '@albertomarturelo/sii-core';
import { connect, datos, isError, makeRuntime, toolText } from '../test-helpers.js';

describe('@sii/mcp f22 tools (in-memory client, fake runtime, no SII)', () => {
  it('f22_status returns the curated F22 estado as JSON (session-keyed, no PII códigos)', async () => {
    const busca = {
      metaData: { errors: [] },
      data: {
        decls: [{ folio: '999', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
        glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
      },
    };
    const grid = {
      metaData: {},
      data: [
        { codigo: '305', valor: '-100', glosa: 'Resultado' },
        { codigo: '3', valor: 'PII-MARKER-XYZ', glosa: 'RUT' }, // header PII → excluded
      ],
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? busca
              : url.includes('f22Compacto')
                ? grid
                : { metaData: {}, data: null },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'f22_status', arguments: { anio: '2025' } });
    const parsed = JSON.parse(toolText(res)) as {
      anio: string;
      estado: string;
      codigos: { codigo: string }[];
    };
    expect(parsed).toMatchObject({ anio: '2025', estado: 'Vigente' });
    expect(parsed.codigos.map((c) => c.codigo)).toEqual(['305']); // header código excluded
    expect(toolText(res)).not.toContain('PII-MARKER-XYZ'); // the PII código value never surfaces
  });

  it('f22_status with folio but no anio is rejected (folio requires anio)', async () => {
    const client = await connect(makeRuntime());
    const res = await client.callTool({ name: 'f22_status', arguments: { folio: '123' } });
    expect(isError(res)).toBe(true);
    expect(toolText(res)).toContain('folio'); // verbatim validation message, not a silent drop
  });

  it('f22_formulario returns the complete form grouped (ingresos/deducciones/retenciones/resultado/otros, no PII)', async () => {
    const busca = {
      metaData: { errors: [] },
      data: {
        decls: [{ folio: '999', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
        glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
      },
    };
    const grid = {
      metaData: {},
      data: [
        { codigo: '110', valor: '3000000', glosa: 'Rentas honorarios' }, // ingreso
        { codigo: '494', valor: '900000', glosa: 'Gastos presuntos' }, // deducción
        { codigo: '198', valor: '300000', glosa: 'Retenciones' }, // retención
        { codigo: '158', valor: '380000', glosa: 'SUB TOTAL' }, // cálculo intermedio (#28)
        { codigo: '305', valor: '-100', glosa: 'Resultado' }, // resultado
        { codigo: '8865', valor: '1', glosa: 'Código Emisión' }, // non-PII unclassified → otros
        { codigo: '9920', valor: 'PII-ADDR-XYZ', glosa: 'Dirección Origen' }, // PII → excluded
      ],
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? busca
              : url.includes('f22Compacto')
                ? grid
                : { metaData: {}, data: null },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({
      name: 'f22_formulario',
      arguments: { anio: '2025' },
    });
    const parsed = JSON.parse(toolText(res)) as {
      grupos: {
        ingresos: { codigo: string }[];
        deducciones: { codigo: string }[];
        creditos: { codigo: string }[];
        calculo: { codigo: string }[];
        resultado: { codigo: string }[];
        otros: { codigo: string }[];
      };
    };
    expect(parsed.grupos.ingresos.map((c) => c.codigo)).toEqual(['110']);
    expect(parsed.grupos.deducciones.map((c) => c.codigo)).toEqual(['494']);
    expect(parsed.grupos.creditos.map((c) => c.codigo)).toEqual(['198']);
    expect(parsed.grupos.calculo.map((c) => c.codigo)).toEqual(['158']); // intermediate, not resultado
    expect(parsed.grupos.resultado.map((c) => c.codigo)).toEqual(['305']);
    expect(parsed.grupos.otros.map((c) => c.codigo)).toEqual(['8865']); // non-PII, unmapped → shown
    expect(toolText(res)).not.toContain('PII-ADDR-XYZ'); // address PII never surfaces
  });

  it('f22_observaciones returns the observación list as JSON (código + glosa + url)', async () => {
    const busca = {
      metaData: { errors: [] },
      data: {
        decls: [{ folio: '999', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
        glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
      },
    };
    const obs = {
      data: [
        {
          codigo: 'B102',
          descripcion: 'Control ganancia de capital',
          url: 'http://www.sii.cl/B102.pdf',
        },
      ],
      respCod: null,
      errorMsg: null,
      metaData: { errors: null },
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? busca
              : url.includes('situacionObservacion')
                ? obs
                : { metaData: {}, data: null },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'f22_observaciones', arguments: { anio: '2025' } });
    const parsed = JSON.parse(toolText(res)) as {
      anio: string;
      observaciones: { codigo: string }[];
    };
    expect(parsed).toMatchObject({ anio: '2025' });
    expect(parsed.observaciones.map((o) => o.codigo)).toEqual(['B102']);
  });

  it('f22_historial returns the event timeline as JSON (most-recent-first)', async () => {
    const busca = {
      metaData: { errors: [] },
      data: {
        decls: [{ folio: '999', vgte: 'S', codConc: 'C1', fecIng: '15/04/2025' }],
        glosas: [{ codConclusion: 'C1', descripcion: 'Vigente' }],
      },
    };
    const eventos = {
      data: [
        {
          folio: '999',
          codEvento: '48',
          nombre: 'Declaración recibida.',
          fechaEvento: '08/04/2025',
          tipoEvento: '0',
        },
        {
          folio: '999',
          codEvento: '2',
          nombre: 'Devolución autorizada.',
          fechaEvento: '16/04/2025',
          tipoEvento: '0',
        },
      ],
      respCod: 0,
      errorMsg: null,
      metaData: { errors: null },
    };
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-27T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: {
          landingUrl: HOSTS.miSii,
          evaluate: datos,
          cookies: { TOKEN: 't' },
          requestJson: (url) =>
            url.includes('buscaDeclVgte')
              ? busca
              : url.includes('buscaEventos')
                ? eventos
                : { metaData: {}, data: null },
        },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'f22_historial', arguments: { anio: '2025' } });
    const parsed = JSON.parse(toolText(res)) as {
      anio: string;
      folios: string[];
      eventos: { codigo: string; fecha: string | null }[];
    };
    expect(parsed).toMatchObject({ anio: '2025', folios: ['999'] });
    expect(parsed.eventos.map((e) => e.codigo)).toEqual(['2', '48']); // most-recent-first
  });
});
