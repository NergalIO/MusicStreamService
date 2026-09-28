import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** Корень монорепо: воркер делит с API .env, хранилище и папку загрузок. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(ROOT, '.env') });

export const fromRoot = (p: string) => path.resolve(ROOT, p);
