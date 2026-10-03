export const READ_NOW_PLAYING_LIKED = `(() => {
  const isShown = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  };
  const scopes = [
    document.querySelector('[data-testid="now-playing-widget"]'),
    document.querySelector('[data-testid="now-playing-bar"]'),
    document.querySelector('[data-testid="now-playing-bar-container"]'),
    document.querySelector('footer'),
  ];
  const isHeart = (el) => {
    const testid = el.getAttribute('data-testid') ?? '';
    if (/add-button|remove-button|heart|save/.test(testid)) return true;
    const label = (el.getAttribute('aria-label') ?? '') + ' ' + (el.textContent ?? '');
    return /любим|liked song|save to|add to liked|your library|медиатек|добавить в плейлист|add to playlist/i.test(label);
  };
  for (const scope of scopes) {
    if (!scope) continue;
    const remove = scope.querySelector('[data-testid="remove-button"]');
    const add = scope.querySelector('[data-testid="add-button"]');
    if (isShown(remove) && !isShown(add)) return true;
    if (isShown(add) && !isShown(remove)) return false;
    for (const btn of Array.from(scope.querySelectorAll("button[aria-checked], [role='checkbox'][aria-checked]"))) {
      if (!isShown(btn) || !isHeart(btn)) continue;
      return btn.getAttribute('aria-checked') === 'true';
    }
  }
  return null;
})()`;

export function clickNowPlayingLikeScript(liked: boolean): string {
  return `(() => {
    const wantLiked = ${liked ? 'true' : 'false'};
    const isShown = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return el.getClientRects().length > 0;
    };
    const isHeart = (el) => {
      const testid = el.getAttribute('data-testid') ?? '';
      if (/add-button|remove-button|heart|save/.test(testid)) return true;
      const label = (el.getAttribute('aria-label') ?? '') + ' ' + (el.textContent ?? '');
      return /любим|liked song|save to|add to liked|your library|медиатек|добавить в плейлист|add to playlist/i.test(label);
    };
    const scopes = [
      document.querySelector('[data-testid="now-playing-widget"]'),
      document.querySelector('[data-testid="now-playing-bar"]'),
      document.querySelector('[data-testid="now-playing-bar-container"]'),
      document.querySelector('footer'),
    ];
    for (const scope of scopes) {
      if (!scope) continue;
      const remove = scope.querySelector('[data-testid="remove-button"]');
      const add = scope.querySelector('[data-testid="add-button"]');
      if (wantLiked && isShown(remove) && !isShown(add)) return true;
      if (!wantLiked && isShown(add) && !isShown(remove)) return true;
      const target = wantLiked ? add : remove;
      if (isShown(target)) {
        target.click();
        return true;
      }
      for (const btn of Array.from(scope.querySelectorAll("button[aria-checked], [role='checkbox'][aria-checked]"))) {
        if (!isShown(btn) || !isHeart(btn)) continue;
        const checked = btn.getAttribute('aria-checked') === 'true';
        if (checked === wantLiked) return true;
        btn.click();
        return true;
      }
    }
    return false;
  })()`;
}

export function runLibraryApiScript(uri: string, liked: boolean, mode: 'mutate' | 'sync'): string {
  return `(async () => {
    const trackUri = ${JSON.stringify(uri)};
    const wantLiked = ${liked ? 'true' : 'false'};
    const runMode = ${JSON.stringify(mode)};
    const isLibraryApi = (value) => {
      if (!value || typeof value !== 'object') return false;
      return typeof value.add === 'function' && typeof value.remove === 'function' && typeof value.contains === 'function';
    };
    const seen = new Set();
    const found = [];
    const visit = (value, depth) => {
      if (!value || depth > 5 || found.length > 0) return;
      if (typeof value !== 'object') return;
      if (seen.has(value)) return;
      if (value instanceof Node) return;
      seen.add(value);
      if (isLibraryApi(value)) { found.push(value); return; }
      if (isLibraryApi(value.LibraryAPI)) { found.push(value.LibraryAPI); return; }
      if (isLibraryApi(value.libraryAPI)) { found.push(value.libraryAPI); return; }
      visit(value.Platform, depth + 1);
      visit(value.default, depth + 1);
      visit(value._currentValue, depth + 1);
      visit(value.value, depth + 1);
    };
    visit(window.Spicetify?.Platform?.LibraryAPI ?? null, 0);
    const webpack = { req: null };
    for (const key of Object.getOwnPropertyNames(window)) {
      if (!key.startsWith('webpackChunk')) continue;
      const chunks = window[key];
      if (!Array.isArray(chunks)) continue;
      try {
        chunks.push([[Symbol.for('spotify-injector-library')], {}, (req) => { webpack.req = req; }]);
      } catch (e) {}
    }
    const cache = webpack.req?.c;
    if (cache) {
      for (const id of Object.keys(cache)) {
        visit(cache[id]?.exports, 0);
        if (found.length > 0) break;
      }
    }
    if (found.length === 0) {
      const roots = [document.getElementById('main'), document.getElementById('root'), document.body];
      for (const node of roots) {
        if (!node || found.length > 0) continue;
        for (const key of Object.keys(node)) {
          if (!key.startsWith('__reactFiber$') && !key.startsWith('__reactInternalInstance$')) continue;
          const stack = [node[key]];
          let budget = 5000;
          while (stack.length > 0 && budget > 0 && found.length === 0) {
            budget -= 1;
            const fiber = stack.pop();
            if (!fiber || typeof fiber !== 'object') continue;
            visit(fiber.memoizedProps, 2);
            visit(fiber.memoizedState, 2);
            visit(fiber.stateNode, 2);
            visit(fiber.pendingProps, 2);
            if (fiber.child) stack.push(fiber.child);
            if (fiber.sibling) stack.push(fiber.sibling);
          }
        }
      }
    }
    const api = found[0];
    if (!isLibraryApi(api)) return { ok: false, method: 'missing', error: 'library_api_missing' };
    const sync = () => {
      try {
        api._cache?.set?.(trackUri, wantLiked);
        if (typeof api.onUpdateItems === 'function') api.onUpdateItems([trackUri], wantLiked);
        else api._events?.emitUpdateItems?.([trackUri], wantLiked);
        return true;
      } catch (e) {
        return false;
      }
    };
    if (runMode === 'sync') {
      const ok = sync();
      return { ok, method: ok ? 'library_sync' : 'library_sync_failed' };
    }
    try {
      if (wantLiked) await api.add({ uris: [trackUri] });
      else await api.remove({ uris: [trackUri] });
      sync();
      return { ok: true, method: 'library_api' };
    } catch (err) {
      return { ok: false, method: 'library_api', error: String(err && err.message || err) };
    }
  })()`;
}

export const PEEK_TRACK_URI = `(() => {
  const b = window.__spotifyBridge;
  const u = b?.getState?.()?.uri;
  return typeof u === 'string' && u.length > 0 ? u : null;
})()`;
