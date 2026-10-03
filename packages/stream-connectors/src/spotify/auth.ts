import type { AuthResult, AuthStep } from "./types.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export interface LoginRequest {
  email: string;
  password?: string;
  code?: string;
}

const PREMIUM_PRODUCTS = new Set([
  "premium",
  "premium_mini",
  "premium-mini",
  "premium-individual",
  "premium_individual",
  "individual",
  "mini",
  "duo",
  "family",
  "student",
  "unlimited",
]);
const FREE_PRODUCTS = new Set(["free", "open", "basic"]);

export function emptyAuthResult(step: AuthStep = "email"): AuthResult {
  return {
    ok: true,
    loggedIn: false,
    hasPremium: false,
    email: null,
    step,
    codeRequired: step === "code",
    accessToken: null,
    expiresAt: null,
    tokenType: null,
    clientToken: null,
    captcha: false,
  };
}

export function cookieNamesIndicateLogin(names: Iterable<string>): boolean {
  for (const name of names) {
    if (name === "sp_dc") return true;
  }
  return false;
}

export function parsePremium(value: unknown, depth = 0, seen?: Set<object>): boolean | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 0) return false;
    if (value === 1) return true;
    return null;
  }
  if (typeof value === "string") {
    const v = value.toLowerCase().trim();
    if (PREMIUM_PRODUCTS.has(v) || v.includes("premium") || v === "individual") return true;
    if (FREE_PRODUCTS.has(v)) return false;
    if (v === "true" || v === "yes") return true;
    if (v === "false" || v === "no") return false;
    return null;
  }
  if (typeof value !== "object" || depth > 5) return null;
  if (value instanceof Map) {
    return parsePremium(Object.fromEntries(value as Map<unknown, unknown>), depth + 1, seen);
  }
  const rec = value as Record<string, unknown>;
  const visited = seen ?? new Set<object>();
  if (visited.has(rec)) return null;
  visited.add(rec);

  if ("value" in rec && rec.value != null) {
    const keys = Object.keys(rec);
    if (
      keys.length <= 4 &&
      (typeof rec.value === "string" || typeof rec.value === "boolean" || typeof rec.value === "number")
    ) {
      const wrapped = parsePremium(rec.value, depth + 1, visited);
      if (wrapped != null) return wrapped;
    }
  }

  const named =
    parsePremium(rec.isPremium, depth + 1, visited) ??
    parsePremium(rec.hasPremium, depth + 1, visited) ??
    parsePremium(rec.premium, depth + 1, visited) ??
    parsePremium(rec.product, depth + 1, visited) ??
    parsePremium(rec.productType, depth + 1, visited) ??
    parsePremium(rec.plan, depth + 1, visited) ??
    parsePremium(rec.catalogue, depth + 1, visited) ??
    parsePremium(rec.accountType, depth + 1, visited);

  if (named != null) return named;

  const type = parsePremium(rec.type, depth + 1, visited);
  if (type != null) return type;

  const ads = rec.ads;
  if (ads === "0" || ads === 0) return true;
  if (ads === "1" || ads === 1) return false;

  return parsePremium(rec.productState, depth + 1, visited) ?? parsePremium(rec.state, depth + 1, visited);
}

export function pickEmail(value: unknown, depth = 0, seen?: Set<object>): string | null {
  if (value == null || depth > 5) return null;
  if (typeof value === "string") {
    const v = value.trim();
    if (EMAIL_RE.test(v)) return v;
    const match = v.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    return match ? match[0] : null;
  }
  if (typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const visited = seen ?? new Set<object>();
  if (visited.has(rec)) return null;
  visited.add(rec);
  return (
    pickEmail(rec.email, depth + 1, visited) ??
    pickEmail(rec.userEmail, depth + 1, visited) ??
    pickEmail(rec.username, depth + 1, visited) ??
    pickEmail(rec.userName, depth + 1, visited) ??
    pickEmail(rec.login, depth + 1, visited) ??
    pickEmail(rec.user, depth + 1, visited) ??
    pickEmail(rec.profile, depth + 1, visited) ??
    pickEmail(rec.account, depth + 1, visited) ??
    pickEmail(rec.me, depth + 1, visited)
  );
}

export function parseLoginBody(body: unknown): LoginRequest | { error: string } {
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof rec.email !== "string" || !EMAIL_RE.test(rec.email.trim())) {
    return { error: "invalid_email" };
  }
  const email = rec.email.trim();
  let password: string | undefined;
  if (rec.password !== undefined) {
    if (typeof rec.password !== "string" || rec.password.length === 0) return { error: "invalid_password" };
    password = rec.password;
  }
  let code: string | undefined;
  if (rec.code !== undefined) {
    if (typeof rec.code !== "string") return { error: "invalid_code" };
    const digits = rec.code.replace(/\s+/g, "");
    if (digits.length === 0) {
      code = undefined;
    } else if (!/^[A-Za-z0-9]{4,8}$/.test(digits)) {
      return { error: "invalid_code" };
    } else {
      code = digits;
    }
  }
  return { email, password, code };
}

export function parseAuthToken(raw: unknown): { accessToken: string; expiresAt: number | null; tokenType: "Bearer" } | null {
  if (typeof raw === "string") {
    const token = raw.trim();
    if (token.length < 20) return null;
    return { accessToken: token, expiresAt: null, tokenType: "Bearer" };
  }
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const nested =
    rec.body && typeof rec.body === "object"
      ? (rec.body as Record<string, unknown>)
      : rec.data && typeof rec.data === "object"
        ? (rec.data as Record<string, unknown>)
        : rec;
  const access =
    str(nested.accessToken) ??
    str(nested.access_token) ??
    str(nested.token) ??
    str(rec.accessToken) ??
    str(rec.access_token);
  if (!access || access.length < 20) return null;
  const expiresIn = num(nested.expiresIn) ?? num(nested.expires_in) ?? num(rec.expiresIn);
  const expiresAt =
    num(nested.accessTokenExpirationTimestampMs) ??
    num(nested.expiresAt) ??
    num(nested.expires_at) ??
    num(rec.accessTokenExpirationTimestampMs) ??
    (expiresIn != null ? Date.now() + expiresIn * 1000 : null);
  return { accessToken: access, expiresAt, tokenType: "Bearer" };
}

export function looksLikeJwt(token: string): boolean {
  return JWT_RE.test(token);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
