/**
 * Page-side play helpers for hosts that cannot run SpotifyInjectorSession
 * (e.g. Android WebView). Tries bridge.play, then public player API, then
 * track-page header play button.
 */
export function playWithFallbacksScript(trackId: string, positionMs = 0): string {
  const id = JSON.stringify(trackId);
  const pos = Math.max(0, Math.floor(positionMs));
  return `(async () => {
  const trackId = ${id};
  const positionMs = ${pos};
  const uri = 'spotify:track:' + trackId;
  const toastUnavailable = () => {
    const nodes = document.querySelectorAll('[role="alert"], [role="status"], [data-testid*="toast"]');
    for (const el of nodes) {
      if (/этот трек недоступен|this track is unavailable|isn't available/i.test(el.textContent ?? '')) return true;
    }
    return false;
  };
  const confirmPlaying = async () => {
    for (let i = 0; i < 12; i += 1) {
      if (toastUnavailable()) return false;
      const state = window.__spotifyBridge?.getState?.();
      if (state && (state.id === trackId || state.uri === uri) && state.isPlaying) return true;
      if (state && state.isPlaying && state.id && state.id !== trackId && state.uri && !String(state.uri).includes(':ad:')) {
        try { await window.__spotifyBridge?.pause?.(); } catch (_e) {}
        return false;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };
  const bridge = window.__spotifyBridge;
  if (!bridge) return { ok: false, error: 'bridge_missing' };
  try {
    const play = await bridge.play({ uri, positionMs });
    if (play?.ok && (await confirmPlaying())) {
      const s = bridge.getState();
      return {
        ok: true,
        ready: s?.ready ?? true,
        playing: s?.isPlaying ?? true,
        positionMs: s?.positionMs ?? positionMs,
        durationMs: s?.durationMs || 0,
        title: s?.title || '',
        trackId: s?.id || trackId,
        cancelled: false,
      };
    }
    if (play?.error === 'track_unavailable' || toastUnavailable()) {
      return { ok: false, error: 'track_unavailable' };
    }
  } catch (e) {
    /* try fallbacks */
  }
  const capture = window.__spotifyAuthCapture;
  const token = capture?.accessToken;
  if (token) {
    try {
      const body = {
        uris: [uri],
        position_ms: positionMs,
      };
      const res = await fetch('https://api.spotify.com/v1/me/player/play', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          ...(capture.clientToken ? { 'client-token': capture.clientToken } : {}),
        },
        body: JSON.stringify(body),
      });
      if ((res.ok || res.status === 204) && (await confirmPlaying())) {
        const s = bridge.getState();
        return {
          ok: true,
          ready: s?.ready ?? true,
          playing: s?.isPlaying ?? true,
          positionMs: s?.positionMs ?? positionMs,
          durationMs: s?.durationMs || 0,
          title: s?.title || '',
          trackId: s?.id || trackId,
          cancelled: false,
        };
      }
    } catch {
      /* continue */
    }
  }
  if (!location.pathname.includes('/track/' + trackId)) {
    location.href = 'https://open.spotify.com/track/' + trackId;
    await new Promise((r) => setTimeout(r, 800));
  }
  const deadline = Date.now() + 4000;
  const headerPlay = () => {
    const main = document.querySelector('main') ?? document.body;
    const buttons = main.querySelectorAll('[data-testid="play-button"], [data-testid="entity-action-play"]');
    for (const el of buttons) {
      if (!(el instanceof HTMLElement)) continue;
      const label = (el.getAttribute('aria-label') ?? '').toLowerCase();
      if (/pause|пауза/.test(label)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width >= 24 && rect.height >= 24) return el;
    }
    return null;
  };
  while (Date.now() < deadline) {
    const btn = headerPlay();
    if (btn) {
      btn.click();
      if (await confirmPlaying()) {
        const s = bridge.getState();
        return {
          ok: true,
          ready: s?.ready ?? true,
          playing: s?.isPlaying ?? true,
          positionMs: s?.positionMs ?? positionMs,
          durationMs: s?.durationMs || 0,
          title: s?.title || '',
          trackId: s?.id || trackId,
          cancelled: false,
        };
      }
      return { ok: false, error: toastUnavailable() ? 'track_unavailable' : 'player_method_missing' };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { ok: false, error: 'player_method_missing' };
})()`;
}
