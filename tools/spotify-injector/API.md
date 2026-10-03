# SpotifyInjector HTTP API

Локальный JSON-сервер на `127.0.0.1` (по умолчанию порт **3939**). Управляет встроенным Spotify Web Player в Electron (`WebContentsView` → `open.spotify.com`). Внешний Chrome не используется. Снаружи Spotify не торчит: все запросы только на localhost.

Запуск из корня монорепо: `pnpm --filter @mss/spotify-injector start` — одно окно Electron: Spotify WebContents + HTTP API в том же процессе. Команды идут через `webContents.executeJavaScript` → `window.__spotifyBridge` (без CDP).

Опционально через env: `SPOTIFY_INJECTOR_API=3939`.

База:

```
http://127.0.0.1:3939
```

Тела запросов — JSON (`Content-Type: application/json`). Ответы — JSON, UTF-8.

Пустой POST-body допустим: сервер считает его `{}`.

Команды воспроизведения после успеха пушат свежий снимок в WebSocket `/events`.

---

Общие коды HTTP

- **200** — запрос обработан. Смотри поле `ok` в JSON: операция могла не удаться (`ok: false`, `error`).
- **400** — кривой JSON / параметры (`invalid_json`, `invalid_uri`, …).
- **404** — нет такого пути (`not_found`).
- **503** — нет WebContents Spotify в Electron.
- **500** — внутренняя ошибка.

Частые `error` в теле:

| error | смысл |
|---|---|
| `auth_missing` | нет Bearer-токена. Сначала `POST /auth`, затем `GET /auth` с непустым `accessToken` |
| `no_track` | нет `uri` и сейчас ничего не играет |
| `invalid_uri` | URI/ссылка/id не разобрались |
| `bridge_missing` | инжект во вкладке ещё не готов |
| `player_method_missing` | веб-плеер не отдал нужный метод |
| `not_found` | неизвестный путь |

URI, которые принимает API (где нужен трек/контекст):

- `spotify:track:4cOdK2wGLETKBW3PvgPWqT`
- `spotify:album:…` / `spotify:playlist:…` / `spotify:artist:…` / `spotify:episode:…` / `spotify:show:…`
- ссылка `https://open.spotify.com/track/…` (в том числе `/intl-ru/…`)
- голый id из 22 символов — считается **треком**

PowerShell: кириллицу в query лучше кодировать через `[uri]::EscapeDataString`.

============ GET /health =============

Проверка, что инжектор жив и видит вкладку.

Ничего передавать не нужно.

Ответ:

```json
{
  "ok": true,
  "tab": true,
  "bridge": true,
  "url": "https://open.spotify.com/"
}
```

- `ok` — вкладка есть **и** мост `__spotifyBridge` установлен
- `tab` — найдена вкладка Spotify / accounts
- `bridge` — инжект в странице есть
- `url` — текущий URL вкладки или `null`

```powershell
Invoke-RestMethod http://127.0.0.1:3939/health
```

============ GET /auth =============

Текущая сессия Spotify: залогинен ли аккаунт, Premium, токены веб-плеера.

Ничего передавать не нужно.

Ответ:

```json
{
  "ok": true,
  "loggedIn": true,
  "hasPremium": true,
  "step": "done",
  "codeRequired": false,
  "accessToken": "BQA…",
  "expiresAt": 1730000000000,
  "tokenType": "Bearer",
  "clientToken": "…",
  "error": null
}
```

- `loggedIn` — сессия есть (cookie `sp_dc`, меню пользователя или токен). Может быть `true` при `accessToken: null`, если токен ещё не считали
- `hasPremium` — продукт аккаунта Premium (иначе рекламный/free)
- `step` — `email` | `password` | `code` | `done`
- `codeRequired` — `true`, когда сейчас шаг OTP (`step: "code"`)
- `accessToken` / `tokenType` / `expiresAt` — Bearer веб-плеера. Нужны для `/like`, `/search`, `/lyrics`, `/devices`, `/transfer`
- `clientToken` — заголовок `client-token` веб-плеера, если поймали

Лайк/поиск/тексты/устройства без Bearer вернут `auth_missing`. Если `loggedIn` true, а токены пустые — заново `POST /auth` (как после повторного входа).

```powershell
Invoke-RestMethod http://127.0.0.1:3939/auth | ConvertTo-Json -Depth 5
```

============ POST /auth =============

Вход на `accounts.spotify.com`: email, затем пароль **или** код из письма. Если уже открыта страница OTP/пароля, повторно email не вводится (чтобы не сжечь код).

Тело JSON:

| поле | обязательно | описание |
|---|---|---|
| `email` | да | почта аккаунта |
| `password` | нет | пароль. Если нет — пойдёт passwordless / код |
| `code` | нет | OTP, 4–8 символов (пробелы выкидываются) |

Только email — старт потока:

```json
{ "email": "user@example.com" }
```

Код (если уже на шаге OTP, email всё равно нужен в теле, но страница не сбрасывается):

```json
{ "email": "user@example.com", "code": "123456" }
```

Пароль:

```json
{ "email": "user@example.com", "password": "secret" }
```

Ответ — тот же объект, что `GET /auth`. После успешного входа `step: "done"`, `loggedIn: true`. Токены могут доехать с задержкой; если пустые — подожди и сделай `GET /auth`.

`codeRequired: true` — сервер ждёт OTP, не пароль.

Ошибки валидации (**400**): `invalid_email`, `invalid_password`, `invalid_code`.

Ошибки входа (**200**, `ok: false`): `captcha_required`, `login_failed`, `login_timeout`, `login_email_missing`, `login_code_missing`, `login_password_missing`, `auth_step_mismatch`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/auth -Method POST -ContentType application/json -Body '{"email":"user@example.com"}'
```

============ GET /state =============

Снимок текущего трека и плеера. `positionMs` экстраполируется по времени, пока трек играет.

Ничего передавать не нужно.

Ответ:

```json
{
  "ready": true,
  "uri": "spotify:track:…",
  "id": "4cOdK2wGLETKBW3PvgPWqT",
  "title": "Never Gonna Give You Up",
  "artists": ["Rick Astley"],
  "album": "Whenever You Need Somebody",
  "durationMs": 213000,
  "positionMs": 15420,
  "isPlaying": true,
  "liked": true,
  "volume": 0.72,
  "shuffle": false,
  "repeat": "off",
  "muted": false,
  "sampledAt": 1730000000000,
  "source": "player"
}
```

- `ready` — плеер отдал осмысленное состояние
- `liked` — в медиатеке или нет; `null`, если неизвестно
- `volume` — **0…1**, не проценты
- `shuffle` — `true` / `false` / `"Unavailable"`
- `repeat` — `"off"` / `"context"` / `"track"` / `"Unavailable"`
- `source` — `"player"` (объект плеера) или `"dom"` (разметка)

```powershell
Invoke-RestMethod http://127.0.0.1:3939/state
```

============ WS /events =============

WebSocket, не HTTP. Сразу после подключения приходит текущий снимок (тот же JSON, что `GET /state`). Дальше — при смене трека, play/pause, лайка, громкости, shuffle/repeat/mute и примерно раз в секунду `positionMs`, пока играет.

```
ws://127.0.0.1:3939/events
```

При ошибке снимок может быть `{ "ok": false, "error": "…" }`.

============ POST /pause =============

Пауза. Тело не нужно.

Ответ: `{ "ok": true }` или `{ "ok": false, "error": "…" }`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/pause -Method POST
```

============ POST /resume =============

Продолжить воспроизведение. Тело не нужно.

Ответ: `{ "ok": true }` / `{ "ok": false, "error": "…" }`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/resume -Method POST
```

============ POST /next =============

Следующий трек. Тело не нужно.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/next -Method POST
```

============ POST /previous =============

Предыдущий трек. Тело не нужно.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/previous -Method POST
```

============ POST /play =============

Включить URI: трек, альбом, плейлист, артист, эпизод, шоу.

Тело:

| поле | обязательно | описание |
|---|---|---|
| `uri` | да | Spotify URI, ссылка open.spotify.com или id трека |
| `offsetUri` | нет | конкретный **трек** внутри альбома/плейлиста |
| `positionMs` | нет | старт с позиции, мс, ≥ 0 |

```json
{ "uri": "spotify:track:4cOdK2wGLETKBW3PvgPWqT" }
```

Альбом с трека:

```json
{
  "uri": "spotify:album:3dB0bB19ywL4DXsp3wysfU",
  "offsetUri": "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
  "positionMs": 0
}
```

**400:** `invalid_uri`, `invalid_offset_uri`, `invalid_position`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/play -Method POST -ContentType application/json -Body '{"uri":"spotify:track:4cOdK2wGLETKBW3PvgPWqT"}'
```

============ POST /volume =============

Громкость локального веб-плеера.

Тело:

| поле | обязательно | описание |
|---|---|---|
| `level` | да | число **от 0 до 1** включительно |

```json
{ "level": 0.5 }
```

**400:** `invalid_volume` (не число или вне 0…1). `0.72` ≈ 72%.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/volume -Method POST -ContentType application/json -Body '{"level":0.5}'
```

============ POST /seek =============

Перемотка текущего трека.

Тело:

| поле | обязательно | описание |
|---|---|---|
| `positionMs` | да | миллисекунды от начала, ≥ 0 |

```json
{ "positionMs": 30000 }
```

**400:** `invalid_position`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/seek -Method POST -ContentType application/json -Body '{"positionMs":30000}'
```

============ POST /shuffle =============

Шаффл.

Тело:

| поле | обязательно | описание |
|---|---|---|
| `enabled` | да | `true` / `false` |

```json
{ "enabled": true }
```

**400:** `invalid_shuffle`. Если веб-плеер шаффл не отдаёт, ответ может быть `ok: false` или в `/state` будет `"shuffle": "Unavailable"`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/shuffle -Method POST -ContentType application/json -Body '{"enabled":true}'
```

============ POST /repeat =============

Повтор.

Тело:

| поле | обязательно | описание |
|---|---|---|
| `mode` | да | `"off"` — выкл, `"context"` — альбом/очередь, `"track"` — один трек |

```json
{ "mode": "context" }
```

**400:** `invalid_repeat`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/repeat -Method POST -ContentType application/json -Body '{"mode":"track"}'
```

============ POST /mute =============

Мьют.

Тело:

| поле | обязательно | описание |
|---|---|---|
| `muted` | да | `true` — выключить звук, `false` — вернуть |

```json
{ "muted": true }
```

**400:** `invalid_mute`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/mute -Method POST -ContentType application/json -Body '{"muted":true}'
```

============ POST /queue =============

Добавить **трек** в очередь (не альбом/плейлист).

Тело:

| поле | обязательно | описание |
|---|---|---|
| `uri` | да | URI/ссылка/id **трека** |

```json
{ "uri": "spotify:track:4cOdK2wGLETKBW3PvgPWqT" }
```

**400:** `invalid_uri`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/queue -Method POST -ContentType application/json -Body '{"uri":"spotify:track:4cOdK2wGLETKBW3PvgPWqT"}'
```

============ GET /like =============

Проверить, есть ли сущность в медиатеке. Нужен Bearer (`GET /auth` → `accessToken`).

Query:

| параметр | обязательно | описание |
|---|---|---|
| `uri` | нет | что проверить. Нет параметра — текущий трек из `/state` |

Примеры: `/like`, `/like?uri=spotify:track:…`

Успех:

```json
{
  "ok": true,
  "liked": true,
  "uri": "spotify:track:4cOdK2wGLETKBW3PvgPWqT"
}
```

Ошибки: `auth_missing`, `no_track`, `invalid_uri` (**400** если `uri` кривой), `like_failed`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/like
Invoke-RestMethod "http://127.0.0.1:3939/like?uri=spotify:track:4cOdK2wGLETKBW3PvgPWqT"
```

============ POST /like =============

Поставить или снять лайк. Нужен Bearer. Без `uri` — текущий трек.

Тело (можно `{}`):

| поле | обязательно | описание |
|---|---|---|
| `uri` | нет | URI/ссылка/id. Нет — текущий трек |
| `liked` | нет | `true` (по умолчанию) — в медиатеку, `false` — убрать |

Лайк текущего:

```json
{}
```

Снять лайк с трека:

```json
{ "uri": "spotify:track:4cOdK2wGLETKBW3PvgPWqT", "liked": false }
```

Успех: `{ "ok": true, "liked": true, "uri": "spotify:track:…" }`.

**400:** `invalid_uri`, `invalid_liked`. Иначе: `auth_missing`, `no_track`, `like_failed`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/like -Method POST
Invoke-RestMethod http://127.0.0.1:3939/like -Method POST -ContentType application/json -Body '{"liked":false}'
```

============ GET /search =============

Поиск по каталогу: треки, альбомы, плейлисты, артисты. Нужен Bearer. Ответ — плоский список.

Query:

| параметр | обязательно | описание |
|---|---|---|
| `q` | да | строка поиска, не пустая |
| `limit` | нет | целое **1…50**, по умолчанию **20** |

Успех:

```json
{
  "ok": true,
  "results": [
    {
      "type": "track",
      "uri": "spotify:track:…",
      "id": "…",
      "title": "Батареи",
      "subtitle": "Нервы"
    }
  ]
}
```

`type`: `track` | `album` | `playlist` | `artist`.  
`subtitle` — артисты (трек/альбом), владелец (плейлист), пусто у артиста.

**400:** `invalid_query`, `invalid_limit`. Иначе: `auth_missing`, `search_failed`.

```powershell
Invoke-RestMethod ("http://127.0.0.1:3939/search?q=" + [uri]::EscapeDataString("Нервы - Батареи"))
Invoke-RestMethod ("http://127.0.0.1:3939/search?q=" + [uri]::EscapeDataString("Нервы - Батареи") + "&limit=10")
```

Найденный трек можно сразу включить через `POST /play` с полем `uri` из `results`.

============ GET /lyrics =============

Синхронные тексты текущего или указанного **трека**. Нужен Bearer. Только треки (не альбом/плейлист).

Query:

| параметр | обязательно | описание |
|---|---|---|
| `uri` | нет | трек. Нет — текущий |

Успех:

```json
{
  "ok": true,
  "syncType": "LINE_SYNCED",
  "lines": [
    { "startTimeMs": 0, "words": "We're no strangers to love" },
    { "startTimeMs": 1500, "words": "You know the rules" }
  ]
}
```

`syncType` обычно `LINE_SYNCED` или `UNSYNCED`.

Нет текстов: `{ "ok": false, "error": "lyrics_unavailable" }` — это не 401.

Другие ошибки: `auth_missing`, `no_track`, `invalid_uri` (**400** если передан не трек).

```powershell
Invoke-RestMethod http://127.0.0.1:3939/lyrics
Invoke-RestMethod "http://127.0.0.1:3939/lyrics?uri=spotify:track:4cOdK2wGLETKBW3PvgPWqT"
```

============ GET /devices =============

Список Spotify Connect устройств. Нужен Bearer.

Ничего передавать не нужно.

Успех:

```json
{
  "ok": true,
  "devices": [
    {
      "id": "abcdef",
      "name": "Web Player (Electron)",
      "type": "COMPUTER",
      "isActive": true,
      "volume": 0.8
    }
  ]
}
```

- `volume` — **0…1** или `null`
- `type` — как отдал Connect (`COMPUTER`, `SMARTPHONE`, `Speaker`, …)

Ошибки: `auth_missing`, `devices_failed`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/devices
```

============ POST /transfer =============

Перевести воспроизведение на другое устройство из `GET /devices`. Нужен Bearer.

Тело:

| поле | обязательно | описание |
|---|---|---|
| `deviceId` | да | `id` из `/devices` |
| `play` | нет | `true` (по умолчанию) — сразу играть, `false` — перенести на паузе |

```json
{ "deviceId": "abcdef", "play": true }
```

Успех: `{ "ok": true }`.

**400:** `invalid_device`, `invalid_play`. Иначе: `auth_missing`, `transfer_failed`.

```powershell
Invoke-RestMethod http://127.0.0.1:3939/transfer -Method POST -ContentType application/json -Body '{"deviceId":"abcdef","play":true}'
```

============ GET /debug/methods =============

Дампа методов PlayerAPI, которые нашёл инжект. Для отладки, не для клиента.

```json
{
  "found": true,
  "methods": ["pause", "resume", "skipToNext"],
  "chunks": [],
  "hasRequire": true,
  "cacheSize": 1234
}
```

============ GET /debug/dom =============

Срез DOM плеера: testid, ссылки, слайдеры, распознанный трек из дерева.

============ GET /debug/playback =============

Media Session, часы позиции, ключи объекта плеера, live-состояние.

Эти три пути нужны, когда `/state` пустой или команда не находится в веб-плеере.

