import { describe, it, expect } from 'vitest';
import { parseSiiLoginError, parseSiiLoginErrorDetail, WRONG_CLAVE_CODIGO } from './login-error.js';

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

describe('parseSiiLoginErrorDetail', () => {
  it('classifies the observed wrong-Clave código as reason wrong-clave', () => {
    const d = parseSiiLoginErrorDetail(WRONG_CLAVE_BODY);
    expect(d.reason).toBe('wrong-clave');
    expect(d.codigo).toBe(WRONG_CLAVE_CODIGO);
    expect(d.message).toContain('La Clave Tributaria ingresada no es correcta');
    expect(d.message).toContain(`(El código de este mensaje es ${WRONG_CLAVE_CODIGO})`);
  });

  it('keeps the código but stays unknown for any OTHER código', () => {
    // A different código (e.g. a locked account — shape unknown, not yet observed)
    // must not be mistaken for a wrong Clave.
    const body =
      'Su cuenta se encuentra bloqueada.\nEl código de este mensaje es 01.02.003.000.000.00';
    const d = parseSiiLoginErrorDetail(body);
    expect(d.reason).toBe('unknown');
    expect(d.codigo).toBe('01.02.003.000.000.00');
  });

  it('is unknown with no código when the page shape changed', () => {
    const d = parseSiiLoginErrorDetail('alguna página sin el marcador de error');
    expect(d).toEqual({ message: null, codigo: null, reason: 'unknown' });
  });
});
