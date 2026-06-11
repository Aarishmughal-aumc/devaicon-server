const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

const store = new Map();

export function checkRateLimit(key) {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.firstAttempt + WINDOW_MS - now) / 1000),
    );
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true, remaining: MAX_ATTEMPTS - entry.count };
}

export function recordFailure(key) {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    store.set(key, { count: 1, firstAttempt: now });
  } else {
    entry.count += 1;
  }
}

export function clearAttempts(key) {
  store.delete(key);
}

export function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.length) return real;
  return req.ip || "unknown";
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (now - v.firstAttempt > WINDOW_MS) store.delete(k);
  }
}, WINDOW_MS).unref?.();
