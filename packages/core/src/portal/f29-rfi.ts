// The F29 form app's GWT-RPC transport (rfiInternet `formularioFacade`, protocol 7) — the
// submit chain of the ADR-029 amendment. Observed 2026-10-19 (spike #138; wire contract:
// sii-contract/f29.md § Submit): every call is a cold authenticated POST through
// `PortalSession.requestText`, entered after the propuesta handoff. The policy strong-name and
// the type signatures come from the live permutation (`loadGwtPermutation`), the field layouts
// from `rfi-schema.ts`. The chain itself (which calls, in which order) is #161's.
import { HOSTS } from '../config/index.js';
import { F29Error } from '../errors/index.js';
import type { PortalSession } from '../seams/index.js';
import { Gwt7Codec, type Gwt7Param, type Gwt7Value, type GwtModuleRef, postGwt7 } from './gwt.js';
import { RFI_READ_LAYOUT, RFI_WRITE_LAYOUT } from './rfi-schema.js';

/** rfiInternet's module and the form service's entry point (observed 2026-10-19). */
export const RFI_FORMULARIO: GwtModuleRef = {
  moduleBase: `${HOSTS.portalApi}/rfiInternet/`,
  nocache: 'rfi.nocache.js',
  entryPoint: 'formularioFacade',
};
const FORMULARIO_SERVICE = 'cl.sii.sdi.dim.rfi.web.client.service.FormularioFacade';

const f29Error = (message: string): Error => new F29Error(message);

/** Call one `FormularioFacade` method and decode its result. `returns` is the method's declared
 *  return type when it is not an object (`java.lang.String`, a primitive code, `V`). `heal`
 *  (default on) re-reads the permutation once if SII refuses the policy, which it does before
 *  running the method. A `//EX` is raised verbatim as an `F29Error`; never retried. */
export async function callFormularioFacade(
  session: PortalSession,
  method: string,
  params: readonly Gwt7Param[],
  opts: { returns?: string; heal?: boolean } = {},
): Promise<Gwt7Value> {
  let codec: Gwt7Codec | undefined;
  const text = await postGwt7(
    session,
    RFI_FORMULARIO,
    (perm) => {
      codec = new Gwt7Codec(
        { write: RFI_WRITE_LAYOUT, read: RFI_READ_LAYOUT },
        perm.sigs,
        f29Error,
      );
      return codec.encodeRequest({
        moduleBase: RFI_FORMULARIO.moduleBase,
        policy: perm.policies[RFI_FORMULARIO.entryPoint]!,
        service: FORMULARIO_SERVICE,
        method,
        params,
      });
    },
    f29Error,
    opts.heal === undefined ? {} : { heal: opts.heal },
  );
  return codec!.decodeResponse(text, opts.returns);
}
