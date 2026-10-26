import { describe, it, expect } from 'vitest';
import { inlineMapsPage } from '../adapters/fake/index.js';
import { readInlineMap } from './inline-map.js';

// Synthetic pages only (no SII, no real PII), in the shape observed on the BHE report CGIs
// (2026-10-26, #222).
describe('readInlineMap (literal JS maps in legacy CGI HTML)', () => {
  it('reads double- and single-quoted strings, formatMiles amounts and bare numbers', () => {
    const html =
      inlineMapsPage({
        xml_values: { total_boletas: '2', suma_honorarios: 500000 },
        arr_informe_mensual: { nroboleta_1: '55', totalhonorarios_1: { formatMiles: '120000' } },
      }) + `<script>xml_values['porcentaje_retencion'] = '15,25';</script>`;

    expect(readInlineMap(html, 'xml_values')).toEqual({
      total_boletas: '2',
      suma_honorarios: '500000',
      porcentaje_retencion: '15,25',
    });
    expect(readInlineMap(html, 'arr_informe_mensual')).toEqual({
      nroboleta_1: '55',
      totalhonorarios_1: '120000', // formatMiles' raw argument, not "120.000"
    });
  });

  it('keeps the LAST value of a key assigned twice, as the page script would', () => {
    const html = `xml_values = new Array(); xml_values['ene1'] = ""; xml_values['ene1'] = "300000";`;
    expect(readInlineMap(html, 'xml_values')).toEqual({ ene1: '300000' });
  });

  it('skips comparisons and computed expressions instead of guessing', () => {
    const html = [
      `var xml_values = new Array();`,
      `xml_values['es_sociedad_profesionales'] = "NO";`,
      `if (xml_values['es_sociedad_profesionales'] == 'SI') { x = 1; }`,
      `xml_values['tot1'] = Number(xml_values['ene1']) + Number(xml_values['feb1']);`,
    ].join('\n');
    expect(readInlineMap(html, 'xml_values')).toEqual({ es_sociedad_profesionales: 'NO' });
  });

  it("replays `+= <n>` the way the month's sums are built (0, then one add per row)", () => {
    const html = [
      `var xml_values = new Array();`,
      `xml_values['suma_honorarios'] = 0;`,
      `arr_informe_mensual['totalhonorarios_1'] = formatMiles('120000','.');`,
      `xml_values['suma_honorarios']   +=   120000;`,
      `xml_values['suma_honorarios']   +=   80000;`,
    ].join('\n');
    expect(readInlineMap(html, 'xml_values')).toEqual({ suma_honorarios: '200000' });
  });

  it('drops a key whose later statement it cannot evaluate, never keeping a stale value', () => {
    const html = [
      `var xml_values = new Array();`,
      `xml_values['tot2'] = "0";`,
      `xml_values['tot2'] = Number(xml_values['ene2']) + Number(xml_values['feb2']);`,
      `xml_values['nombre'] = "X";`,
      `xml_values['nombre'] += 5;`, // a `+=` on a non-number: JS would concatenate
    ].join('\n');
    expect(readInlineMap(html, 'xml_values')).toEqual({});
  });

  it('unescapes a quote inside a value', () => {
    const html = inlineMapsPage({
      arr_informe_mensual: { nombre_emisor_1: 'Servicios "Uno" EIRL' },
    });
    expect(readInlineMap(html, 'arr_informe_mensual')).toEqual({
      nombre_emisor_1: 'Servicios "Uno" EIRL',
    });
  });

  it('a declared map with no keys is empty; an absent map is null (a non-report page)', () => {
    const html = `<script>var xml_values = new Array(); xml_values['total_boletas'] = "0";
      var arr_informe_mensual = new Array();</script>`;
    expect(readInlineMap(html, 'arr_informe_mensual')).toEqual({});
    expect(readInlineMap('<html><body>Error</body></html>', 'xml_values')).toBeNull();
  });

  it('does not read another map whose name ends the same way', () => {
    const html = `var my_xml_values = new Array(); my_xml_values['k'] = "v";`;
    expect(readInlineMap(html, 'xml_values')).toBeNull();
  });
});
