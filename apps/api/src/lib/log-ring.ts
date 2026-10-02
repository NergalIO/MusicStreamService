const MAX = 400;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  t: string;
  level: LogLevel;
  msg: string;
}

const ring: LogEntry[] = [];

export function pushLog(level: LogLevel, msg: string): void {
  const line = msg.trim();
  if (!line) return;
  ring.push({ t: new Date().toISOString(), level, msg: line.slice(0, 2000) });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
}

export function listLogs(limit = 200): LogEntry[] {
  const n = Math.min(Math.max(limit, 1), MAX);
  return ring.slice(-n);
}

export function ingestPinoLine(chunk: string): void {
  for (const raw of chunk.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const o = JSON.parse(line) as { level?: number; msg?: string; err?: { message?: string } };
      const level: LogLevel =
        (o.level ?? 30) >= 50 ? 'error' : (o.level ?? 30) >= 40 ? 'warn' : 'info';
      const msg = o.msg || o.err?.message || line;
      pushLog(level, msg);
    } catch {
      pushLog('info', line.slice(0, 2000));
    }
  }
}
