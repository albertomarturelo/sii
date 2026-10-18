// The page Mi SII serves a DEAD jar (observed 2026-10-18, GH-139), byte for byte in shape: an
// XHTML shell whose only content is a JS navigation to the login, with the origin as the query.
export const MI_SII_LOGIN_STUB =
  "<!DOCTYPE html PUBLIC '-//W3C//DTD XHTML 1.1//EN' 'http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd'>\n" +
  "<html xmlns='http://www.w3.org/1999/xhtml'>\n<head>\n<script type='text/javascript'>\n" +
  "location.replace('https://zeusr.sii.cl//AUT2000/InicioAutenticacion/IngresoRutClave.html?https://misiir.sii.cl/cgi_misii/siihome.cgi');\n" +
  '</script>\n</head>\n</html>\n\n\n';
