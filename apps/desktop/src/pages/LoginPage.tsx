import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLogo } from '@/components/layout/AppLogo';
import { StandaloneTitleBar } from '@/components/layout/WindowControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  completeLogin,
  EmailNotVerifiedError,
  postAuthJson,
  type AuthSession,
  type RegisterPending,
} from '@/lib/api';
import { sessionEvent } from '@/lib/logger';
import { getApiBaseUrl, setApiBaseUrl } from '@/lib/api-base';

type Step = 'credentials' | 'verify';

export function LoginPage() {
  const nav = useNavigate();
  const [serverUrl, setServerUrl] = useState(() => getApiBaseUrl());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [step, setStep] = useState<Step>('credentials');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const syncServerUrl = async (): Promise<boolean> => {
    if (import.meta.env.DEV) return true;
    const base = serverUrl.trim();
    if (!base) {
      setError('Укажите URL сервера (как на лендинге, с /MusicStreamService)');
      return false;
    }
    setApiBaseUrl(base);
    await window.electronAPI?.system.setSettings({ apiPublicUrl: base });
    return true;
  };

  const submitCredentials = async () => {
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (!(await syncServerUrl())) return;
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const data = await postAuthJson<AuthSession | RegisterPending>(path, { email, password });
      if ('needsVerification' in data && data.needsVerification) {
        setStep('verify');
        setInfo(`Код отправлен на ${data.email}`);
        return;
      }
      await completeLogin(data as AuthSession);
      nav('/');
    } catch (e) {
      if (e instanceof EmailNotVerifiedError) {
        setEmail(e.email);
        setStep('verify');
        setInfo(e.message);
        return;
      }
      const message = e instanceof Error ? e.message : 'Ошибка входа';
      sessionEvent('error', 'auth', message);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitVerify = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (!(await syncServerUrl())) return;
      const session = await postAuthJson<AuthSession>('/auth/verify-email', { email, code: code.trim() });
      await completeLogin(session);
      nav('/');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Неверный код';
      sessionEvent('error', 'auth', message);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (!(await syncServerUrl())) return;
      await postAuthJson('/auth/resend-verification', { email, password });
      setInfo('Новый код отправлен');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить код');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <StandaloneTitleBar />
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-lg">
        <div className="mb-2 flex items-center gap-3">
          <AppLogo className="h-10 w-10" />
          <h1 className="text-2xl font-semibold">MusicStreamService</h1>
        </div>
        <p className="mb-6 text-sm text-muted">
          {step === 'verify' ? 'Подтверждение почты' : 'Войдите в свой аккаунт'}
        </p>
        <div className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted">{info}</div>
          )}
          {step === 'credentials' && (
            <>
              {!import.meta.env.DEV && (
                <Input
                  placeholder="https://your-domain/MusicStreamService"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  autoComplete="url"
                />
              )}
              <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              <Input
                type="password"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                onKeyDown={(e) => e.key === 'Enter' && void submitCredentials()}
              />
              <Button className="w-full" disabled={submitting} onClick={() => void submitCredentials()}>
                {mode === 'login' ? 'Войти' : 'Регистрация'}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted hover:text-foreground"
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login');
                  setError(null);
                }}
              >
                {mode === 'login' ? 'Создать аккаунт' : 'Уже есть аккаунт?'}
              </button>
            </>
          )}
          {step === 'verify' && (
            <>
              <Input
                placeholder="6-значный код"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                onKeyDown={(e) => e.key === 'Enter' && void submitVerify()}
              />
              <Button className="w-full" disabled={submitting || code.length !== 6} onClick={() => void submitVerify()}>
                Подтвердить
              </Button>
              <Button variant="secondary" className="w-full" disabled={submitting} onClick={() => void resendCode()}>
                Отправить код снова
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted hover:text-foreground"
                onClick={() => {
                  setStep('credentials');
                  setCode('');
                  setError(null);
                  setInfo(null);
                }}
              >
                Назад
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
