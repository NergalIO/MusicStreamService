import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SPOTIFY_WEB } from '@/lib/service-routes';

const ERROR_MESSAGES: Record<string, string> = {
  captcha_required: 'Spotify просит подтвердить, что это вы',
  web_continue_required:
    'Email подставлен в веб-плеер. Нажмите Continue там, затем введите пароль или код здесь.',
  login_failed: 'Не удалось войти — проверьте данные',
  login_email_missing: 'Форма входа Spotify не загрузилась',
  login_password_missing: 'Введите пароль',
  login_code_missing: 'Введите код из письма',
  invalid_email: 'Некорректный email',
  invalid_password: 'Некорректный пароль',
  invalid_code: 'Некорректный код',
  login_timeout: 'Не удалось подтвердить вход — попробуйте ещё раз',
};

function SpotifyCaptchaFrame() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !window.electronAPI) return;
    let cancelled = false;
    const sync = () => {
      const r = el.getBoundingClientRect();
      void window.electronAPI!.spotifySession.setBounds({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.max(0, Math.round(r.width)),
        height: Math.max(0, Math.round(r.height)),
      });
    };
    const start = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (cancelled) return;
      sync();
      await window.electronAPI!.spotifySession.show();
      if (!cancelled) sync();
    };
    void start();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener('resize', sync);
      void window.electronAPI!.spotifySession.hide();
    };
  }, []);

  return <div ref={hostRef} className="h-[420px] w-full overflow-hidden rounded-xl bg-black" />;
}

export function SpotifyLoginDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'password' | 'code' | 'done' | 'captcha'>('email');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [useEmailCode, setUseEmailCode] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setInfo(null);
    setStep('email');
    setCode('');
    setPassword('');
    setUseEmailCode(false);
  }, [open]);

  useEffect(() => {
    if (!open || step !== 'captcha' || !window.electronAPI) return;
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      onSuccess?.();
      onClose();
    };
    const tick = async () => {
      try {
        const auth = await window.electronAPI!.spotifySession.auth();
        if (cancelled) return;
        if (auth.loggedIn) {
          finish();
          return;
        }
        if (auth.step === 'password' || auth.step === 'code') {
          setStep(auth.step);
          setError(null);
          setInfo(auth.step === 'code' ? 'Код отправлен на почту — введите его ниже' : 'Введите пароль Spotify');
        }
      } catch {
        /* webview navigating */
      }
    };
    const timer = window.setInterval(() => void tick(), 800);
    void tick();
    const unsub = window.electronAPI.spotifySession.onLoggedIn((loggedIn) => {
      if (loggedIn) finish();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsub?.();
    };
  }, [open, step, onClose, onSuccess]);

  async function submitLogin(opts?: { password?: string; code?: string }) {
    if (!email.trim()) {
      setError('Укажите email');
      return;
    }
    if (!window.electronAPI) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const sentCode = Boolean(opts?.code ?? (code || undefined));
      const result = await window.electronAPI.spotifySession.login({
        email: email.trim(),
        password: useEmailCode ? undefined : (opts?.password ?? (password || undefined)),
        code: opts?.code ?? (code || undefined),
      });
      if (result.error === 'captcha_required' || result.captcha) {
        setStep('captcha');
        setError(null);
        setInfo(ERROR_MESSAGES.captcha_required);
        return;
      }
      setStep(result.step);
      if (result.error === 'web_continue_required') {
        setInfo(ERROR_MESSAGES.web_continue_required);
      } else if (result.error) {
        setError(ERROR_MESSAGES[result.error] ?? result.error);
        if (result.step === 'code' || result.step === 'password') setStep(result.step);
      } else if (result.loggedIn) {
        setPassword('');
        setCode('');
        onSuccess?.();
        onClose();
      } else if (sentCode && !result.loggedIn) {
        if (result.step === 'code') setError(ERROR_MESSAGES.login_failed);
        else setError(ERROR_MESSAGES.web_continue_required);
      } else if (result.step === 'password') {
        setInfo('Введите пароль Spotify');
      } else if (result.step === 'code' || result.codeRequired) {
        setInfo('Код отправлен на почту — введите его ниже');
      } else if (result.step === 'email') {
        setInfo(ERROR_MESSAGES.web_continue_required);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const captcha = step === 'captcha';
  const primaryLabel =
    step === 'code' || code
      ? 'Подтвердить код'
      : !useEmailCode && (step === 'password' || password)
        ? 'Войти'
        : 'Продолжить';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Вход в Spotify"
      className={captcha ? 'max-w-xl' : undefined}
    >
      {captcha ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Пройдите проверку Spotify в окне ниже — после этого вход продолжится сам.</p>
          <SpotifyCaptchaFrame />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">Email авторизации в Spotify.</p>
          <div className="mt-4 space-y-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={busy}
            />
            {(step === 'password' || password) && !useEmailCode && (
              <Input
                type="password"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
                onKeyDown={(e) => e.key === 'Enter' && void submitLogin()}
              />
            )}
            {(step === 'code' || code) && (
              <Input
                type="text"
                placeholder="Код из письма"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                disabled={busy}
                onKeyDown={(e) => e.key === 'Enter' && void submitLogin()}
              />
            )}
            {step !== 'code' && !code && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={useEmailCode}
                  onChange={(e) => setUseEmailCode(e.target.checked)}
                  disabled={busy}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                Вход по коду с почты
              </label>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-muted">{info}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button disabled={busy} onClick={() => void submitLogin()}>
                {busy && <Loader2 size={14} className="animate-spin" />}
                {primaryLabel}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  onClose();
                  navigate(SPOTIFY_WEB);
                }}
              >
                Веб-плеер
              </Button>
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}
