import { env } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function sameOriginGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return next();

  const host = req.headers['host'];
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];

  const allowedHosts = new Set(
    env.clientOrigins.map((o) => {
      try {
        return new URL(o).host;
      } catch {
        return o;
      }
    }),
  );
  if (host) allowedHosts.add(host);

  const check = (raw) => {
    try {
      return allowedHosts.has(new URL(raw).host);
    } catch {
      return false;
    }
  };

  if (origin && check(origin)) return next();
  if (!origin && referer && check(referer)) return next();

  return res.status(403).json({ error: 'forbidden_origin' });
}
