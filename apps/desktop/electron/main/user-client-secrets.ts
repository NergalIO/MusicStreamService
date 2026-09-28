import {
  clientSecret,
  clientSecretSource,
  type UserClientSecretKey,
} from './client-secrets.js';
import { getAppSettings, updateAppSettings, type AppSettings } from './app-settings.js';

export interface ClientSecretFieldView {
  userValue: string;
  effectiveSet: boolean;
  source: ReturnType<typeof clientSecretSource>;
}

export interface ClientSecretsView {
  fields: Record<UserClientSecretKey, ClientSecretFieldView>;
  yandexCustomOAuth: boolean;
}

export function yandexCustomOAuthEnabled(): boolean {
  const s = getAppSettings();
  if (s.yandexCustomOAuth !== undefined) return s.yandexCustomOAuth;
  return process.env.MSS_YANDEX_CUSTOM_OAUTH === '1' || process.env.MSS_YANDEX_CUSTOM_OAUTH === 'true';
}

export function clientSecretsView(): ClientSecretsView {
  const keys: UserClientSecretKey[] = ['SPOTIFY_CLIENT_ID', 'DISCORD_CLIENT_ID', 'YANDEX_CLIENT_ID', 'YANDEX_CLIENT_SECRET'];
  const fields = {} as Record<UserClientSecretKey, ClientSecretFieldView>;
  for (const key of keys) {
    fields[key] = {
      userValue: getAppSettings().userClientSecrets?.[key]?.trim() ?? (key === 'DISCORD_CLIENT_ID' ? getAppSettings().discordClientId?.trim() ?? '' : ''),
      effectiveSet: Boolean(clientSecret(key)),
      source: clientSecretSource(key),
    };
  }
  return { fields, yandexCustomOAuth: yandexCustomOAuthEnabled() };
}

export function setUserClientSecrets(patch: {
  secrets?: Partial<Record<UserClientSecretKey, string | null>>;
  yandexCustomOAuth?: boolean;
}): ClientSecretsView {
  const prev = getAppSettings();
  const nextSecrets = { ...prev.userClientSecrets };
  if (patch.secrets) {
    for (const [k, v] of Object.entries(patch.secrets) as [UserClientSecretKey, string | null | undefined][]) {
      const trimmed = v?.trim() ?? '';
      if (trimmed) nextSecrets[k] = trimmed;
      else delete nextSecrets[k];
    }
  }
  const settingsPatch: Partial<AppSettings> = { userClientSecrets: nextSecrets };
  if (patch.yandexCustomOAuth !== undefined) settingsPatch.yandexCustomOAuth = patch.yandexCustomOAuth;
  if (nextSecrets.DISCORD_CLIENT_ID) settingsPatch.discordClientId = nextSecrets.DISCORD_CLIENT_ID;
  else if (patch.secrets && 'DISCORD_CLIENT_ID' in patch.secrets) settingsPatch.discordClientId = undefined;
  updateAppSettings(settingsPatch);
  return clientSecretsView();
}
