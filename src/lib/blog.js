import mongoose from 'mongoose';
import { env } from '../config/env.js';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Paths the site uses under /insights for its own pages.
export const RESERVED_SLUGS = new Set(['preview', 'author', 'category', 'page']);

export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** A problem with a proposed slug, or null when it's usable. */
export function slugProblem(slug) {
  if (!slug) return 'The URL slug is required.';
  if (slug.length > 100) return 'The URL slug must be at most 100 characters.';
  if (!SLUG_RE.test(slug)) {
    return 'The URL slug may only contain lowercase letters, numbers and single hyphens.';
  }
  if (RESERVED_SLUGS.has(slug)) return `“${slug}” is reserved by the site. Pick another.`;
  return null;
}

/** Walk every node of an editor document. */
export function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (Array.isArray(node.content)) for (const child of node.content) walk(child, visit);
}

export function docText(doc) {
  const parts = [];
  walk(doc, (n) => {
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text);
  });
  return parts.join(' ');
}

/** At 230 words a minute, never less than one. */
export function readingMinutes(doc) {
  const words = docText(doc).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

export function inlineCtaIds(doc) {
  const ids = new Set();
  walk(doc, (n) => {
    const id = n.type === 'ctaBlock' ? n.attrs?.ctaId : null;
    if (typeof id === 'string' && mongoose.isValidObjectId(id)) ids.add(id);
  });
  return [...ids];
}

const MAX_DOC_BYTES = 1_500_000;

/**
 * Shape-check an editor document. Only structure is checked here — the site
 * renders documents through a whitelist of node types and safe URLs, so an
 * odd node is simply not shown rather than trusted.
 */
export function docProblem(doc) {
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc' || !Array.isArray(doc.content)) {
    return 'The post body is not a valid document.';
  }
  if (JSON.stringify(doc).length > MAX_DOC_BYTES) {
    return 'The post body is too large. Split it into two posts, or remove pasted images.';
  }
  let depthOk = true;
  const check = (n, d) => {
    if (d > 40) depthOk = false;
    if (depthOk && Array.isArray(n?.content)) for (const c of n.content) check(c, d + 1);
  };
  check(doc, 0);
  return depthOk ? null : 'The post body is nested too deeply.';
}

let warnedNoRevalidate = false;

/**
 * Ask the Next.js site to rebuild these paths now, instead of waiting for its
 * cache to expire. Best effort: a failure only means the change appears a few
 * minutes later, so it never fails the request that caused it.
 */
export async function revalidate(paths) {
  if (!env.siteUrl || !env.revalidateSecret) {
    if (!warnedNoRevalidate) {
      console.warn('[blog] SITE_URL / REVALIDATE_SECRET not set; site pages refresh on their own timer.');
      warnedNoRevalidate = true;
    }
    return;
  }
  try {
    const res = await fetch(`${env.siteUrl}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidate-secret': env.revalidateSecret,
      },
      body: JSON.stringify({ paths: [...new Set(paths)] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.warn(`[blog] revalidate returned ${res.status}`);
  } catch (e) {
    console.warn('[blog] revalidate failed:', e?.message ?? e);
  }
}

/** Every site path a post's content can appear on. */
export function pathsForPost(slug) {
  return ['/', '/insights', '/sitemap.xml', `/insights/${slug}`];
}
