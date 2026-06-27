import { describe, it, expect } from 'vitest';
import { HOSTS, LOGIN_HOST, loginUrl } from './config';

describe('config', () => {
  it('exposes the prod hosts', () => {
    expect(HOSTS.miSii).toContain('misiir.sii.cl');
    expect(LOGIN_HOST).toBe('zeusr.sii.cl');
  });

  it('builds the login URL with an unkeyed destination query', () => {
    expect(loginUrl(HOSTS.miSii)).toBe(
      'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html?https://misiir.sii.cl/cgi_misii/siihome.cgi',
    );
  });
});
