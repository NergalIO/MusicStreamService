import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  emptyAuthResult,
  looksLikeJwt,
  parseAuthToken,
  parseLoginBody,
  parsePremium,
  cookieNamesIndicateLogin,
  pickEmail,
} from '../src/spotify/auth.js';
import {
  iframeLooksLikeCaptchaChallenge,
  authStepFromUrl,
  looksLikeLoginError,
  pageTextLooksLikeCaptcha,
  shouldResumeLogin,
  urlLooksLikeCaptcha,
} from '../src/spotify/login.js';

describe("parseLoginBody", () => {
  it("accepts email only to start a code or password step", () => {
    assert.deepEqual(parseLoginBody({ email: "  user@example.com " }), {
      email: "user@example.com",
      password: undefined,
      code: undefined,
    });
  });

  it("accepts password and email code", () => {
    assert.deepEqual(parseLoginBody({ email: "user@example.com", password: "secret", code: "12 3456" }), {
      email: "user@example.com",
      password: "secret",
      code: "123456",
    });
  });

  it("rejects bad email, password and code", () => {
    assert.deepEqual(parseLoginBody({}), { error: "invalid_email" });
    assert.deepEqual(parseLoginBody({ email: "not-an-email" }), { error: "invalid_email" });
    assert.deepEqual(parseLoginBody({ email: "user@example.com", password: "" }), { error: "invalid_password" });
    assert.deepEqual(parseLoginBody({ email: "user@example.com", code: "12" }), { error: "invalid_code" });
    assert.deepEqual(parseLoginBody({ email: "user@example.com", code: "" }), {
      email: "user@example.com",
      password: undefined,
      code: undefined,
    });
  });
});

describe("parseAuthToken", () => {
  it("reads accessToken and expiry", () => {
    assert.deepEqual(
      parseAuthToken({
        accessToken: "aaaaaaaaaaaaaaaaaaaa",
        accessTokenExpirationTimestampMs: 1_700_000_000_000,
      }),
      {
        accessToken: "aaaaaaaaaaaaaaaaaaaa",
        expiresAt: 1_700_000_000_000,
        tokenType: "Bearer",
      },
    );
  });

  it("reads nested OAuth payloads", () => {
    const parsed = parseAuthToken({
      body: { access_token: "bbbbbbbbbbbbbbbbbbbb", expires_in: 10 },
    });
    assert.ok(parsed);
    assert.equal(parsed.accessToken, "bbbbbbbbbbbbbbbbbbbb");
    assert.equal(parsed.tokenType, "Bearer");
    assert.ok(parsed.expiresAt != null && parsed.expiresAt > Date.now());
  });

  it("rejects short values", () => {
    assert.equal(parseAuthToken("short"), null);
    assert.equal(parseAuthToken({ token: "nope" }), null);
  });
});

describe("looksLikeJwt / emptyAuthResult", () => {
  it("detects JWTs", () => {
    assert.equal(looksLikeJwt("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc"), true);
    assert.equal(looksLikeJwt("not-a-jwt"), false);
  });

  it("builds an empty auth payload", () => {
    assert.deepEqual(emptyAuthResult("code"), {
      ok: true,
      loggedIn: false,
      hasPremium: false,
      email: null,
      step: "code",
      codeRequired: true,
      accessToken: null,
      expiresAt: null,
      tokenType: null,
      clientToken: null,
      captcha: false,
    });
  });
});

describe("cookieNamesIndicateLogin", () => {
  it("treats only sp_dc as a session cookie", () => {
    assert.equal(cookieNamesIndicateLogin(["sp_t", "sp_key", "OptanonConsent"]), false);
    assert.equal(cookieNamesIndicateLogin(["sp_t", "sp_dc"]), true);
  });
});

describe("parsePremium", () => {
  it("reads product, ads and nested productState", () => {
    assert.equal(parsePremium({ product: "premium" }), true);
    assert.equal(parsePremium({ product: "premium-individual" }), true);
    assert.equal(parsePremium({ product: { value: "premium" } }), true);
    assert.equal(parsePremium({ plan: "individual" }), true);
    assert.equal(parsePremium(new Map([["catalogue", "premium"]])), true);
    assert.equal(parsePremium({ product: "duo" }), true);
    assert.equal(parsePremium({ product: "free" }), false);
    assert.equal(parsePremium({ product: "open" }), false);
    assert.equal(parsePremium({ ads: "0" }), true);
    assert.equal(parsePremium({ ads: "1" }), false);
    assert.equal(parsePremium({ productState: { catalogue: "premium", ads: "0" } }), true);
    assert.equal(parsePremium({ isPremium: true }), true);
    assert.equal(parsePremium({ isPremium: false }), false);
    assert.equal(parsePremium("track"), null);
  });
});

describe("pickEmail", () => {
  it("reads nested account email", () => {
    assert.equal(pickEmail("user@example.com"), "user@example.com");
    assert.equal(pickEmail({ user: { email: "acc@spotify.test" } }), "acc@spotify.test");
    assert.equal(pickEmail("Welcome back acc@spotify.test"), "acc@spotify.test");
    assert.equal(pickEmail({ username: "not-an-email" }), null);
  });
});

describe("iframeLooksLikeCaptchaChallenge", () => {
  it("ignores the invisible reCAPTCHA badge on the login page", () => {
    assert.equal(
      iframeLooksLikeCaptchaChallenge({
        src: "https://www.google.com/recaptcha/api2/anchor?k=abc",
        title: "reCAPTCHA",
        width: 256,
        height: 60,
      }),
      false,
    );
    assert.equal(
      iframeLooksLikeCaptchaChallenge({
        src: "https://www.google.com/recaptcha/enterprise/anchor",
        title: "reCAPTCHA",
        width: 0,
        height: 0,
      }),
      false,
    );
  });

  it("detects a visible challenge popup", () => {
    assert.equal(
      iframeLooksLikeCaptchaChallenge({
        src: "https://www.google.com/recaptcha/api2/bframe?k=abc",
        title: "recaptcha challenge expires in two minutes",
        name: "c-abc",
        width: 400,
        height: 580,
      }),
      true,
    );
  });

  it("detects the visible I'm-not-a-robot checkbox", () => {
    assert.equal(
      iframeLooksLikeCaptchaChallenge({
        src: "https://www.google.com/recaptcha/enterprise/anchor",
        title: "reCAPTCHA",
        width: 304,
        height: 78,
      }),
      true,
    );
  });
});

describe("urlLooksLikeCaptcha", () => {
  it("detects Spotify challenge pages and captcha vendors", () => {
    assert.equal(urlLooksLikeCaptcha("https://accounts.spotify.com/challenge"), true);
    assert.equal(urlLooksLikeCaptcha("https://challenge.spotify.com/"), true);
    assert.equal(urlLooksLikeCaptcha("https://client-api.arkoselabs.com/v2/foo"), true);
    assert.equal(
      urlLooksLikeCaptcha("https://accounts.spotify.com/en/login/otp?continue=https://open.spotify.com/"),
      false,
    );
    assert.equal(pageTextLooksLikeCaptcha("I'm not a robot"), true);
    assert.equal(pageTextLooksLikeCaptcha("We sent a code to your email"), false);
  });
});

describe("authStepFromUrl", () => {
  it("maps Spotify OTP and password login paths", () => {
    assert.equal(
      authStepFromUrl("https://accounts.spotify.com/en/login/otp?continue=https%3A%2F%2Fopen.spotify.com%2F"),
      "code",
    );
    assert.equal(authStepFromUrl("https://accounts.spotify.com/en/login/password"), "password");
    assert.equal(authStepFromUrl("https://accounts.spotify.com/en/login"), null);
    assert.equal(authStepFromUrl("https://accounts.spotify.com/challenge"), null);
  });
});

describe("shouldResumeLogin", () => {
  it("resumes OTP and password pages and restarts from email", () => {
    assert.equal(
      shouldResumeLogin(
        "https://accounts.spotify.com/en/login/otp?continue=https%3A%2F%2Fopen.spotify.com%2F",
        "code",
      ),
      true,
    );
    assert.equal(shouldResumeLogin("https://accounts.spotify.com/en/login/password", "password"), true);
    assert.equal(shouldResumeLogin("https://accounts.spotify.com/en/login", "email"), false);
    assert.equal(shouldResumeLogin("https://open.spotify.com/", "email"), false);
  });
});

describe("looksLikeLoginError", () => {
  it("ignores the OTP sent notice and keeps real errors", () => {
    assert.equal(looksLikeLoginError("Enter the code we sent to a******3@g*l.com"), false);
    assert.equal(looksLikeLoginError("Invalid code"), true);
  });
});
