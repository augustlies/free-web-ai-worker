/**
 * Error types for the Agent Web AI skill.
 *
 * Every failure surfaced to the calling agent goes through WebAIError so the
 * caller always receives a stable { status, provider, error, code } shape.
 */

export const ErrorCodes = {
  /** Chrome/CDP endpoint could not be reached or started. */
  BROWSER_UNAVAILABLE: 'browser_unavailable',
  /** The page redirected to a login wall / user is signed out. */
  LOGIN_REQUIRED: 'login_required',
  /** A human-verification challenge is shown; user must solve it manually. */
  CAPTCHA_REQUIRED: 'captcha_required',
  /** The site is rate-limiting / blocking this network. Never bypassed. */
  ACCESS_BLOCKED: 'access_blocked',
  /** The provider page structure could not be recognised (selector drift). */
  SELECTORS_STALE: 'selectors_stale',
  /** The prompt could not be typed/submitted. */
  SUBMIT_FAILED: 'submit_failed',
  /** No answer arrived before the deadline. */
  TIMEOUT: 'timeout',
  /** Answer element appeared but text extraction produced nothing. */
  EXTRACTION_FAILED: 'extraction_failed',
  /** Unknown provider id requested. */
  UNKNOWN_PROVIDER: 'unknown_provider',
  /** Bad caller input (empty prompt, bad options). */
  INVALID_INPUT: 'invalid_input',
  /** Provider explicitly disabled by config. */
  PROVIDER_DISABLED: 'provider_disabled',
  /** Our own anti-abuse guard refused the call (interval / quota / breaker). */
  RATE_LIMITED_LOCALLY: 'rate_limited_locally',
  /** Anything else. */
  INTERNAL: 'internal_error',
};

export class WebAIError extends Error {
  /**
   * @param {string} message  Human readable, safe to show to the main agent.
   * @param {string} code     One of ErrorCodes.
   * @param {object} [details] Extra machine readable context.
   */
  constructor(message, code = ErrorCodes.INTERNAL, details = {}) {
    super(message);
    this.name = 'WebAIError';
    this.code = code;
    this.details = details;
  }

  /** Shape used in the structured JSON result returned to the caller. */
  toResult(provider = null, extra = {}) {
    return {
      status: 'error',
      provider,
      error: this.message,
      code: this.code,
      ...(Object.keys(this.details).length ? { details: this.details } : {}),
      ...extra,
    };
  }
}

/** Wrap an unknown thrown value into a WebAIError. */
export function toWebAIError(err, fallbackCode = ErrorCodes.INTERNAL) {
  if (err instanceof WebAIError) return err;
  const message = err && err.message ? err.message : String(err);
  const code = err && err.name === 'TimeoutError' ? ErrorCodes.TIMEOUT : fallbackCode;
  return new WebAIError(message, code, { cause: err && err.name ? err.name : undefined });
}



