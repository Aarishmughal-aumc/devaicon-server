import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { SESSION_TTL_HOURS } from '../constants.js';

function getSecret() {
  return new TextEncoder().encode(env.sessionSecret);
}

// The token names the user and nothing else about them. Role and permissions
// are read from the database on every request, so a change to either takes
// effect immediately rather than when the token expires.
export async function createSessionToken(user) {
  return new SignJWT({ v: user.sessionVersion ?? 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user._id.toString())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_HOURS}h`)
    .sign(getSecret());
}

/** Returns `{ userId, version }`, or null for a missing, bad or old-format token. */
export async function readSessionFromToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub === 'string' && typeof payload.v === 'number') {
      return { userId: payload.sub, version: payload.v };
    }
    return null;
  } catch {
    return null;
  }
}
