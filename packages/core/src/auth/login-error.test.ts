import { describe, it, expect } from 'vitest';
import { parseSiiLoginError } from './login-error.js';

// Mirrors the page body text OBSERVED 2026-06-28 (docs/sii-contract/auth-login.md),
// surrounded by the usual page chrome the parser must skip.
const WRONG_CLAVE_BODY = [
  'Ingresar a Mi Sii',
  'Mi Sii',
  'Servicios online',
  'Ayuda',
  'La Clave Tributaria ingresada no es correcta, verifique que su teclado no está con opción "mayúsculas" e inténtelo nuevamente.',
  'El código de este mensaje es 01.01.203.500.720.20',
  'Información sobre este código, ingrese en "códigos de mensaje de error"…',
  'Valores y fechas',
].join('\n');

describe('parseSiiLoginError', () => {
  it('returns the cause line before the código line, plus the código', () => {
    expect(parseSiiLoginError(WRONG_CLAVE_BODY)).toBe(
      'La Clave Tributaria ingresada no es correcta, verifique que su teclado no está con opción "mayúsculas" e inténtelo nuevamente. (El código de este mensaje es 01.01.203.500.720.20)',
    );
  });

  it('matches the código marker without an accent too', () => {
    const body = 'Causa X\nEl codigo de este mensaje es 9.9.9';
    expect(parseSiiLoginError(body)).toBe('Causa X (El codigo de este mensaje es 9.9.9)');
  });

  it('returns null when there is no código line (shape changed)', () => {
    expect(parseSiiLoginError('alguna página sin el marcador de error')).toBeNull();
  });

  it('returns null when the código line has no preceding cause line', () => {
    expect(parseSiiLoginError('El código de este mensaje es 1.2.3')).toBeNull();
  });
});
