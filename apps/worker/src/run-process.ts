import { spawn } from 'node:child_process';

/**
 * Запуск внешней утилиты без execa: execa зависает на импорте под `tsx watch`
 * с перенаправленным stdio (так воркер запускает `pnpm --parallel`).
 * Возвращает хвост stderr — туда ffmpeg пишет результаты анализа.
 */
export function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    child.on('error', (err) => {
      reject(new Error(`Не удалось запустить ${command}: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`${command} завершился с кодом ${code}\n${stderr.trim()}`));
    });
  });
}
