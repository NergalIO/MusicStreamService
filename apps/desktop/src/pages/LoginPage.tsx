import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLogo } from '@/components/layout/AppLogo';
import { StandaloneTitleBar } from '@/components/layout/WindowControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, saveSession } from '@/lib/api';
import type { AuthSession } from '@/lib/api';
import { getApiBaseUrl, setApiBaseUrl } from '@/lib/api-base';

export function LoginPage() {
  const nav = useNavigate();
  const [serverUrl, setServerUrl] = useState(() => getApiBaseUrl());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (!import.meta.env.DEV) {
        const base = serverUrl.trim();
        if (!base) {
          setError('Укажите URL сервера (как на лендинге, с /MusicStreamService)');
          setSubmitting(false);
          return;
        }
        setApiBaseUrl(base);
        await window.electronAPI?.system.setSettings({ apiPublicUrl: base });
      }
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const data = await apiFetch<AuthSession>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      saveSession(data);
      const deviceId = await window.electronAPI.getDeviceId();
      await apiFetch('/devices/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, name: 'Desktop' }),
      });
      nav('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка входа');
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
        <p className="mb-6 text-sm text-muted">Войдите в свой аккаунт</p>
        <div className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
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
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
          <Button className="w-full" disabled={submitting} onClick={() => void submit()}>
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
        </div>
      </div>
    </div>
  );
}
