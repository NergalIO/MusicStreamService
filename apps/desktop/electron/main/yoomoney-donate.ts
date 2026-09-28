import { ipcMain, shell } from 'electron';

const BILL_NUMBER = '1KJ0576C9CG.260928';
const BUTTON_URL = `https://yoomoney.ru/quickpay/fundraise/button?billNumber=${BILL_NUMBER}`;
const CONFIRM_PATH = 'https://yoomoney.ru/quickpay/fundraise/confirm';
const UA = 'Mozilla/5.0';

function formParamsFromHtml(html: string): { secret: string; params: Record<string, unknown> } {
  const secret = html.match(/window\.__secretKey__="([^"]+)"/)?.[1];
  const start = html.indexOf('window.__data__=');
  const end = start >= 0 ? html.indexOf(';window.__urls__', start) : -1;
  if (!secret || start < 0 || end < 0) throw new Error('Не удалось прочитать форму ЮMoney');
  const data = JSON.parse(html.slice(start + 'window.__data__='.length, end)) as {
    preloadedState?: { formParams?: Record<string, unknown> };
  };
  const params = data.preloadedState?.formParams;
  if (!params) throw new Error('Не удалось прочитать форму ЮMoney');
  return { secret, params };
}

function checkoutUrlFromBody(body: string): string {
  const trimmed = body.trim();
  let url = trimmed;
  if (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'string') throw new Error('ЮMoney вернула неожиданный ответ');
    url = parsed;
  }
  if (!/^https:\/\/yoomoney\.ru\//i.test(url)) throw new Error('ЮMoney вернула неожиданный адрес оплаты');
  return url;
}

export async function openYoomoneyDonate(): Promise<boolean> {
  const page = await fetch(BUTTON_URL, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!page.ok) throw new Error(`ЮMoney недоступна (${page.status})`);
  const { secret, params } = formParamsFromHtml(await page.text());
  const confirm = new URL(CONFIRM_PATH);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    confirm.searchParams.set(key, String(value));
  }
  const res = await fetch(confirm, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'x-csrf-token': secret,
      Origin: 'https://yoomoney.ru',
      Referer: BUTTON_URL,
    },
    body: JSON.stringify(params),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Не удалось создать перевод ЮMoney (${res.status})`);
  await shell.openExternal(checkoutUrlFromBody(body));
  return true;
}

export function registerYoomoneyDonateIpc(): void {
  ipcMain.handle('system:openDonate', () => openYoomoneyDonate());
}
