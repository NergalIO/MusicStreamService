import type { LoginMethod } from '@mss/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { QrCode } from '@/components/connectors/QrCode';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cancelConnect, replyVkLogin, useConnectStore } from '@/lib/connectors';

const METHODS: { value: LoginMethod; label: string }[] = [
  { value: 'qr', label: 'QR-код' },
  { value: 'sms', label: 'SMS' },
  { value: 'password', label: 'Пароль' },
];

export function VkLoginDialog() {
  const connecting = useConnectStore((s) => s.connecting);
  const prompt = useConnectStore((s) => s.loginPrompt);
  const setLoginPrompt = useConnectStore((s) => s.setLoginPrompt);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [captchaKey, setCaptchaKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => window.electronAPI?.connectors.onLoginPrompt(setLoginPrompt), [setLoginPrompt]);

  useEffect(() => {
    setCode('');
    setCaptchaKey('');
    setBusy(false);
    if (prompt?.step === 'credentials' || prompt?.step === 'sms') {
      setPassword('');
    }
  }, [prompt?.step, prompt?.captchaImg, prompt?.error, prompt?.qrUrl]);

  const open = connecting === 'vk';
  const method = prompt?.method ?? 'qr';
  const step = prompt?.step ?? (method === 'password' ? 'credentials' : method);

  const submit = async (extra?: { forceSms?: boolean }) => {
    setBusy(true);
    try {
      await replyVkLogin({
        source: 'vk',
        method,
        username,
        password,
        code: code.trim() || undefined,
        captchaKey: captchaKey.trim() || undefined,
        forceSms: extra?.forceSms,
      });
    } finally {
      setBusy(false);
    }
  };

  const selectMethod = (next: LoginMethod) => {
    if (!prompt || next === method) return;
    void replyVkLogin({ source: 'vk', method: next, username, password });
  };

  const close = () => {
    void replyVkLogin({ source: 'vk', cancelled: true });
    void cancelConnect();
  };

  return (
    <Dialog open={open} onClose={close} title="Вход во VK Музыку">
      {!prompt ? (
        <div className="flex items-center gap-3 py-6 text-sm text-muted">
          <Loader2 className="animate-spin" size={18} /> Открываем вход…
        </div>
      ) : (
        <div className="space-y-4">
          <Segmented className="flex w-full [&>button]:flex-1" value={method} options={METHODS} onChange={selectMethod} />

          {prompt.error && <p className="text-sm text-danger">{prompt.error}</p>}

          {method === 'qr' && (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-muted">
                Откройте приложение VK на телефоне → камера или сканер QR и подтвердите вход.
              </p>
              <div className="relative mx-auto w-52">
                {prompt.qrUrl ? (
                  <QrCode value={prompt.qrUrl} className="w-full" />
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-xl bg-foreground/5">
                    <Loader2 className="animate-spin text-muted" size={22} />
                  </div>
                )}
                {prompt.qrStatus === 'scanned' && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80 text-center text-sm font-medium text-zinc-900">
                    Подтвердите вход
                    <br />
                    на телефоне
                  </div>
                )}
              </div>
              <p className="flex items-center justify-center gap-2 text-xs text-muted">
                <Loader2 className="animate-spin" size={12} />
                {prompt.qrStatus === 'scanned' ? 'Ждём подтверждение…' : 'Ждём сканирование…'}
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={close}>
                  Отмена
                </Button>
                <Button type="button" variant="secondary" onClick={() => void replyVkLogin({ source: 'vk', method: 'qr' })}>
                  Обновить код
                </Button>
              </div>
            </div>
          )}

          {method !== 'qr' && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {method === 'password' && step === 'credentials' && (
                <>
                  <p className="text-sm leading-relaxed text-muted">
                    Пароль не сохраняется — на устройстве остаётся только токен.
                  </p>
                  <Input
                    autoFocus
                    autoComplete="username"
                    placeholder="Телефон или email"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Пароль"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </>
              )}

              {method === 'sms' && step === 'sms' && (
                <p className="text-sm leading-relaxed text-muted">
                  Откроется окно VK. Введите номер телефона и код из SMS — как в приложении VK, не Kate.
                </p>
              )}

              {step === 'code' && (
                <>
                  {prompt.phoneMask && <p className="text-sm text-muted">Код отправлен на {prompt.phoneMask}</p>}
                  <Input
                    autoFocus
                    inputMode="numeric"
                    placeholder="Код из SMS или приложения"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </>
              )}

              {step === 'captcha' && (
                <>
                  {prompt.captchaImg && (
                    <img src={prompt.captchaImg} alt="Капча VK" className="h-20 rounded-lg bg-foreground/5" />
                  )}
                  <Input
                    autoFocus
                    placeholder="Символы с картинки"
                    value={captchaKey}
                    onChange={(e) => setCaptchaKey(e.target.value)}
                  />
                </>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={close}>
                  Отмена
                </Button>
                {step === 'code' && (
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void submit({ forceSms: true })}>
                    {method === 'sms' ? 'Отправить снова' : 'Прислать SMS'}
                  </Button>
                )}
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {step === 'sms' ? 'Открыть окно VK' : step === 'credentials' ? 'Продолжить' : 'Войти'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Dialog>
  );
}
