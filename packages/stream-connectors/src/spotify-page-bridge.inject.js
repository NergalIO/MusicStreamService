(function () {
  var VERSION = 1;
  if (window.__mss && window.__mss.version === VERSION) return;

  function q(sel, root) {
    return (root || document).querySelector(sel);
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isPauseLabel(el) {
    return /pause|пауз/i.test((el && el.getAttribute('aria-label')) || '');
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
    desc.set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function barTitle() {
    var bar = q('[data-testid="now-playing-bar"]') || q('footer');
    var el =
      (bar && bar.querySelector('[data-testid="context-item-info-title"]')) ||
      q('[data-testid="context-item-info-title"]');
    return ((el && el.textContent) || '').trim();
  }

  function progressInput() {
    return q('[data-testid="playback-progressbar"] input[type="range"]');
  }

  function readProgress() {
    var progress = progressInput();
    var clockPos = parseClock((q('[data-testid="playback-position"]') || {}).textContent);
    var clockDur = parseClock((q('[data-testid="playback-duration"]') || {}).textContent);
    if (!progress) return { positionMs: clockPos, durationMs: clockDur };
    var max = Number(progress.max);
    var val = Number(progress.value);
    if (max > 1000) return { positionMs: val, durationMs: max };
    if (max > 0 && clockDur > 0) return { positionMs: (val / max) * clockDur, durationMs: clockDur };
    return { positionMs: clockPos, durationMs: clockDur || max };
  }

  function readState() {
    var button = q('[data-testid="control-button-playpause"]');
    var prog = readProgress();
    return {
      ready: !!button,
      title: barTitle(),
      playing: isPauseLabel(button),
      ad: isAd(),
      positionMs: Math.round(prog.positionMs || 0),
      durationMs: Math.round(prog.durationMs || 0),
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
    try {
      console.debug('__mss:' + kind + ':' + json);
    } catch (e2) {
      /* console blocked */
    }
  }

  var LOCAL_RE =
    /this web browser|этот веб-браузер|этот браузер|this computer|этот компьютер|this device|это устройство/i;
  var PLAYING_RE =
    /^(?:playing on|listening on|воспроизводится на|воспроизведение на|слушаете на|играет на)\s+/i;
  var CONNECT_ROW_RE =
    /^(?:connect to this device|подключиться к этому устройству|подключить это устройство)[.…]?/i;

  function isLocalName(n) {
    return LOCAL_RE.test(String(n || ''));
  }

  function remoteFromBar() {
    var bar = q('[data-testid="now-playing-bar"]') || q('footer');
    if (!bar) return null;
    var els = bar.querySelectorAll('button, a, span, div');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.childElementCount > 4) continue;
      var t = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!PLAYING_RE.test(t)) continue;
      var name = t.replace(PLAYING_RE, '').trim();
      if (name && !isLocalName(name)) return name;
    }
    return null;
  }

  function connectBtn() {
    return (
      q(
        '[data-testid="connect-device-picker"], [data-testid="device-picker-icon-button"], [data-testid="control-button-connect"]',
      ) ||
      Array.prototype.find.call(
        document.querySelectorAll('[data-testid="now-playing-bar"] button, footer button'),
        function (b) {
          return /connect|device|устройств/i.test(b.getAttribute('aria-label') || '');
        },
      ) ||
      null
    );
  }

  function pickerRows() {
    return Array.prototype.slice.call(
      document.querySelectorAll('[data-testid="device-picker-row-sidepanel"], [data-testid="device-picker-item"]'),
    );
  }

  function openPicker() {
    return (async function () {
      if (pickerRows().length) return true;
      var b = connectBtn();
      if (!b) return false;
      b.click();
      for (var i = 0; i < 30 && !pickerRows().length; i++) await sleep(100);
      return pickerRows().length > 0;
    })();
  }

  function closePicker() {
    return (async function () {
      if (!pickerRows().length) return;
      var close = q('[data-testid="PanelHeader_CloseButton"] button, [data-testid="PanelHeader_CloseButton"]');
      if (close) close.click();
      else {
        var b = connectBtn();
        if (b) b.click();
      }
      for (var i = 0; i < 20 && pickerRows().length; i++) await sleep(100);
    })();
  }

  function readPicker() {
    var out = [];
    var seen = {};
    var rows = pickerRows();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var titled = (row.querySelector('[data-testid="list-row-title"]') || {}).textContent;
      var lines = String(titled || row.innerText || '')
        .split('\n')
        .map(function (s) {
          return s.trim();
        })
        .filter(function (s) {
          return s && !CONNECT_ROW_RE.test(s);
        });
      var name = lines[lines.length - 1] || '';
      if (!name || name.length > 60) continue;
      var inList = !!row.closest('ul, [role="list"]');
      var key = name + (inList ? '|list' : '|current');
      if (seen[key]) continue;
      seen[key] = true;
      out.push({
        name: name,
        active: !inList,
        local: isLocalName(name),
        el: row.querySelector('[role="button"]') || row,
      });
    }
    return out;
  }

  function transferHere() {
    return (async function () {
      if (!remoteFromBar()) return true;
      if (!(await openPicker())) return false;
      var here = readPicker().find(function (d) {
        return d.local && !d.active;
      });
      if (here) {
        here.el.click();
        for (var i = 0; i < 24 && remoteFromBar(); i++) await sleep(250);
      }
      await closePicker();
      return !remoteFromBar();
    })();
  }

  function parseDeviceUrl(url) {
    var m = String(url).match(/(https:\/\/[^/]+)\/connect-state\/v1\/devices\/(hobs_[0-9a-f]{16,})/);
    if (!m) return null;
    return { origin: m[1], id: m[2], url: m[0] };
  }

  function collectDevices(auth) {
    var devices = [];
    function add(url) {
      var d = parseDeviceUrl(url);
      if (!d) return;
      for (var i = 0; i < devices.length; i++) {
        if (devices[i].id === d.id) {
          devices.splice(i, 1);
          break;
        }
      }
      devices.push(d);
    }
    if (mss.ownDevice && mss.ownDevice.url) add(mss.ownDevice.url);
    var list = (auth && auth.devices) || [];
    for (var a = 0; a < list.length; a++) add(list[a]);
    if (!mss.ownDevice) {
      try {
        var entries = performance.getEntriesByType('resource');
        for (var e = 0; e < entries.length; e++) add(entries[e].name);
      } catch (err) {
        /* no performance timeline */
      }
    }
    if (mss.ownDevice) {
      for (var x = 0; x < devices.length; x++) {
        if (devices[x].id === mss.ownDevice.id) return devices[x];
      }
    }
    return devices.length ? devices[devices.length - 1] : null;
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
        var restarted =
          s.positionMs < positionMs + 3000 && (!before.playing || before.positionMs > positionMs + 3000);
        if (s.ad || (s.playing && (s.title !== before.title || restarted || location.pathname.indexOf(trackId) >= 0))) {
          return { ok: true, deviceUrl: dev.url, state: s };
        }
        await sleep(80);
      }
      return { ok: false };
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
    var button = q('[data-testid="control-button-playpause"]');
    if (!button) throw new Error('Веб-плеер Spotify не загрузился');
    if (isPauseLabel(button) !== wantPlaying) button.click();
    return true;
  }

  function applySeek(positionMs) {
    var progress = progressInput();
    if (!progress) return false;
    var max = Number(progress.max);
    var duration = readProgress().durationMs || positionMs;
    var value = max > 1000 ? Math.min(positionMs, max) : max > 0 ? (Math.min(positionMs, duration) / (duration || 1)) * max : positionMs;
    setRange(progress, value);
    return true;
  }

  function applyVolume(fraction) {
    var volume = q('[data-testid="volume-bar"] input[type="range"]') || q('[aria-label*="Volume"] input');
    if (!volume) return false;
    var max = Number(volume.max);
    var v = Math.max(0, Math.min(1, fraction));
    setRange(volume, max > 1 ? v * max : v);
    return true;
  }

  var lastPush = '';
  var endedFor = null;
  var armed = false;

  function pushState(s) {
    var key = s.playing + '|' + s.ad + '|' + s.title + '|' + Math.round((s.positionMs || 0) / 250) + '|' + s.durationMs;
    if (key === lastPush) return;
    lastPush = key;
    notify('state', s);
    if (s.durationMs > 0 && s.durationMs - s.positionMs > mss.endLeadMs) {
      if (s.playing && !s.ad) armed = true;
    }
    if (
      armed &&
      !s.ad &&
      s.playing &&
      s.durationMs > 0 &&
      s.durationMs - s.positionMs <= mss.endLeadMs &&
      mss.lastTrackId
    ) {
      if (endedFor !== mss.lastTrackId) {
        endedFor = mss.lastTrackId;
        notify('ended', { trackId: mss.lastTrackId });
      }
    }
  }

  function installObserver() {
    if (window.__mssObserver) return;
    function pick() {
      return q('[data-testid="now-playing-bar"]') || q('footer');
    }
    var bar = null;
    var button = null;
    var titleEl = null;
    var obs = new MutationObserver(function () {
      pushState(readState());
    });
    function attach() {
      var next = pick();
      var btn = q('[data-testid="control-button-playpause"]');
      var title =
        (next && next.querySelector('[data-testid="context-item-info-title"]')) ||
        q('[data-testid="context-item-info-title"]');
      if (next === bar && btn === button && title === titleEl) return;
      obs.disconnect();
      bar = next;
      button = btn;
      titleEl = title;
      if (btn) obs.observe(btn, { attributes: true, attributeFilter: ['aria-label'] });
      if (title) obs.observe(title, { childList: true, characterData: true, subtree: true });
      if (next) obs.observe(next, { childList: true });
      pushState(readState());
    }
    window.__mssObserver = obs;
    attach();
    setInterval(attach, 1000);
    setInterval(function () {
      pushState(readState());
    }, 250);
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
      var gen = ++this.gen;
      var self = this;
      return this.enqueue(function () {
        if (gen !== self.gen) return false;
        return clickPlayPause(true);
      });
    },
    stop: function () {
      this.lastTrackId = null;
      armed = false;
      endedFor = null;
      return this.pause();
    },
    seek: function (positionMs) {
      var ok = applySeek(positionMs);
      pushState(readState());
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
      var start = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      var ms = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
      applyVolume(from);
      if (ms <= 0) {
        applyVolume(to);
        return Promise.resolve();
      }
      return new Promise(function (resolve) {
        function step(now) {
          if (gen !== self.volGen) {
            resolve();
            return;
          }
          var t = Math.min(1, (now - start) / ms);
          applyVolume(from + (to - from) * t);
          if (t >= 1) resolve();
          else requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    },
    devices: function (action, target) {
      var self = this;
      return this.enqueue(async function () {
        function plain(list) {
          return list.map(function (d) {
            return { name: d.name, active: d.active, local: d.local };
          });
        }
        if (action === 'select') {
          if (!(await openPicker())) throw new Error('Кнопка устройств Spotify не найдена');
          var rows = readPicker();
          var row =
            rows.find(function (d) {
              return !d.active && d.name === target;
            }) ||
            rows.find(function (d) {
              return !d.active && target && d.name.indexOf(target) >= 0;
            }) ||
            rows.find(function (d) {
              return d.name === target;
            });
          if (!row) {
            await closePicker();
            throw new Error('Устройство Spotify не найдено');
          }
          if (!row.active) row.el.click();
          for (var i = 0; i < 16; i++) {
            await sleep(250);
            var r = remoteFromBar();
            if (row.local ? !r : r) break;
          }
          await closePicker();
          var remoteName = remoteFromBar();
          return { remoteName: remoteName, selectedLocal: !!(row.local && !remoteName), devices: plain(rows) };
        }
        var remote = remoteFromBar();
        var list = [];
        if (action === 'list') {
          var wasOpen = pickerRows().length > 0;
          if (await openPicker()) {
            list = readPicker();
            if (!wasOpen) await closePicker();
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

        function pack(state, extra) {
          extra = extra || {};
          var remote = extra.remoteName !== undefined ? extra.remoteName : remoteFromBar();
          return {
            ready: state.ready,
            title: state.title,
            playing: state.playing,
            ad: state.ad,
            positionMs: state.positionMs,
            durationMs: state.durationMs,
            trackTitle: extra.trackTitle || state.title,
            remoteName: remote || null,
            deviceUrl: extra.deviceUrl || (self.ownDevice && self.ownDevice.url) || null,
            cancelled: false,
            authFailed: !!extra.authFailed,
            error: extra.error || '',
          };
        }

        await waitFor(
          20000,
          function () {
            return !!q('[data-testid="control-button-playpause"]');
          },
          gen,
        );
        if (gen !== self.gen) return { cancelled: true };
        if (!q('[data-testid="control-button-playpause"]')) {
          return pack(readState(), { error: 'Веб-плеер Spotify не загрузился' });
        }

        var path = '/track/' + trackId;
        var alreadyHere = location.pathname.indexOf(trackId) >= 0 || self.lastTrackId === trackId;
        if (alreadyHere) {
          var hereState = readState();
          if (!hereState.playing) clickPlayPause(true);
          if (target > 0 && Math.abs(hereState.positionMs - target) > 2000) applySeek(target);
          await waitFor(
            8000,
            function () {
              var s = readState();
              return s.playing || s.ad;
            },
            gen,
          );
          if (gen !== self.gen) return { cancelled: true };
          self.lastTrackId = trackId;
          return pack(readState());
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
            return pack(fs, { deviceUrl: fast.deviceUrl, trackTitle: fs.title });
          }
        }

        if (location.pathname !== path) {
          var before = (q('main h1') || {}).textContent || '';
          history.pushState({}, '', path);
          dispatchEvent(new PopStateEvent('popstate', { state: {} }));
          await waitFor(
            5000,
            function () {
              return ((q('main h1') || {}).textContent || '') !== before;
            },
            gen,
          );
          if (gen !== self.gen) return { cancelled: true };
          if (((q('main h1') || {}).textContent || '') === before) {
            location.assign('https://open.spotify.com' + path);
            await waitFor(
              20000,
              function () {
                return !!q('[data-testid="control-button-playpause"]');
              },
              gen,
            );
            if (gen !== self.gen) return { cancelled: true };
          }
        }

        var actionButton = null;
        var heading = '';
        await waitFor(
          20000,
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
          actionButton = q('[data-testid="control-button-playpause"]');
        }
        if (!actionButton) return pack(readState(), { error: 'Не удалось открыть трек в веб-плеере Spotify' });

        var movedHere = await transferHere();
        if (gen !== self.gen) return { cancelled: true };
        if (!movedHere) {
          var busy = remoteFromBar();
          return pack(readState(), {
            remoteName: busy,
            error: 'Spotify играет на устройстве «' + (busy || 'другом') + '» — выберите MSS в списке устройств',
          });
        }

        if (!isPauseLabel(actionButton)) actionButton.click();
        await waitFor(
          10000,
          function () {
            var s = readState();
            return s.playing && (s.title === heading || !heading || s.ad);
          },
          gen,
        );
        if (gen !== self.gen) return { cancelled: true };

        var state = readState();
        if (!state.ad && heading && state.title !== heading && !state.playing) {
          return pack(state, { error: 'Spotify не запустил трек — проверьте веб-плеер (Spotify → Веб-плеер)' });
        }
        if (target > 0 && !state.ad && Math.abs(state.positionMs - target) > 2000) {
          applySeek(target);
          state.positionMs = target;
        }
        self.lastTrackId = trackId;
        return pack(state, { trackTitle: heading || state.title });
      });
    },
  };

  window.__mss = mss;
  installObserver();
})();
