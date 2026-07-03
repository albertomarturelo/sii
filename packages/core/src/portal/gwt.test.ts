import { describe, it, expect } from 'vitest';
import { buildPeticionesRequest, decodeGwtResponse, isNode, isPolicyError } from './gwt.js';
import { PeticionesError } from '../errors/index.js';
import { encodeOk } from './__fixtures__/gwt-encode.js';

describe('gwt codec', () => {
  it('builds the peticionesUsuario request with the observed invocation layout', () => {
    const body = buildPeticionesRequest('https://host/mod/', 'HASH123', 20000042, 'TOK');
    expect(body).toBe(
      '5|0|7|https://host/mod/|HASH123|' +
        'cl.sii.sdi.difsj.sispadinternet.web.client.service.aplicacion.peticion.ServicePeticion|' +
        'peticionesUsuario|java.lang.Integer/3438268394|java.lang.String/2004016611|TOK|' +
        '1|2|3|4|2|5|6|5|20000042|7|',
    );
  });

  it('decodes a //OK object graph and consumes it exactly', () => {
    const root = decodeGwtResponse(encodeOk([{ numero: 1, materiaGlosa: null, estados: [] }]));
    expect(isNode(root)).toBe(true);
    expect(isNode(root) ? root.items?.length : 0).toBe(1);
  });

  it('fails loud on an unknown wire type (recompiled with changed types → scraper roto)', () => {
    const wire = '//OK' + JSON.stringify([1, ['cl.sii.sdi.difsj.sispad.to.Nueva/9'], 0, 5]);
    expect(() => decodeGwtResponse(wire)).toThrow(PeticionesError);
    expect(() => decodeGwtResponse(wire)).toThrow(/scraper roto/);
  });

  it('rejects leftover tokens (a shape drift) rather than returning partial data', () => {
    // one extra trailing token beyond a null root
    const wire = '//OK' + JSON.stringify([0, 0, [], 0, 5]);
    expect(() => decodeGwtResponse(wire)).toThrow(/scraper roto/);
  });

  it('isPolicyError flags an incompatible-policy //EX (the self-heal trigger)', () => {
    expect(isPolicyError(new PeticionesError('IncompatibleRemoteServiceException'))).toBe(true);
    expect(isPolicyError(new PeticionesError('El contribuyente no tiene acceso.'))).toBe(false);
    expect(isPolicyError(new Error('IncompatibleRemoteService'))).toBe(false);
  });
});
