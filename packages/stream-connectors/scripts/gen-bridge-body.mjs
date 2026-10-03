import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(root, '../src/spotify/bridge.ts');
const src = fs.readFileSync(bridgePath, 'utf8');
const start = src.indexOf('export function installBridge(): void {');
const end = src.lastIndexOf('\n}');
if (start < 0) throw new Error('installBridge not found');
let body = src.slice(start + 'export function installBridge(): void {'.length, end);

// Drop TS-only declarations.
body = body.replace(/^  type [\s\S]*?;\n/gm, '');
body = body.replace(/^  interface [\s\S]*?\n  \}\n/gm, '');
body = body.replace(/if \(location\.origin !== "https:\/\/open\.spotify\.com"\) return;\n/, '');

// Remove type assertions (longest first).
const assertionRes = [
  / as unknown as Record<string, unknown>/g,
  / as \(\.\.\.args: unknown\[\]\) => unknown/g,
  / as \(key: string\) => unknown/g,
  / as Record<string, unknown>/g,
  / as HTMLInputElement/g,
  / as HTMLAnchorElement \| null/g,
  / as HTMLAnchorElement/g,
  / as HTMLElement/g,
  / as Element/g,
  / as object/g,
  / as WebpackRequire/g,
  / as const/g,
  / as unknown/g,
  / as boolean/g,
  / as number/g,
  / as string/g,
];
for (const re of assertionRes) body = body.replace(re, '');

// Remove param/return type annotations.
body = body.replace(/: Window & \{[\s\S]*?\n  \};/, '');
body = body.replace(/: Promise<[^>]+>/g, '');
body = body.replace(/: Record<string, unknown> \| null/g, '');
body = body.replace(/: Record<string, unknown>/g, '');
body = body.replace(/: CommandResult/g, '');
body = body.replace(/: Snapshot \| null/g, '');
body = body.replace(/: Snapshot/g, '');
body = body.replace(/: RepeatMode \| null/g, '');
body = body.replace(/: RepeatMode \| undefined/g, '');
body = body.replace(/: RepeatMode/g, '');
body = body.replace(/: PlayCommand/g, '');
body = body.replace(/: boolean \| null/g, '');
body = body.replace(/: boolean \| undefined/g, '');
body = body.replace(/: boolean/g, '');
body = body.replace(/: number \| null/g, '');
body = body.replace(/: number \| undefined/g, '');
body = body.replace(/: number/g, '');
body = body.replace(/: string \| null/g, '');
body = body.replace(/: string/g, '');
body = body.replace(/: HTMLElement \| null/g, '');
body = body.replace(/: HTMLElement/g, '');
body = body.replace(/: Element \| null/g, '');
body = body.replace(/: Element/g, '');
body = body.replace(/: unknown\[\]/g, '');
body = body.replace(/: unknown/g, '');
body = body.replace(/: void/g, '');
body = body.replace(/: Storage/g, '');
body = body.replace(/: WebpackRequire \| null/g, '');
body = body.replace(/: WebpackRequire/g, '');
body = body.replace(/: Set<[^>]+>/g, '');
body = body.replace(/: object/g, '');
body = body.replace(/ <[^>]+>/g, '');
body = body.replace(/\(this: Record<string, unknown>, /g, '(');
body = body.replace(/filter\(\(([^)]+)\): [^=]+=>/g, 'filter(($1) =>');

body = body.replace(/\bconst\b/g, 'var');
body = body.replace(/\blet\b/g, 'var');

const out = path.join(root, '../src/_bridge-body.js');
fs.writeFileSync(out, body);
console.log('wrote', out, 'lines', body.split('\n').length);
