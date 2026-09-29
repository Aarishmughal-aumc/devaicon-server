/** Trimmed string, cut to `max`; anything else becomes ''. */
export function str(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * A link that's safe to put in an href or src: a site-relative path, or
 * http(s). Returns '' for empty, null for anything else (javascript:, data:,
 * protocol-relative //, malformed) so the caller can reject it.
 */
export function safeUrl(value, max = 500) {
  const v = str(value, max);
  if (!v) return '';
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? v : null;
  } catch {
    return null;
  }
}
