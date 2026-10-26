import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from '../constants.js';
import { isProd } from '../config/env.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/',
};

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res) {
  res.cookie(SESSION_COOKIE_NAME, '', { ...COOKIE_OPTIONS, maxAge: 0 });
}
