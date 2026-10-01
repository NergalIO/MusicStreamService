import { spawn } from 'node:child_process';

/**
 * Запуск внешней утилиты без execa: execa зависает на импорте под `tsx watch`
 * с перенаправленным stdio (так воркер запускает `pnpm --parallel`).
 * Возвращает хвост stderr — туда ffmpeg пишет результаты анализа.
 */
export function runProcess(command: string, args: string[], opts?: { timeoutMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    let settled = false;
    const timeoutMs = opts?.timeoutMs;
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            child.kill('SIGKILL');
            finish(new Error(`${command} превысил ${Math.round(timeoutMs / 1000)} с\n${stderr.trim()}`));
          }, timeoutMs)
        : undefined;

    const finish = (err?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve(value ?? '');
    };

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    child.on('error', (err) => {
      finish(new Error(`Не удалось запустить ${command}: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) finish(undefined, stderr);
      else finish(new Error(`${command} завершился с кодом ${code}\n${stderr.trim()}`));
    });
  });
}
