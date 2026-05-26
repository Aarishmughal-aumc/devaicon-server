import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { SESSION_TTL_HOURS } from '../constants.js';

function getSecret() {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function createSessionToken(user) {
  return new SignJWT({ username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_HOURS}h`)
    .sign(getSecret());
}

export async function readSessionFromToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (
      typeof payload.username === 'string' &&
      (payload.role === 'dev' || payload.role === 'admin')
    ) {
      return { username: payload.username, role: payload.role };
    }
    return null;
  } catch {
    return null;
  }
}
