(function () {
  var VERSION = 9;
  if (window.__mss && window.__mss.version === VERSION) return;
  if (window.__mss && window.__mss.cancel) {
    try {
      window.__mss.cancel();
    } catch (e) {
      /* previous generation */
    }
  }
  if (window.__mssObserver) {
    try {
      window.__mssObserver.disconnect();
    } catch (e) {
      /* old observer */
    }
    window.__mssObserver = null;
  }
  if (window.__mssTimers) {
    for (var ti = 0; ti < window.__mssTimers.length; ti++) {
      clearInterval(window.__mssTimers[ti]);
      clearTimeout(window.__mssTimers[ti]);
    }
    window.__mssTimers = [];
  }

  function q(sel, root) {
    return (root || document).querySelector(sel);
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function alive(el) {
    return !!(el && el.isConnected);
  }

  var nodes = {
    bar: null,
    widget: null,
    button: null,
    title: null,
    progress: null,
    position: null,
    duration: null,
    volume: null,
    connect: null,
  };

  function nowPlayingBar() {
    if (alive(nodes.bar)) return nodes.bar;
    nodes.bar = q('[data-testid="now-playing-bar"]') || q('footer');
    return nodes.bar;
  }

  function playPauseButton() {
    if (alive(nodes.button)) return nodes.button;
    nodes.button = q('[data-testid="control-button-playpause"]');
    return nodes.button;
  }

  var PAUSE_RE = /pause|pausar|pausa|pauzeren|pausieren|пауз|приостанов|一時停止|暂停/i;

  function isPauseLabel(el) {
    return PAUSE_RE.test((el && el.getAttribute('aria-label')) || '');
  }

  var AD_TITLE = /advertisement|реклама|advertencia|publicit[eé]|werbung|annuncio/i;

  function isAd() {
    if (q('[data-testid="ad-skip-button"], [data-testid="ad-cta-button"], [data-testid="preview-ad"], [data-testid="ad-banner"]')) {
      return true;
    }
    var title = ((q('[data-testid="context-item-info-title"]') || {}).textContent || '').trim();
    var sub = ((q('[data-testid="context-item-info-subtitles"]') || {}).textContent || '').trim();
    if (AD_TITLE.test(title) || AD_TITLE.test(sub)) return true;
    var widget = q('[data-testid="now-playing-widget"]');
    return AD_TITLE.test((widget && widget.getAttribute('aria-label')) || '');
  }

  function parseClock(t) {
    return (t || '')
      .trim()
      .split(':')
      .reduce(function (acc, part) {
        return acc * 60 + (Number(part) || 0);
      }, 0) * 1000;
  }

  function setRange(input, value) {
    var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(input, String(value));
    else input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function barTitle() {
    var bar = nowPlayingBar();
    var el = alive(nodes.title)
      ? nodes.title
      : (bar && bar.querySelector('[data-testid="context-item-info-title"]')) ||
        q('[data-testid="context-item-info-title"]');
    nodes.title = el;
    return ((el && el.textContent) || '').trim();
  }

  function progressInput() {
    if (alive(nodes.progress)) return nodes.progress;
    var bar = nowPlayingBar();
    nodes.progress =
      (bar && bar.querySelector('[data-testid="playback-progressbar"] input[type="range"]')) ||
      q('[data-testid="playback-progressbar"] input[type="range"]');
    return nodes.progress;
  }

  function clockEl(testId, cacheKey) {
    if (alive(nodes[cacheKey])) return nodes[cacheKey];
    var bar = nowPlayingBar();
    nodes[cacheKey] =
      (bar && bar.querySelector('[data-testid="' + testId + '"]')) || q('[data-testid="' + testId + '"]');
    return nodes[cacheKey];
  }

  function readProgress() {
    var progress = progressInput();
    var clockPos = parseClock((clockEl('playback-position', 'position') || {}).textContent);
    var clockDur = parseClock((clockEl('playback-duration', 'duration') || {}).textContent);
    if (!progress) return { positionMs: clockPos, durationMs: clockDur };
    var max = Number(progress.max);
    var val = Number(progress.value);
    if (max > 1000) return { positionMs: val, durationMs: max };
    if (max > 0 && clockDur > 0) return { positionMs: (val / max) * clockDur, durationMs: clockDur };
    return { positionMs: clockPos, durationMs: clockDur };
  }

  function barTrackId() {
    var bar = alive(nodes.widget)
      ? nodes.widget
      : q('[data-testid="now-playing-widget"]') || nowPlayingBar();
    nodes.widget = bar;
    var link =
      (bar && bar.querySelector('[data-testid="context-item-info-title"] a[href*="/track/"]')) ||
      (bar && bar.querySelector('a[href*="/track/"]'));
    var href = (link && (link.getAttribute('href') || link.pathname)) || '';
    var m = String(href).match(/\/track\/([A-Za-z0-9]{10,40})/);
    if (m) return m[1];
    if (typeof mss !== 'undefined' && mss.lastTrackId && location.pathname.indexOf(mss.lastTrackId) >= 0) {
      return mss.lastTrackId;
    }
    return null;
  }

  function readState() {
    var button = playPauseButton();
    var prog = readProgress();
    return {
      ready: !!button,
      title: barTitle(),
      playing: isPauseLabel(button),
      ad: isAd(),
      positionMs: Math.round(prog.positionMs || 0),
      durationMs: Math.round(prog.durationMs || 0),
      trackId: barTrackId(),
    };
  }

  function notify(kind, payload) {
    var json = typeof payload === 'string' ? payload : JSON.stringify(payload);
    try {
      if (typeof MssSpotify !== 'undefined') {
        if (kind === 'state') MssSpotify.onState(json);
        else if (kind === 'ended' && payload && payload.trackId) MssSpotify.onEnded(payload.trackId);
        else if (kind === 'remote') MssSpotify.onRemote((payload && payload.remoteName) || '');
      }
    } catch (e) {
      /* native bridge missing */
    }
    if (kind !== 'state' || typeof MssSpotify === 'undefined') {
      try {
        console.debug('__mss:' + kind + ':' + json);
      } catch (e2) {
        /* console blocked */
      }
    }
  }

  var LOCAL_RE =
    /this web browser|этот веб-браузер|этот браузер|this computer|этот компьютер|this device|это устройство/i;
  var WEB_PLAYER_RE = /web player|веб-плеер/i;
  var PLAYING_RE =
    /^(?:playing on|listening on|воспроизводится на|воспроизведение на|слушаете на|играет на)\s+/i;
  var CONNECT_ROW_RE =
    /^(?:connect to this device|подключиться к этому устройству|подключить это устройство)[.…]?/i;

  function isLocalName(n) {
    var name = String(n || '');
    if (LOCAL_RE.test(name)) return true;
    if (!WEB_PLAYER_RE.test(name)) return false;
    var lower = name.toLowerCase();
    var ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '').toLowerCase();
    if (ua.indexOf('edg') >= 0) return lower.indexOf('edge') >= 0;
    if (ua.indexOf('firefox') >= 0) return lower.indexOf('firefox') >= 0;
    if (ua.indexOf('chrome') >= 0) return lower.indexOf('chrome') >= 0 && lower.indexOf('edge') < 0;
    return false;
  }

  function remoteFromBar() {
    var bar = nowPlayingBar();
    if (!bar) return null;
    var parts = [];
    var btn = connectBtn();
    if (btn) {
      parts.push(btn.getAttribute('aria-label') || '');
      parts.push(btn.innerText || btn.textContent || '');
    }
    var labeled = bar.querySelectorAll('[aria-label]');
    for (var i = 0; i < labeled.length && i < 48; i++) {
      parts.push(labeled[i].getAttribute('aria-label') || '');
    }
    for (var p = 0; p < parts.length; p++) {
      var t = String(parts[p] || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!PLAYING_RE.test(t)) continue;
      var name = t.replace(PLAYING_RE, '').trim();
      if (name && !isLocalName(name)) return name;
    }
    return null;
  }

  function connectBtn() {
    if (alive(nodes.connect)) return nodes.connect;
    nodes.connect =
      q(
        '[data-testid="connect-device-picker"], [data-testid="device-picker-icon-button"], [data-testid="control-button-connect"]',
      ) ||
      Array.prototype.find.call(
        document.querySelectorAll('[data-testid="now-playing-bar"] button, footer button'),
        function (b) {
          return /connect|device|устройств/i.test(b.getAttribute('aria-label') || '');
        },
      ) ||
      null;
    return nodes.connect;
  }

  function pickerRows() {
    return Array.prototype.slice.call(
      document.querySelectorAll('[data-testid="device-picker-row-sidepanel"], [data-testid="device-picker-item"]'),
    );
  }

  function generationAlive(gen) {
    return gen === undefined || gen === mss.gen;
  }

  function openPicker(gen) {
    return (async function () {
      if (pickerRows().length) return true;
      var b = connectBtn();
      if (!b) return false;
      b.click();
      for (var i = 0; i < 30 && !pickerRows().length; i++) {
        if (!generationAlive(gen)) return false;
        await sleep(100);
      }
      return pickerRows().length > 0;
    })();
  }

  function closePicker(gen) {
    return (async function () {
      if (!pickerRows().length) return;
      var close = q('[data-testid="PanelHeader_CloseButton"] button, [data-testid="PanelHeader_CloseButton"]');
      if (close) close.click();
      else {
        var b = connectBtn();
        if (b) b.click();
      }
      for (var i = 0; i < 20 && pickerRows().length; i++) {
        if (!generationAlive(gen)) return;
        await sleep(100);
      }
    })();
  }

  function pickerRowActive(row) {
    var selected = row.getAttribute('aria-selected');
    var current = row.getAttribute('aria-current');
    if (selected === 'true' || current === 'true') return true;
    if (selected === 'false' || current === 'false') return false;
    if (row.querySelector('[aria-selected="true"], [aria-current="true"]')) return true;
    if (row.querySelector('[aria-selected="false"]')) return false;
    return !row.closest('ul, [role="list"]');
  }

  function readPicker() {
    var out = [];
    var seen = {};
    var rows = pickerRows();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var titled = (row.querySelector('[data-testid="list-row-title"]') || {}).textContent;
      var name = String(titled || row.innerText || '')
        .split('\n')
        .map(function (s) {
          return s.trim();
        })
        .filter(function (s) {
          return s && !CONNECT_ROW_RE.test(s) && s.length <= 60;
        })[0] || '';
      if (!name) continue;
      var inList = !!row.closest('ul, [role="list"]');
      var key = name + (inList ? '|list' : '|current');
      if (seen[key]) continue;
      seen[key] = true;
      out.push({
        name: name,
        active: pickerRowActive(row),
        local: isLocalName(name),
        el: row.querySelector('[role="button"]') || row,
      });
    }
    return out;
  }

  function matchPickerRow(rows, target) {
    var exactInactive = rows.find(function (d) {
      return !d.active && d.name === target;
    });
    if (exactInactive) return exactInactive;
    var exact = rows.find(function (d) {
      return d.name === target;
    });
    if (exact) return exact;
    if (!target) return null;
    var partial = rows.filter(function (d) {
      return !d.active && d.name.indexOf(target) >= 0;
    });
    return partial.length === 1 ? partial[0] : null;
  }

  function transferHere(gen) {
    return (async function () {
      if (!remoteFromBar()) return true;
      if (!(await openPicker(gen))) return false;
      if (!generationAlive(gen)) return false;
      var here = readPicker().find(function (d) {
        return d.local && !d.active;
      });
      if (here) {
        here.el.click();
        closePicker(gen);
        for (var i = 0; i < 8; i++) {
          if (!generationAlive(gen)) return false;
          if (!remoteFromBar()) return true;
          await sleep(100);
        }
        return !remoteFromBar();
      }
      await closePicker(gen);
      return !remoteFromBar();
    })();
  }

  function parseDeviceUrl(url) {
    var m = String(url).match(/(https:\/\/[^/]+)\/connect-state\/v1\/devices\/(hobs_[0-9a-f]{16,})/);
    if (!m) return null;
    return { origin: m[1], id: m[2], url: m[0] };
  }

  function collectDevices(auth) {
    var own = (mss.ownDevice && mss.ownDevice.url) || '';
    var list = (auth && auth.devices) || [];
    var seen = {};
    function consider(url) {
      var d = parseDeviceUrl(url);
      if (!d || seen[d.id]) return null;
      seen[d.id] = true;
      return d;
    }
    var first = consider(own);
    if (first) return first;
    for (var a = 0; a < list.length; a++) {
      var next = consider(list[a]);
      if (next) return next;
    }
    return null;
  }

  function fastPlayLooksStarted(s, beforeTitle, trackId) {
    if (s.ad) return true;
    if (!s.playing) return false;
    if (s.trackId === trackId) return true;
    if (location.pathname.indexOf(trackId) >= 0) return true;
    return !!(s.title && beforeTitle && s.title !== beforeTitle);
  }

  function fastPlay(auth, trackId, positionMs, gen) {
    return (async function () {
      var dev = collectDevices(auth);
      if (!dev) return { ok: false };
      var before = readState();
      var uri = 'spotify:track:' + trackId;
      var res;
      try {
        res = await fetch(dev.origin + '/connect-state/v1/player/command/from/' + dev.id + '/to/' + dev.id, {
          method: 'POST',
          headers: {
            authorization: auth.authorization,
            'client-token': auth.clientToken,
            'spotify-app-version': auth.appVersion,
            'app-platform': 'WebPlayer',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            command: {
              context: { uri: uri, url: 'context://' + uri, metadata: {} },
              play_origin: { feature_identifier: 'harmony', feature_version: auth.appVersion || '' },
              options: { skip_to: { track_uri: uri }, seek_to: positionMs, player_options_override: {} },
              logging_params: { command_id: Math.random().toString(16).slice(2) + Date.now().toString(16) },
              endpoint: 'play',
            },
          }),
        });
      } catch (err) {
        return { ok: false };
      }
      if (res.status === 401 || res.status === 403) return { ok: false, authFailed: true };
      if (!res.ok) return { ok: false };
      for (var t = 0; t < 800; t += 80) {
        if (gen !== mss.gen) return { cancelled: true };
        var s = readState();
        var remote = remoteFromBar();
        if (remote) return { ok: false, remoteName: remote, state: s };
        if (fastPlayLooksStarted(s, before.title, trackId)) {
          return { ok: true, deviceUrl: dev.url, state: s };
        }
        await sleep(80);
      }
      return { ok: false, state: readState() };
    })();
  }

  function waitFor(ms, ok, gen) {
    return (async function () {
      var tick = 80;
      for (var t = 0; t < ms; t += tick) {
        if (gen !== undefined && gen !== mss.gen) return false;
        if (ok()) return true;
        await sleep(tick);
      }
      return !!ok();
    })();
  }

  function clickPlayPause(wantPlaying) {
    var button = playPauseButton();
    if (!button) throw new Error('Веб-плеер Spotify не загрузился');
    if (isPauseLabel(button) !== wantPlaying) button.click();
    return true;
  }

  function seekSliderValue(positionMs, max, durationMs) {
    if (!(max > 0) || !(positionMs >= 0)) return null;
    if (max > 1000) return Math.min(positionMs, max);
    if (!(durationMs > 1000)) return null;
    return (Math.min(positionMs, durationMs) / durationMs) * max;
  }

  function applySeek(positionMs) {
    var progress = progressInput();
    if (!progress) return false;
    var value = seekSliderValue(positionMs, Number(progress.max), readProgress().durationMs || 0);
    if (value == null) return false;
    setRange(progress, value);
    return true;
  }

  function applyVolume(fraction) {
    var volume = alive(nodes.volume)
      ? nodes.volume
      : q('[data-testid="volume-bar"] input[type="range"]') || q('[aria-label*="Volume"] input');
    nodes.volume = volume;
    if (!volume) return false;
    var max = Number(volume.max);
    var v = Math.max(0, Math.min(1, fraction));
    setRange(volume, max > 1 ? v * max : v);
    return true;
  }

  var lastPush = '';
  var lastRemote = undefined;
  var endedFor = null;
  var armed = false;
  var lastEndedTitle = '';
  var lastWasAd = false;
  var lastNearEnd = false;
  var lastOurs = false;

  function leftPrevNearEnd(positionMs, durationMs) {
    return durationMs > 0 && durationMs - positionMs < 5000 && positionMs * 2 > durationMs;
  }

  function considerEnded(s, seeking) {
    var expected = mss.lastTrackId;
    var ours = !!(
      expected &&
      (s.trackId === expected || (!s.trackId && s.title && s.title === lastEndedTitle && lastOurs))
    );
    if (seeking) {
      armed = false;
      lastEndedTitle = s.title;
      lastWasAd = s.ad;
      lastNearEnd = false;
      lastOurs = ours;
      return;
    }
    var left = s.durationMs - s.positionMs;
    if (ours && s.durationMs > 0 && left > mss.endLeadMs && s.playing && !s.ad) armed = true;
    if (armed && !s.ad && expected && endedFor !== expected) {
      var near = s.durationMs > 0 && left <= mss.endLeadMs;
      var emit = false;
      if (ours && s.playing && near) emit = true;
      else if (!ours && lastWasAd && s.title && s.title !== lastEndedTitle) emit = true;
      else if (!ours && lastOurs && lastNearEnd) emit = true;
      if (emit) {
        endedFor = expected;
        notify('ended', { trackId: expected });
      }
    }
    lastEndedTitle = s.title;
    lastWasAd = s.ad;
    lastNearEnd = leftPrevNearEnd(s.positionMs, s.durationMs);
    lastOurs = ours;
  }

  function pushState(s, seeking) {
    var remote = remoteFromBar();
    if (remote !== lastRemote) {
      var hadRemote = lastRemote !== undefined;
      lastRemote = remote;
      if (hadRemote || remote) notify('remote', { remoteName: remote || '' });
    }
    var key =
      s.playing +
      '|' +
      s.ad +
      '|' +
      s.title +
      '|' +
      (s.trackId || '') +
      '|' +
      Math.round((s.positionMs || 0) / 250) +
      '|' +
      s.durationMs +
      '|' +
      (remote || '');
    if (!seeking && key === lastPush) return;
    lastPush = key;
    notify('state', s);
    considerEnded(s, seeking);
  }

  function installObserver() {
    if (window.__mssObserver) return;
    function pick() {
      return nowPlayingBar();
    }
    var bar = null;
    var button = null;
    var titleEl = null;
    var posEl = null;
    var durEl = null;
    var progressEl = null;
    var obs = new MutationObserver(function () {
      pushState(readState());
    });
    function attach() {
      var next = pick();
      var btn = playPauseButton();
      var title =
        (next && next.querySelector('[data-testid="context-item-info-title"]')) ||
        q('[data-testid="context-item-info-title"]');
      if (next !== bar) {
        nodes.progress = null;
        nodes.position = null;
        nodes.duration = null;
        nodes.volume = null;
        nodes.connect = null;
        nodes.widget = null;
      }
      var nextPos = clockEl('playback-position', 'position');
      var nextDur = clockEl('playback-duration', 'duration');
      var nextProgress = progressInput();
      if (
        next === bar &&
        btn === button &&
        title === titleEl &&
        nextPos === posEl &&
        nextDur === durEl &&
        nextProgress === progressEl
      ) {
        return;
      }
      obs.disconnect();
      bar = next;
      button = btn;
      titleEl = title;
      posEl = nextPos;
      durEl = nextDur;
      progressEl = nextProgress;
      nodes.bar = next;
      nodes.button = btn;
      nodes.title = title;
      if (btn) obs.observe(btn, { attributes: true, attributeFilter: ['aria-label'] });
      if (title) obs.observe(title, { childList: true, characterData: true, subtree: true });
      if (posEl) obs.observe(posEl, { childList: true, characterData: true, subtree: true, attributes: true });
      if (durEl) obs.observe(durEl, { childList: true, characterData: true, subtree: true });
      if (progressEl) obs.observe(progressEl, { attributes: true, attributeFilter: ['value', 'aria-valuenow'] });
      pushState(readState());
    }
    window.__mssObserver = obs;
    window.__mssTimers = window.__mssTimers || [];
    attach();
    window.__mssTimers.push(setInterval(attach, 1000));
    window.__mssTimers.push(
      setInterval(function () {
        var s = readState();
        if (s.playing || s.ad) pushState(s);
      }, 250),
    );
  }

  var mss = {
    version: VERSION,
    gen: 0,
    volGen: 0,
    endLeadMs: 900,
    lastTrackId: null,
    ownDevice: null,
    queue: Promise.resolve(),
    cancel: function () {
      this.gen += 1;
      this.volGen += 1;
    },
    setEndLead: function (ms) {
      this.endLeadMs = Number.isFinite(ms) ? Math.max(0, Math.min(5000, Math.round(ms))) : 900;
    },
    enqueue: function (fn) {
      var run = this.queue.then(fn, fn);
      this.queue = run.then(
        function () {},
        function () {},
      );
      return run;
    },
    state: function () {
      return readState();
    },
    pause: function () {
      var gen = ++this.gen;
      var self = this;
      return this.enqueue(function () {
        if (gen !== self.gen) return false;
        return clickPlayPause(false);
      });
    },
    resume: function () {
      var self = this;
      var gen = this.gen;
      return this.enqueue(function () {
        if (gen !== self.gen) return false;
        return clickPlayPause(true);
      });
    },
    stop: function () {
      this.lastTrackId = null;
      armed = false;
      endedFor = null;
      lastNearEnd = false;
      lastOurs = false;
      return this.pause();
    },
    seek: function (positionMs) {
      armed = false;
      var ok = applySeek(positionMs);
      pushState(readState(), true);
      return ok;
    },
    setVolume: function (fraction) {
      this.volGen += 1;
      return applyVolume(fraction);
    },
    fadeVolume: function (from, to, durationMs) {
      var self = this;
      self.volGen += 1;
      var gen = self.volGen;
      var start = Date.now();
      var ms = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
      applyVolume(from);
      if (ms <= 0) {
        applyVolume(to);
        return Promise.resolve();
      }
      return new Promise(function (resolve) {
        function step() {
          if (gen !== self.volGen) {
            resolve();
            return;
          }
          var t = Math.min(1, (Date.now() - start) / ms);
          applyVolume(from + (to - from) * t);
          if (t >= 1) resolve();
          else {
            var id = setTimeout(step, 50);
            window.__mssTimers = window.__mssTimers || [];
            window.__mssTimers.push(id);
          }
        }
        var first = setTimeout(step, 50);
        window.__mssTimers = window.__mssTimers || [];
        window.__mssTimers.push(first);
      });
    },
    devices: function (action, target) {
      var self = this;
      if (action !== 'list' && action !== 'select') {
        return Promise.resolve({ remoteName: remoteFromBar(), devices: [] });
      }
      var gen = self.gen;
      return this.enqueue(async function () {
        if (gen !== self.gen) return { remoteName: remoteFromBar(), devices: [] };
        function plain(list) {
          return list.map(function (d) {
            return { name: d.name, active: d.active, local: d.local };
          });
        }
        if (action === 'select') {
          if (!(await openPicker(gen))) throw new Error('Кнопка устройств Spotify не найдена');
          if (gen !== self.gen) return { remoteName: remoteFromBar(), devices: [] };
          var rows = readPicker();
          var row = matchPickerRow(rows, target);
          if (!row) {
            await closePicker(gen);
            throw new Error('Устройство Spotify не найдено');
          }
          if (!row.active) row.el.click();
          for (var i = 0; i < 16; i++) {
            if (gen !== self.gen) break;
            await sleep(250);
            var r = remoteFromBar();
            if (row.local ? !r : r && (r === row.name || r.indexOf(row.name) >= 0 || row.name.indexOf(r) >= 0)) break;
          }
          await closePicker(gen);
          var remoteName = remoteFromBar();
          return { remoteName: remoteName, selectedLocal: !!(row.local && !remoteName), devices: plain(rows) };
        }
        var remote = remoteFromBar();
        var list = [];
        if (action === 'list') {
          var wasOpen = pickerRows().length > 0;
          if (await openPicker(gen)) {
            list = readPicker();
            if (!wasOpen) await closePicker(gen);
          }
          if (!remote) {
            var current = list.find(function (d) {
              return d.active && !d.local;
            });
            if (
              current &&
              list.some(function (d) {
                return d.local && !d.active;
              })
            ) {
              remote = current.name;
            }
          }
        }
        return { remoteName: remote, devices: plain(list) };
      });
    },
    play: function (trackId, positionMs, auth) {
      var self = this;
      var gen = ++self.gen;
      var target = Math.round(positionMs || 0);
      return self.enqueue(async function () {
        if (gen !== self.gen) return { cancelled: true };
        armed = false;
        endedFor = null;
        lastNearEnd = false;

        function pack(state, extra) {
          extra = extra || {};
          var remote = extra.remoteName !== undefined ? extra.remoteName : remoteFromBar();
          return {
            ready: state.ready,
            title: state.title,
            playing: extra.playing !== undefined ? extra.playing : state.playing,
            ad: state.ad,
            positionMs: state.positionMs,
            durationMs: state.durationMs,
            trackTitle: extra.trackTitle || state.title,
            trackId: extra.trackId !== undefined ? extra.trackId : state.trackId || self.lastTrackId,
            remoteName: remote || null,
            deviceUrl: extra.deviceUrl || (self.ownDevice && self.ownDevice.url) || null,
            cancelled: false,
            authFailed: !!extra.authFailed,
            posted: !!extra.posted,
            error: extra.error || '',
          };
        }

        function sameTrack(state, heading) {
          return !!(
            state.trackId === trackId ||
            (heading && state.title === heading) ||
            location.pathname.indexOf(trackId) >= 0
          );
        }

        async function seekIfNeeded() {
          var s = readState();
          if (target > 0 && !s.ad && s.playing && Math.abs(s.positionMs - target) > 2000) {
            applySeek(target);
            s = readState();
          }
          return s;
        }

        async function waitPlaying(ms) {
          return waitFor(
            ms,
            function () {
              var s = readState();
              return s.playing || s.ad;
            },
            gen,
          );
        }

        if (location.pathname.indexOf(trackId) >= 0) {
          var hereState = readState();
          if (hereState.ad || (hereState.playing && (hereState.trackId === trackId || !hereState.trackId))) {
            self.lastTrackId = trackId;
            return pack(await seekIfNeeded());
          }
          if (playPauseButton()) clickPlayPause(true);
          var startedHere = await waitPlaying(1500);
          if (!startedHere && gen === self.gen && playPauseButton()) {
            clickPlayPause(true);
            startedHere = await waitPlaying(1500);
          }
          if (gen !== self.gen) return { cancelled: true };
          var afterHere = readState();
          if (!afterHere.playing && !afterHere.ad) {
            return pack(afterHere, { error: 'Spotify не запустил трек — проверьте веб-плеер (Spotify → Веб-плеер)' });
          }
          self.lastTrackId = trackId;
          return pack(await seekIfNeeded());
        }

        if (auth && auth.authorization) {
          var fast = await fastPlay(auth, trackId, target, gen);
          if (fast.cancelled || gen !== self.gen) return { cancelled: true };
          if (fast.authFailed) return pack(readState(), { authFailed: true });
          if (fast.remoteName) return pack(fast.state || readState(), { remoteName: fast.remoteName });
          if (fast.ok) {
            if (fast.deviceUrl) self.ownDevice = parseDeviceUrl(fast.deviceUrl);
            self.lastTrackId = trackId;
            var fs = fast.state || readState();
            return pack(fs, {
              deviceUrl: fast.deviceUrl,
              trackTitle: fs.title,
              trackId: trackId,
              playing: true,
            });
          }
        }

        if (!playPauseButton()) {
          await waitFor(
            5000,
            function () {
              return !!playPauseButton();
            },
            gen,
          );
        }
        if (gen !== self.gen) return { cancelled: true };
        if (!playPauseButton()) {
          return pack(readState(), { error: 'Веб-плеер Spotify не загрузился' });
        }

        var path = '/track/' + trackId;
        if (location.pathname !== path) {
          var before = (q('main h1') || {}).textContent || '';
          history.pushState({}, '', path);
          dispatchEvent(new PopStateEvent('popstate', { state: {} }));
          var routed = await waitFor(
            400,
            function () {
              return ((q('main h1') || {}).textContent || '') !== before;
            },
            gen,
          );
          if (gen !== self.gen) return { cancelled: true };
          if (!routed) {
            location.assign('https://open.spotify.com' + path);
            await waitFor(
              8000,
              function () {
                return !!playPauseButton() && location.pathname.indexOf(trackId) >= 0;
              },
              gen,
            );
            if (gen !== self.gen) return { cancelled: true };
          }
        }

        var actionButton = null;
        var heading = '';
        await waitFor(
          5000,
          function () {
            heading = ((q('main h1') || {}).textContent || '').trim();
            actionButton = q('main [data-testid="action-bar-row"] [data-testid="play-button"]');
            return !!(actionButton && heading && location.pathname.indexOf(trackId) >= 0);
          },
          gen,
        );
        if (gen !== self.gen) return { cancelled: true };
        if (!actionButton || location.pathname.indexOf(trackId) < 0) {
          heading = ((q('main h1') || {}).textContent || barTitle() || '').trim();
          actionButton = playPauseButton();
        }
        if (!actionButton) return pack(readState(), { error: 'Не удалось открыть трек в веб-плеере Spotify' });

        var movedHere = await transferHere(gen);
        if (gen !== self.gen) return { cancelled: true };
        if (!movedHere) {
          var busy = remoteFromBar();
          return pack(readState(), {
            remoteName: busy,
            error: 'Spotify играет на устройстве «' + (busy || 'другом') + '» — выберите MSS в списке устройств',
          });
        }

        var bar = readState();
        if ((bar.playing || bar.ad) && sameTrack(bar, heading)) {
          self.lastTrackId = trackId;
          return pack(await seekIfNeeded(), { trackTitle: heading || bar.title });
        }
        if (!isPauseLabel(actionButton)) actionButton.click();
        var started = await waitPlaying(1500);
        if (!started && gen === self.gen) {
          actionButton = playPauseButton() || actionButton;
          if (actionButton && !isPauseLabel(actionButton)) actionButton.click();
          started = await waitPlaying(1500);
        }
        if (started) {
          await waitFor(
            10000,
            function () {
              var s = readState();
              return s.playing && (s.title === heading || !heading || s.ad || s.trackId === trackId);
            },
            gen,
          );
        }
        if (gen !== self.gen) return { cancelled: true };

        var state = readState();
        if (!state.ad && heading && state.title !== heading && !state.playing) {
          return pack(state, { error: 'Spotify не запустил трек — проверьте веб-плеер (Spotify → Веб-плеер)' });
        }
        if (!state.playing && !state.ad) {
          return pack(state, { error: 'Spotify не запустил трек — проверьте веб-плеер (Spotify → Веб-плеер)' });
        }
        state = await seekIfNeeded();
        self.lastTrackId = trackId;
        return pack(state, { trackTitle: heading || state.title });
      });
    },
  };

  window.__mss = mss;
  installObserver();
})();
