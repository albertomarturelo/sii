// OS keyring `SecretStore` (ADR-025) — the Clave at rest lives HERE and nowhere else
// (ADR-006). Backed by `@napi-rs/keyring`, which talks to the platform store directly:
// the freedesktop Secret Service on Linux (gnome-keyring / kwallet), the Keychain on
// macOS. It is general-purpose infrastructure, not SII code (ADR-004).
//
// The binding is a native module, so it is imported LAZILY: composing a runtime — or
// running the MCP server, which never reads a secret — must not load it (ADR-016).
import { KEYRING_SERVICE } from '../../config/index.js';
import { SiiError } from '../../errors/index.js';
import type { SecretStore } from '../../seams/index.js';

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}
type KeyringModule = { Entry: new (service: string, username: string) => KeyringEntry };

/** Reads the Clave from the OS keyring. Never used by the MCP surface (ADR-025):
 *  only the CLI-only `keyringLogin` task consumes it. */
export class KeyringSecretStore implements SecretStore {
  constructor(private readonly service: string = KEYRING_SERVICE) {}

  private async entry(account: string): Promise<KeyringEntry> {
    // A plain dynamic import is the whole lazy-load — the module registry is the cache.
    // A FAILURE HERE IS NOT "no entry": the native binding is missing or unsupported on
    // this platform, and reporting that as an empty keyring would send the user off to
    // re-store a Clave they already stored (review of #101).
    let mod: KeyringModule;
    try {
      mod = (await import('@napi-rs/keyring')) as unknown as KeyringModule;
    } catch (err) {
      throw new SiiError(
        'El binding del llavero (@napi-rs/keyring) no está disponible en esta plataforma. ' +
          `Usa \`sii auth login --console\`. Detalle: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return new mod.Entry(this.service, account);
  }

  async get(account: string): Promise<string | null> {
    // A missing entry, a locked keyring and an absent Secret Service all mean the same
    // to the caller: no credential here. The caller turns that into its own actionable
    // message (which service/username it looked for) — swallowing the platform's own
    // wording keeps a secret-store error from leaking anything about the entry. A
    // missing BINDING is different and propagates (see `entry`).
    const entry = await this.entry(account);
    try {
      return entry.getPassword();
    } catch {
      return null;
    }
  }

  async set(account: string, secret: string): Promise<void> {
    (await this.entry(account)).setPassword(secret);
  }

  async delete(account: string): Promise<void> {
    try {
      (await this.entry(account)).deletePassword();
    } catch {
      // already gone / no store — deleting nothing is success
    }
  }
}
