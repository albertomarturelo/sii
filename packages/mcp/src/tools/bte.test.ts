import { describe, it, expect } from 'vitest';
import { HOSTS, testing, type Runtime } from '@altumstack/sii-core';
import { connect, datos, isError, toolText } from '../test-helpers.js';

describe('@sii/mcp bte tools (in-memory client, fake runtime, no SII)', () => {
  it('bte_list returns the month boletas as JSON (session-keyed, own-PII dropped)', async () => {
    const META = {
      total_boletas: '1',
      suma_liquido: '256500',
      nombre_contribuyente: 'PII-OWN-NAME-XYZ', // report meta → must not surface
    };
    const ARR = {
      nroboleta_1: '101',
      fechaemision_1: '15/05/2026',
      rutreceptor_1: '12345670',
      dvreceptor_1: 'K',
      nombrereceptor_1: 'Cliente Uno SpA',
      totalhonorarios_1: '300.000',
      honorariosliquidos_1: '256.500',
      estado_1: 'N',
    };
    // restoreSession.evaluate serves BOTH the login DatosCntrNow probe and the BTE inline maps.
    const evaluate = (expr: string): unknown =>
      expr.includes('arr_informe_mensual') ? ARR : expr.includes('xml_values') ? META : datos();
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-30T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({
        loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
        restoreSession: { landingUrl: HOSTS.miSii, evaluate },
      }),
    };
    const client = await connect(runtime);
    await client.callTool({ name: 'auth_login', arguments: {} });

    const res = await client.callTool({ name: 'bte_list', arguments: { periodo: '2026-05' } });
    const parsed = JSON.parse(toolText(res)) as {
      side: string;
      periodo: string;
      boletas: { folio: number; contraparteRut: string }[];
    };
    expect(parsed).toMatchObject({ side: 'EMITIDAS', periodo: '2026-05' });
    expect(parsed.boletas[0]).toMatchObject({ folio: 101, contraparteRut: '12345670-K' });
    expect(toolText(res)).not.toContain('PII-OWN-NAME-XYZ'); // own-identity meta never surfaces

    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'bte_list')?.annotations?.readOnlyHint).toBe(true);
  });

  // --- emit (write surface, ADR-017) ---
  const FORM =
    "<html><script>xml_values['dia_actual']='02';xml_values['mes_actual']='07';" +
    "xml_values['anio_actual']='2026';xml_values['comuna_ctr']='SANTIAGO';" +
    "xml_values['glosa_actividad']='SERV';xml_values['iddir1']='999';</script>" +
    "<form name='formulario'>ok</form></html>";
  const CONFIRM =
    '<html><script>' +
    'xml_values[\'Monto_Boleta\']=formatMiles("1000000",".");' +
    'xml_values[\'Monto_Retencion\']=formatMiles("137500",".");' +
    'xml_values[\'Monto_Liquido\']=formatMiles("862500",".");' +
    "xml_values['PorcentajeRetencion']='13,75';</script><form name='formulario'>ok</form></html>";
  const RESULT = "<html><script>xml_values['cod_barras']='200000420000000123DD';</script>ok</html>";
  const emitRuntime = (): Runtime => ({
    clock: new testing.FixedClock(new Date('2026-07-02T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({
      loginSession: { landingUrl: HOSTS.miSii, evaluate: datos, storageState: { cookies: [] } },
      restoreSession: {
        landingUrl: HOSTS.miSii,
        evaluate: datos,
        requestForm: (url: string) =>
          url.includes('ConfirmaTimbrajeContrib')
            ? CONFIRM
            : url.includes('BoletaHonorariosElectronica')
              ? RESULT
              : FORM,
      },
    }),
  });
  const emitInput = {
    receptor: '12345670-K',
    nombre: 'ACME SPA',
    domicilio: 'Av 100',
    region: 13,
    comuna: 15103,
    lineas: [{ glosa: 'Asesoría', monto: 1_000_000 }],
    retiene: 'receptor' as const,
  };

  it('bte_emit_preview computes retención/líquido without issuing (readOnlyHint)', async () => {
    const rt = emitRuntime();
    const client = await connect(rt);
    await client.callTool({ name: 'auth_login', arguments: {} });
    const res = await client.callTool({ name: 'bte_emit_preview', arguments: emitInput });
    const parsed = JSON.parse(toolText(res)) as { liquido: number };
    expect(parsed.liquido).toBe(862_500);
    expect((rt.audit as testing.RecordingAuditSink).entries.map((e) => e.action)).not.toContain(
      'bte_emit',
    );
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'bte_emit_preview')?.annotations?.readOnlyHint).toBe(true);
    // bte_emit is the first destructive tool.
    const emitTool = tools.find((t) => t.name === 'bte_emit');
    expect(emitTool?.annotations?.destructiveHint).toBe(true);
    expect(emitTool?.annotations?.readOnlyHint).toBe(false);
  });

  it('bte_emit requires confirmar + a matching montoTotalConfirmacion; then issues', async () => {
    const rt = emitRuntime();
    const client = await connect(rt);
    await client.callTool({ name: 'auth_login', arguments: {} });

    // Mismatched total → error, no issue.
    const bad = await client.callTool({
      name: 'bte_emit',
      arguments: { ...emitInput, confirmar: true, montoTotalConfirmacion: 999 },
    });
    expect(isError(bad)).toBe(true);
    expect(toolText(bad)).toContain('no coincide');
    expect((rt.audit as testing.RecordingAuditSink).entries.map((e) => e.action)).not.toContain(
      'bte_emit',
    );

    // Matching total → issues.
    const ok = await client.callTool({
      name: 'bte_emit',
      arguments: { ...emitInput, confirmar: true, montoTotalConfirmacion: 1_000_000 },
    });
    const parsed = JSON.parse(toolText(ok)) as { codBarras: string };
    expect(parsed.codBarras).toBe('200000420000000123DD');
  });
});
