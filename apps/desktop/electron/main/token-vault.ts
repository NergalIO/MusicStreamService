import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './logger.js';

let cache: Record<string, string> | null = null;
let plaintextWarned = false;

function warnPlaintext(): void {
  if (plaintextWarned) return;
  plaintextWarned = true;
  log.warn(
    'Шифрование безопасного хранилища ОС недоступно: токены сервисов сохраняются в vault.json открытым текстом. ' +
      'На Linux это обычно значит, что нет связки ключей (gnome-keyring или kwallet).',
  );
}

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
    if (safeStorage.isEncryptionAvailable()) {
      data[key] = `enc:${safeStorage.encryptString(value).toString('base64')}`;
    } else {
      // Запись открытым текстом — это заметно, а не «как обычно»: предупреждаем в логе каждый раз.
      warnPlaintext();
      data[key] = `raw:${value}`;
    }
    persist();
  },
  delete(key: string): void {
    const data = load();
    if (!(key in data)) return;
    delete data[key];
    persist();
  },
};
