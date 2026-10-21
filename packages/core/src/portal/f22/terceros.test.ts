import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../../adapters/fake/index.js';
import { Rut } from '../../rut/index.js';
import { Anio } from '../../periodo/index.js';
import { F22Error } from '../../errors/index.js';
import { fetchF22TercerosDetalle, fetchF22TercerosResumen } from './index.js';

// Synthetic data only (no real PII, no SII): the taxpayer 20.000.042-0 "Juan Pérez Soto", a
// declarante 77.777.777-7. The Mi SII name has three words; informantes spell it their way. The grids mirror the observed shape (sii-contract/f22.md « Terceros »).
const RUT = Rut.parse('20000042-0');
const ANIO = Anio.parse('2025');
const PROPIO = { rut: RUT, nombre: 'Juan Pérez Soto' };

type Cell = Record<string, unknown>;
const c = (value: string | null, span: { c?: number; r?: number } = {}): Cell => ({
  colspan: span.c ?? 1,
  rowspan: span.r ?? 1,
  value,
  conBordeSuperior: true,
  esParteDeSpan: false,
  ancho: { tipoAncho: 'px', valor: 100 },
  largoColumna: null,
  style: 'fw-descripcionCampoCenter',
  contactoRut: false,
});
const part = (): Cell => ({ ...c(null), esParteDeSpan: true });
const row = (tipoCelda: 'cabecera' | 'dato', cells: Cell[]) => ({
  fila: Object.fromEntries(cells.map((cell, i) => [String(i), cell])),
  tipoCelda,
  ultimaCelda: cells.length,
});
const grid = (rows: ReturnType<typeof row>[], cantRegistros: number) => ({
  tabla: Object.fromEntries(rows.map((r, i) => [String(i).padStart(2, '0'), r])),
  cantRegistros,
  cantidadFilas: rows.length,
  cantidadColumnas: 18, // the title's colspan, wider than the real grid (as observed)
});

// 15 positions: Tipo | Folio | Rut Declarante ×3 | Nombre | Fecha | Rut Partícipe ×3 |
// Nombre Inversionista | Monto Total › Compra | › Venta | Estado | Origen. The title row is 18 wide.
const HEADERS = [
  row('cabecera', [
    c('Seccion B: DATOS DE LOS INFORMADOS', { c: 18 }),
    ...Array.from({ length: 17 }, part),
  ]),
  row('cabecera', [
    c('Tipo de Formulario', { r: 2 }),
    c('Folio', { r: 2 }),
    c('Rut Declarante', { c: 3, r: 2 }),
    part(),
    part(),
    c('Nombre o Razón Social Declarante', { r: 2 }),
    c('Fecha presentacion', { r: 2 }),
    c('Rut Partícipe', { c: 3, r: 2 }),
    part(),
    part(),
    c('Nombre Inversionista', { r: 2 }),
    c('Monto Total', { c: 2 }),
    part(),
    c('Estado', { r: 2 }),
    c('Origen de la Información', { r: 2 }),
  ]),
  // Under a rowspan SII emits a null cell (with the colspan), not a span part (observed).
  row('cabecera', [
    c(null),
    c(null),
    c(null, { c: 3 }),
    part(),
    part(),
    c(null),
    c(null),
    c(null, { c: 3 }),
    part(),
    part(),
    c(null),
    c('Compra'),
    c('Venta'),
    c(null),
    c(null),
  ]),
];
const dato = (folio: string, compra: string, venta: string) =>
  row('dato', [
    c('1894'),
    c(folio),
    c('77.777.777'),
    c('-'),
    c('7'),
    c('CORREDORA SINTETICA S.A.'),
    c('18-03-2026'),
    c('20.000.042'), // the taxpayer's own RUT: dropped by value
    c('-'),
    c('0'),
    c('PEREZ JUAN'), // the taxpayer's name, reordered and short one word: dropped by value
    c(compra),
    c(venta),
    c('No Observada'),
    c('Tercero'),
  ]);

const session = (data: unknown, extra: Record<string, unknown> = {}): FakePortalSession =>
  new FakePortalSession({
    requestJson: () => ({ data, metaData: { errors: null }, ...extra }),
    cookies: { TOKEN: 'conv' },
  });
const sent = (s: FakePortalSession) =>
  s.lastRequest?.options as {
    headers: Record<string, string>;
    body: { metaData: Record<string, unknown>; data: Record<string, unknown> };
  };

describe('F22 terceros facade (fake session, synthetic grids, no SII)', () => {
  it('getDjDetalle: maps the grid by header path, names the fixed columns, drops own RUT + name', async () => {
    const s = session({
      listDetalle: {
        DETALLE: { detalle: grid([...HEADERS, dato('12345', '1.234.567', '0')], 11) },
      },
    });
    const page = await fetchF22TercerosDetalle(s, {
      rut: RUT,
      anio: ANIO,
      dj: '1894',
      pagina: 2,
      propio: PROPIO,
    });

    expect(page.registros).toBe(11);
    expect(page.filas).toEqual([
      {
        folio: '12345',
        declaranteRut: '77777777-7', // three positions joined
        declaranteNombre: 'CORREDORA SINTETICA S.A.',
        fechaPresentacion: '2026-03-18', // DD-MM-YYYY → ISO
        estado: 'No Observada',
        origen: 'Tercero',
        // Tipo de Formulario (the DJ itself), Rut Partícipe (by label) and the name are gone.
        campos: [
          { columna: 'Monto Total › Compra', valor: 1234567 }, // es-CL monto → number
          { columna: 'Monto Total › Venta', valor: 0 },
        ],
      },
    ]);
    expect(JSON.stringify(page)).not.toContain('20000042');
    expect(JSON.stringify(page)).not.toMatch(/PEREZ/);
  });

  it('getDjDetalle: sends the observed body — seccion "detalle" is what makes page count', async () => {
    const s = session({ listDetalle: {} });
    await fetchF22TercerosDetalle(s, {
      rut: RUT,
      anio: ANIO,
      dj: '1891',
      pagina: 3,
      propio: PROPIO,
    });

    const req = sent(s);
    expect(s.lastRequest?.url).toContain(
      '/djconsultarentaui/services/data/facadeService/getDjDetalle',
    );
    expect(req.body.data).toEqual({
      periodo: '202500',
      rut: '20000042',
      dv: '0',
      dj: 1891,
      page: 3,
      key: 0,
      seccion: 'detalle',
      tipoConsulta: 2,
    });
    expect(req.body.metaData).toMatchObject({
      namespace:
        'cl.sii.sdi.lob.renta.djconsultarenta.data.api.interfaces.FacadeService/getDjDetalle',
      conversationId: 'conv',
      page: null,
    });
    expect(req.headers['Referer']).toContain('/djconsultarentaui/internet/');
  });

  it('getDjDetalle: no grid ⇒ 0 rows; an EMPTY section key is read too (observed)', async () => {
    const empty = await fetchF22TercerosDetalle(session({ listDetalle: {} }), {
      rut: RUT,
      anio: ANIO,
      dj: '310',
      pagina: 1,
      propio: PROPIO,
    });
    expect(empty).toEqual({ registros: 0, filas: [] });

    const blankKey = await fetchF22TercerosDetalle(
      session({ listDetalle: { '': { detalle: grid([...HEADERS, dato('1', '5', '6')], 1) } } }),
      { rut: RUT, anio: ANIO, dj: '303', pagina: 1, propio: PROPIO },
    );
    expect(blankKey.filas).toHaveLength(1);
  });

  it('a blank cell is null and an absent RUT (`0 - 0`) is null', async () => {
    const headers = [row('cabecera', [c('Rut del Emisor', { c: 3 }), part(), part(), c('Monto')])];
    const s = session({
      listDetalle: {
        DETALLE: { detalle: grid([...headers, row('dato', [c('0'), c('-'), c('0'), c(' ')])], 1) },
      },
    });
    const page = await fetchF22TercerosDetalle(s, {
      rut: RUT,
      anio: ANIO,
      dj: '1894',
      pagina: 1,
      propio: PROPIO,
    });
    expect(page.filas[0]?.campos).toEqual([
      { columna: 'Rut del Emisor', valor: null },
      { columna: 'Monto', valor: null },
    ]);
  });

  it('a row of a different width is "scraper roto", never a shifted row', async () => {
    const short = row('dato', Object.values(dato('1', '2', '3').fila).slice(1));
    const s = session({
      listDetalle: { DETALLE: { detalle: grid([...HEADERS, dato('1', '2', '3'), short], 2) } },
    });
    await expect(
      fetchF22TercerosDetalle(s, { rut: RUT, anio: ANIO, dj: '1894', pagina: 1, propio: PROPIO }),
    ).rejects.toThrow(/Scraper roto/);
  });

  it('an unknown row type is "scraper roto"', async () => {
    const odd = { ...dato('1', '2', '3'), tipoCelda: 'pie' };
    const s = session({ listDetalle: { DETALLE: { detalle: grid([...HEADERS, odd], 1) } } });
    await expect(
      fetchF22TercerosDetalle(s, { rut: RUT, anio: ANIO, dj: '1894', pagina: 1, propio: PROPIO }),
    ).rejects.toThrow(/Scraper roto/);
  });

  it("SII's refusal passes verbatim (the empresa RUT answer, observed)", async () => {
    const s = new FakePortalSession({
      requestJson: () => ({
        data: null,
        metaData: { errors: [{ id: '0', descripcion: 'Acceso no autorizado!' }] },
      }),
      cookies: { TOKEN: 'conv' },
    });
    const err = await fetchF22TercerosDetalle(s, {
      rut: RUT,
      anio: ANIO,
      dj: '1887',
      pagina: 1,
      propio: PROPIO,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(F22Error);
    expect((err as Error).message).toBe('Acceso no autorizado!');
  });

  it('getAgenteRetenedor: one call, no RUT in the body, per-ítem aggregates, mojibake repaired', async () => {
    const resumen = grid(
      [
        row('cabecera', [
          c('Cantidad de Informantes', { r: 2 }),
          c('Montos Informados', { c: 2 }),
          part(),
        ]),
        row('cabecera', [c(null), c('Renta Total'), c('RUT Informado')]),
        row('dato', [c('2'), c('9.999.999'), c('20.000.042')]), // own RUT body: dropped
      ],
      0,
    );
    const s = session([
      {
        listAgenteRetenedor: { '1887': { resumen } },
        title: 'Sobre Rentas Del Art 42',
        formKey: 0,
      },
      {
        listAgenteRetenedor: { '308': { resumen: grid([row('cabecera', [c('Formulario')])], 0) } },
        title: 'Rentas por EnajenaciÃ³n (Recuadro NÂ°2)',
        formKey: 0,
      },
    ]);

    const decls = await fetchF22TercerosResumen(s, { anio: ANIO, propio: PROPIO });

    expect(sent(s).body.data).toEqual({ periodo: '202500' });
    expect(decls).toEqual([
      {
        dj: '1887',
        titulo: 'Sobre Rentas Del Art 42',
        filas: [
          [
            { columna: 'Cantidad de Informantes', valor: 2 },
            { columna: 'Montos Informados › Renta Total', valor: 9999999 },
          ],
        ],
      },
      { dj: '308', titulo: 'Rentas por Enajenación (Recuadro N°2)', filas: [] },
    ]);
  });

  it('getAgenteRetenedor: `data: null` is no ítems, not an error; a non-list is "scraper roto"', async () => {
    expect(await fetchF22TercerosResumen(session(null), { anio: ANIO, propio: PROPIO })).toEqual(
      [],
    );
    await expect(
      fetchF22TercerosResumen(session({ nope: 1 }), { anio: ANIO, propio: PROPIO }),
    ).rejects.toThrow(/Scraper roto/);
  });

  it('without a known own name nothing is dropped by name', async () => {
    const s = session({
      listDetalle: { DETALLE: { detalle: grid([...HEADERS, dato('1', '2', '3')], 1) } },
    });
    const page = await fetchF22TercerosDetalle(s, {
      rut: RUT,
      anio: ANIO,
      dj: '1894',
      pagina: 1,
      propio: { rut: RUT, nombre: null },
    });
    expect(page.filas[0]?.campos).toContainEqual({
      columna: 'Nombre Inversionista',
      valor: 'PEREZ JUAN',
    });
  });

  it("the partícipe / aportante columns are the taxpayer's own identity: dropped by label", async () => {
    const headers = [
      row('cabecera', [
        c('Nombre o Razón Social del Partícipe o Aportante'),
        c('Código País de Residencia del Partícipe o Aportante'),
        c('Monto'),
      ]),
    ];
    const s = session({
      listDetalle: {
        DETALLE: {
          detalle: grid([...headers, row('dato', [c('JUAN P SOTO'), c('CL'), c('5')])], 1),
        },
      },
    });
    // Even with no known name (a login that could not read it), the label rule holds.
    const page = await fetchF22TercerosDetalle(s, {
      rut: RUT,
      anio: ANIO,
      dj: '1922',
      pagina: 1,
      propio: { rut: RUT, nombre: null },
    });
    expect(page.filas[0]?.campos).toEqual([{ columna: 'Monto', valor: 5 }]);
  });

  it('unlabeled data columns (the SII-internal 303, observed) are named by position', async () => {
    const headers = [row('cabecera', [c('Formulario'), c(''), c(''), c('')])];
    const s = session({
      listDetalle: {
        '': {
          detalle: grid([...headers, row('dato', [c('29'), c('IVA'), c('1.000'), c('900')])], 1),
        },
      },
    });
    const page = await fetchF22TercerosDetalle(s, {
      rut: RUT,
      anio: ANIO,
      dj: '303',
      pagina: 1,
      propio: PROPIO,
    });
    expect(page.filas[0]?.campos).toEqual([
      { columna: 'Formulario', valor: 29 },
      { columna: 'columna 2', valor: 'IVA' },
      { columna: 'columna 3', valor: 1000 },
      { columna: 'columna 4', valor: 900 },
    ]);
  });

  it('connector words do not make a third party "own": "de la" alone never matches', async () => {
    const headers = [row('cabecera', [c('Nombre Inversionista'), c('Banco')])];
    const s = session({
      listDetalle: {
        DETALLE: {
          detalle: grid(
            [...headers, row('dato', [c('ROJAS MARIA LUZ'), c('BANCO DE LA NACION')])],
            1,
          ),
        },
      },
    });
    const page = await fetchF22TercerosDetalle(s, {
      rut: RUT,
      anio: ANIO,
      dj: '1890',
      pagina: 1,
      propio: { rut: RUT, nombre: 'María de la Luz Rojas' },
    });
    // The own name (two significant words shared) goes; the bank, sharing only "de la", stays.
    expect(page.filas[0]?.campos).toEqual([{ columna: 'Banco', valor: 'BANCO DE LA NACION' }]);
  });

  it('a bare RUT body is own only under a RUT label: a monto with the same digits stays', async () => {
    const headers = [row('cabecera', [c('Rut Informado'), c('Monto')])];
    const s = session({
      listDetalle: {
        DETALLE: {
          detalle: grid([...headers, row('dato', [c('20.000.042'), c('20.000.042')])], 1),
        },
      },
    });
    const page = await fetchF22TercerosDetalle(s, {
      rut: RUT,
      anio: ANIO,
      dj: '1890',
      pagina: 1,
      propio: PROPIO,
    });
    expect(page.filas[0]?.campos).toEqual([{ columna: 'Monto', valor: 20000042 }]);
  });

  describe('a changed shape is "scraper roto", never a guess', () => {
    const detalle = (data: unknown) =>
      fetchF22TercerosDetalle(session(data), {
        rut: RUT,
        anio: ANIO,
        dj: '1894',
        pagina: 1,
        propio: PROPIO,
      });

    it('positions with a gap', async () => {
      const gap = { fila: { '0': c('1'), '2': c('2') }, tipoCelda: 'dato' };
      const headers = [row('cabecera', [c('A'), c('B')])];
      await expect(
        detalle({ listDetalle: { DETALLE: { detalle: grid([...headers, gap], 1) } } }),
      ).rejects.toThrow(/posiciones no contiguas/);
    });

    it('a header row narrower than the data rows', async () => {
      const headers = [row('cabecera', [c('A'), c('B')]), row('cabecera', [c('C')])];
      await expect(
        detalle({
          listDetalle: {
            DETALLE: { detalle: grid([...headers, row('dato', [c('1'), c('2')])], 1) },
          },
        }),
      ).rejects.toThrow(/encabezado de 1 posiciones en una grilla de 2/);
    });

    it('two grids in one detalle', async () => {
      const g = grid([row('cabecera', [c('A')]), row('dato', [c('1')])], 1);
      await expect(detalle({ listDetalle: { DETALLE: { detalle: g, otra: g } } })).rejects.toThrow(
        /2 grillas/,
      );
    });

    it('a detalle without `listDetalle`', async () => {
      await expect(detalle({ otra: 1 })).rejects.toThrow(/no trae `listDetalle`/);
    });
  });
});
