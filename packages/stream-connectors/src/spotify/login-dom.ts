import { LOGIN_CODE_COPY_SOURCE, SPOTIFY_ORIGIN } from './login.js';

export const USERNAME_SELECTORS = [
  'input[data-testid="login-username"]',
  'input#login-username',
  'input#username',
  'input[name="username"]',
  'input[autocomplete="username"]',
  'input[type="email"]',
  'input[name="email"]',
  'input[autocomplete="email"]',
];

export const PASSWORD_SELECTORS = [
  'input[data-testid="login-password"]',
  'input#login-password',
  'input[name="password"]',
  'input[type="password"]',
];

const SUBMIT_SELECTORS = [
  'button[data-testid="login-button"]',
  'button#login-button',
  'button[type="submit"]',
];

export const OTC_INPUT_SELECTORS = [
  'input[autocomplete="one-time-code"]',
  '[data-testid="login-otc"]',
  'input[name="code"]',
  'input[name="otc"]',
  'input[inputmode="numeric"]',
];

/** React-controlled inputs ignore `el.value = …`; use the native setter + value tracker. */
const INPUT_HELPERS = `
function isVisibleEl(el) {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function setNativeValue(el, value) {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const last = el.value;
  el.focus();
  try {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  } catch (_) {}
  try { el.setSelectionRange(0, last.length); } catch (_) {}
  const tracker = el._valueTracker;
  if (nativeSetter) nativeSetter.call(el, value);
  else el.value = value;
  if (tracker && typeof tracker.setValue === 'function') tracker.setValue(last);
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertFromPaste',
    data: value,
  }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
  return el.value === value;
}
function firstVisibleInput(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el instanceof HTMLInputElement && isVisibleEl(el)) return el;
  }
  return null;
}
function otpInputs() {
  const inputs = Array.from(document.querySelectorAll('input')).filter(
    (el) => el instanceof HTMLInputElement && el.type !== 'hidden' && el.type !== 'password' && el.type !== 'email',
  );
  const max1 = inputs.filter((el) => el.maxLength === 1);
  if (max1.length >= 4) return max1;
  const small = inputs.filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width >= 16 && rect.width <= 80 && rect.height >= 16;
  });
  if (small.length >= 4) return small;
  const capture = inputs.filter((el) => {
    const max = el.maxLength;
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
    const mode = (el.getAttribute('inputmode') || el.inputMode || '').toLowerCase();
    const name = (el.name || '').toLowerCase();
    const testid = (el.getAttribute('data-testid') || '').toLowerCase();
    return (
      auto.includes('one-time-code') ||
      max === 6 ||
      max === 8 ||
      mode === 'numeric' ||
      el.type === 'tel' ||
      name === 'code' ||
      name === 'otc' ||
      testid.includes('otp') ||
      testid.includes('otc')
    );
  });
  if (capture.length) return capture;
  const body = document.body?.innerText ?? '';
  if (/enter the code we sent|code we sent|код.{0,40}письм/i.test(body) && inputs.length >= 1 && inputs.length <= 8) {
    return inputs;
  }
  return capture;
}
function otpSlot() {
  const boxes = otpInputs();
  if (boxes[0]) return boxes[0];
  const labeled = document.querySelector(
    '[aria-label*="digit" i], [aria-label*="code" i], [data-testid*="otp" i], [data-testid*="otc" i]',
  );
  return labeled instanceof HTMLElement ? labeled : null;
}
function insertText(el, value) {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  el.focus();
  try { el.select(); } catch (_) {}
  try {
    const inserted = document.execCommand('insertText', false, value);
    if (inserted && (el.value.includes(value[0]) || el.value === value)) return true;
  } catch (_) {}
  const key = value.length === 1 ? value : 'Unidentified';
  const keyOpts = { key, bubbles: true, cancelable: true, composed: true, view: window };
  el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
  const ok = setNativeValue(el, value);
  el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
  return ok;
}
function typeOtpDigits(digits) {
  const boxes = otpInputs();
  if (boxes.length >= digits.length) {
    for (let i = 0; i < digits.length; i++) insertText(boxes[i], digits[i]);
    return readOtpValue();
  }
  if (boxes[0]) {
    insertText(boxes[0], digits);
    return readOtpValue();
  }
  const slot = otpSlot();
  if (slot) {
    slot.click();
    slot.focus();
  }
  for (const digit of digits) {
    const el = document.activeElement;
    const keyOpts = {
      key: digit,
      code: 'Digit' + digit,
      keyCode: 48 + Number(digit),
      which: 48 + Number(digit),
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };
    const target = el instanceof HTMLElement ? el : document;
    target.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) insertText(el, digit);
    else {
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: digit,
      }));
    }
    target.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
  }
  return readOtpValue();
}
function readOtpValue() {
  const boxes = otpInputs();
  if (boxes.length >= 4) return boxes.map((el) => el.value ?? '').join('');
  if (boxes[0]) return boxes[0].value ?? '';
  const el = document.activeElement;
  return el instanceof HTMLInputElement ? (el.value ?? '') : '';
}
`;

function visibleScript(selector: string): string {
  return `(function(sel){
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })(${JSON.stringify(selector)})`;
}

export const DETECT_AUTH_STEP = `(() => {
  const visible = (selector) => {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  if (visible('input#login-password') || visible('[data-testid="login-password"]') || visible('input[type="password"]')) {
    return 'password';
  }
  const otpBits = document.querySelectorAll(
    'input[maxlength="1"], input[inputmode="numeric"], input[type="tel"], input[autocomplete="one-time-code"]',
  ).length;
  const body = (document.body?.innerText ?? '').toLowerCase();
  const codeCopy = new RegExp(${JSON.stringify(LOGIN_CODE_COPY_SOURCE)}, 'i').test(body);
  if (
    visible('input[autocomplete="one-time-code"]') ||
    visible('input[name="code"]') ||
    visible('input[name="otc"]') ||
    visible('[data-testid="login-otc"]') ||
    otpBits >= 4 ||
    codeCopy
  ) {
    return 'code';
  }
  return 'email';
})()`;

export const DISMISS_BANNERS = `(() => {
  const selectors = ['#onetrust-accept-btn-handler', '#accept-cookies', 'button[id*="accept"]'];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) { el.click(); break; }
  }
})()`;

export const HAS_CAPTCHA = `(() => {
  const href = location.href.toLowerCase();
  if (!/\\/login\\/otp|\\/login\\/code|magic-link/.test(href)) {
    if (
      /challenge|captcha|arkose|funcaptcha|turnstile|recaptcha|hcaptcha|not[_-]?robot|datadome|perimeterx/.test(href) ||
      /(?:^|\\.)challenge\\.spotify\\.com$/.test(location.hostname.toLowerCase())
    ) return true;
  }
  const body = (document.body?.innerText ?? '').replace(/\\s+/g, ' ');
  if (
    /i['’]m not a robot|i am not a robot|я не робот|verify you are (a )?human|complete a security check|подтвердите,? что вы не робот|funcaptcha|hcaptcha/i.test(body) &&
    !new RegExp(${JSON.stringify(LOGIN_CODE_COPY_SOURCE)}, 'i').test(body)
  ) return true;
  const widgets = document.querySelectorAll(
    '[data-testid="captcha"], .g-recaptcha, .h-captcha, #px-captcha, iframe[src*="arkose"], iframe[src*="funcaptcha"], iframe[src*="turnstile"]',
  );
  for (const node of widgets) {
    if (!(node instanceof HTMLElement)) continue;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = node.getBoundingClientRect();
    if (rect.width >= 100 && rect.height >= 60) return true;
  }
  const read = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return { src: '', title: '', name: '', width: 0, height: 0 };
    }
    const rect = el.getBoundingClientRect();
    return {
      src: el.getAttribute('src') ?? '',
      title: el.getAttribute('title') ?? '',
      name: el.getAttribute('name') ?? '',
      width: rect.width,
      height: rect.height,
    };
  };
  const frames = Array.from(document.querySelectorAll('iframe')).map(read);
  const marked = document.querySelector("[data-testid='captcha']");
  if (marked) frames.push(read(marked));
  const looks = (frame) => {
    const src = (frame.src ?? '').toLowerCase();
    const title = (frame.title ?? '').toLowerCase();
    const name = (frame.name ?? '').toLowerCase();
    const blob = src + ' ' + title + ' ' + name;
    const vendor = /recaptcha|hcaptcha|arkose|funcaptcha|turnstile|challenges\\.cloudflare|\\/captcha/.test(blob) || name.includes('bframe');
    if (!vendor) return false;
    if (/badge=/.test(src) && frame.height < 80) return false;
    if (src.includes('/anchor')) return frame.height >= 70 && frame.width >= 270;
    const challenge = src.includes('bframe') || title.includes('challenge') || name.includes('bframe');
    if (challenge) return frame.width >= 100 && frame.height >= 100;
    return frame.width >= 160 && frame.height >= 70;
  };
  return frames.some(looks);
})()`;

export const READ_LOGIN_ERROR = `(() => {
  const items = Array.from(document.querySelectorAll('[data-testid="login-error"], [role="alert"]')).map((el) => ({
    testid: el.getAttribute('data-testid'),
    text: (el.textContent ?? '').replace(/\\s+/g, ' ').trim(),
  }));
  const failed = (text) => {
    const t = text.replace(/\\s+/g, ' ').trim();
    if (t.length < 3) return false;
    const informational = /we sent|code we sent|check your (email|inbox)|resent|resend code|отправ|please enter your email|enter your email address/i.test(t);
    const bad = /invalid|incorrect|wrong|expired|failed|unable|could(?:n't| not)|неверн|ошиб|не удалось|неправильн/i.test(t);
    if (informational && !bad) return false;
    return bad;
  };
  for (const item of items) {
    if (!item.text) continue;
    if (item.testid === 'login-error') return item.text;
    if (failed(item.text)) return item.text;
  }
  return null;
})()`;

export function fillEmailScript(email: string): string {
  return `(() => {
    ${INPUT_HELPERS}
    const email = ${JSON.stringify(email)};
    const el = firstVisibleInput(${JSON.stringify(USERNAME_SELECTORS)});
    if (!el) return false;
    insertText(el, email);
    return el.value === email;
  })()`;
}

export function fillPasswordScript(password: string): string {
  return `(() => {
    ${INPUT_HELPERS}
    const password = ${JSON.stringify(password)};
    const el = firstVisibleInput(${JSON.stringify(PASSWORD_SELECTORS)});
    return el ? setNativeValue(el, password) : false;
  })()`;
}

export function fillEmailCodeScript(code: string): string {
  const digits = code.replace(/\s+/g, '');
  return `(() => {
    ${INPUT_HELPERS}
    const digits = ${JSON.stringify(digits)};
    return typeOtpDigits(digits);
  })()`;
}

export function readOtpValueScript(): string {
  return `(() => {
    ${INPUT_HELPERS}
    return readOtpValue();
  })()`;
}

export function focusOtpScript(): string {
  return `(() => {
    ${INPUT_HELPERS}
    const boxes = otpInputs();
    const el = boxes[0] ?? otpSlot();
    if (!el) return false;
    el.focus();
    el.click();
    try { if (el instanceof HTMLInputElement) el.select(); } catch (_) {}
    return true;
  })()`;
}

export function readVisibleInputScript(selectors: string[]): string {
  return `(() => {
    ${INPUT_HELPERS}
    const el = firstVisibleInput(${JSON.stringify(selectors)});
    return el instanceof HTMLInputElement ? (el.value ?? '') : '';
  })()`;
}

export function focusVisibleInputScript(selectors: string[]): string {
  return `(() => {
    ${INPUT_HELPERS}
    const el = firstVisibleInput(${JSON.stringify(selectors)});
    if (!el) return false;
    el.focus();
    el.click();
    try { el.select(); } catch (_) {}
    return true;
  })()`;
}

export const SUBMIT_LOGIN_FORM = `(() => {
  const clickable = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el instanceof HTMLButtonElement && el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.hasAttribute('disabled')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const click = (el) => {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  };
  const re = /^(continue|next|log in|sign in|verify|confirm|submit|продолжить|далее|войти|подтвердить)$/i;
  const labeled = Array.from(document.querySelectorAll('button, [role="button"]')).find((node) => {
    if (!clickable(node)) return false;
    const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    return re.test(text);
  });
  if (labeled instanceof HTMLElement) {
    click(labeled);
    return true;
  }
  const submit = ${JSON.stringify(SUBMIT_SELECTORS)};
  for (const sel of submit) {
    const el = document.querySelector(sel);
    if (!clickable(el)) continue;
    click(el);
    return true;
  }
  const email = document.querySelector('input[type="email"], input#username, input[name="username"]');
  const form = (email instanceof HTMLInputElement && email.form) || document.querySelector('form');
  if (form instanceof HTMLFormElement && typeof form.requestSubmit === 'function') {
    form.requestSubmit();
    return true;
  }
  const fields = ${JSON.stringify([...USERNAME_SELECTORS, ...PASSWORD_SELECTORS, ...OTC_INPUT_SELECTORS, 'input[maxlength="1"]'])};
  for (const sel of fields) {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, keyCode: 13, which: 13 }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true, keyCode: 13, which: 13 }));
    return true;
  }
  return false;
})()`;

export const CONTINUE_ENABLED = `(() => {
  const re = /^(continue|next|log in|sign in|продолжить|далее|войти)$/i;
  for (const node of document.querySelectorAll('button, [role="button"]')) {
    const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!re.test(text)) continue;
    const disabled =
      (node instanceof HTMLButtonElement && node.disabled) ||
      node.getAttribute('aria-disabled') === 'true' ||
      node.hasAttribute('disabled');
    if (!disabled) return true;
  }
  const loginBtn = document.querySelector('button[data-testid="login-button"], button#login-button');
  return loginBtn instanceof HTMLButtonElement && !loginBtn.disabled;
})()`;

export function waitForContinueEnabledScript(timeoutMs: number): string {
  return `new Promise((resolve) => {
    const deadline = Date.now() + ${timeoutMs};
    const re = /^(continue|next|log in|sign in|продолжить|далее|войти)$/i;
    const tick = () => {
      for (const node of document.querySelectorAll('button, [role="button"]')) {
        const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!re.test(text)) continue;
        const disabled =
          (node instanceof HTMLButtonElement && node.disabled) ||
          node.getAttribute('aria-disabled') === 'true' ||
          node.hasAttribute('disabled');
        if (!disabled) { resolve(true); return; }
      }
      const loginBtn = document.querySelector('button[data-testid="login-button"], button#login-button');
      if (loginBtn instanceof HTMLButtonElement && !loginBtn.disabled) { resolve(true); return; }
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(tick, 100);
    };
    tick();
  })`;
}

export const SWITCH_TO_EMAIL_CODE = `(() => {
  const re = /login code|without a password|magic link|email a code|login with a code|sign in with a code|код|без пароля|одноразов/i;
  for (const node of document.querySelectorAll("button, a, [role='button']")) {
    if (!(node instanceof HTMLElement)) continue;
    const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!re.test(text)) continue;
    node.click();
    return true;
  }
  return false;
})()`;

export const SWITCH_TO_PASSWORD = `(() => {
  const re = /log in with a password|use (a |your )?password|войти с паролем|паролем/i;
  for (const node of document.querySelectorAll("button, a, [role='button']")) {
    if (!(node instanceof HTMLElement)) continue;
    const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!re.test(text)) continue;
    node.click();
    return true;
  }
  return false;
})()`;

export function waitForLoginStepScript(timeoutMs: number): string {
  return `new Promise((resolve) => {
    const origin = ${JSON.stringify(SPOTIFY_ORIGIN)};
    const deadline = Date.now() + ${timeoutMs};
    const tick = () => {
      const path = location.pathname.toLowerCase();
      if (location.origin === origin && !path.includes('/login')) { resolve(true); return; }
      if (path.includes('/login/otp') || path.includes('/login/password') || path.includes('/challenge') || path.includes('/login/code')) { resolve(true); return; }
      const selector = ${JSON.stringify([...PASSWORD_SELECTORS, ...OTC_INPUT_SELECTORS, 'input[maxlength="1"]', 'input[type="tel"]'].join(', '))};
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) { resolve(true); return; }
      }
      const body = (document.body?.innerText ?? '');
      if (new RegExp(${JSON.stringify(LOGIN_CODE_COPY_SOURCE)}, 'i').test(body)) { resolve(true); return; }
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(tick, 150);
    };
    tick();
  })`;
}

export function waitForOpenSpotifyScript(timeoutMs: number): string {
  return `new Promise((resolve) => {
    const origin = ${JSON.stringify(SPOTIFY_ORIGIN)};
    const deadline = Date.now() + ${timeoutMs};
    const tick = () => {
      if (location.origin === origin && !location.pathname.includes('/login')) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(tick, 200);
    };
    tick();
  })`;
}

export function hasUsernameFieldScript(): string {
  return USERNAME_SELECTORS.map((s) => visibleScript(s)).join(' || ');
}

export function waitForUsernameFieldScript(timeoutMs: number): string {
  return `new Promise((resolve) => {
    ${INPUT_HELPERS}
    const selectors = ${JSON.stringify(USERNAME_SELECTORS)};
    const deadline = Date.now() + ${timeoutMs};
    const tick = () => {
      if (firstVisibleInput(selectors)) { resolve(true); return; }
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(tick, 150);
    };
    tick();
  })`;
}
