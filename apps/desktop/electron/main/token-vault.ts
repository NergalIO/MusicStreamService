import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

let cache: Record<string, string> | null = null;

function vaultFile(): string {
  return path.join(app.getPath('userData'), 'vault.json');
}

function load(): Record<string, string> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(vaultFile(), 'utf8')) as Record<string, string>;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(): void {
  fs.mkdirSync(path.dirname(vaultFile()), { recursive: true });
  fs.writeFileSync(vaultFile(), JSON.stringify(cache ?? {}), { mode: 0o600 });
}

/** Значения шифруются через safeStorage (DPAPI на Windows), если он доступен. */
export const tokenVault = {
  get(key: string): string | null {
    const stored = load()[key];
    if (!stored) return null;
    if (stored.startsWith('enc:')) {
      try {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
      } catch {
        return null;
      }
    }
    return stored.startsWith('raw:') ? stored.slice(4) : stored;
  },
  set(key: string, value: string): void {
    const data = load();
    data[key] = safeStorage.isEncryptionAvailable()
      ? `enc:${safeStorage.encryptString(value).toString('base64')}`
      : `raw:${value}`;
    persist();
  },
  delete(key: string): void {
    const data = load();
    if (!(key in data)) return;
    delete data[key];
    persist();
  },
};
