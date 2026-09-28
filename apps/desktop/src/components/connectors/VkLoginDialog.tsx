import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cancelConnect, replyVkLogin, useConnectStore } from '@/lib/connectors';

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
    if (prompt?.step === 'credentials') {
      setPassword('');
    }
  }, [prompt?.step, prompt?.captchaImg, prompt?.error]);

  const open = connecting === 'vk';
  const step = prompt?.step ?? 'credentials';

  const submit = async (extra?: { forceSms?: boolean }) => {
    setBusy(true);
    try {
      await replyVkLogin({
        source: 'vk',
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
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm leading-relaxed text-muted">
            Пароль не сохраняется — на устройстве остаётся только токен. VK может запросить код из приложения или SMS.
          </p>
          {prompt.error && <p className="text-sm text-danger">{prompt.error}</p>}

          {step === 'credentials' && (
            <>
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

          {step === 'code' && (
            <>
              {prompt.phoneMask && <p className="text-sm text-muted">Код отправлен на {prompt.phoneMask}</p>}
              <Input
                autoFocus
                inputMode="numeric"
                placeholder="Код подтверждения"
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
                Прислать SMS
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {step === 'credentials' ? 'Войти' : 'Продолжить'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
