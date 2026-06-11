import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../constants.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Parse `page` / `pageSize` query params.
 * Defaults to page 1, pageSize 12 (capped at PAGE_SIZE_MAX).
 */
export function parsePagination(query = {}) {
  const page = clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(query.pageSize, PAGE_SIZE_DEFAULT, 1, PAGE_SIZE_MAX);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/**
 * Build the Mongo filter for the optional list filters:
 *   dateFrom, dateTo      — inclusive YYYY-MM-DD range
 *   hoursMin, hoursMax    — inclusive numeric range
 *   status                — approved | pending | flagged | unflagged
 *   project, category     — exact match
 * Unknown / malformed values are ignored.
 */
export function buildLogFilter(query = {}) {
  const filter = {};

  const dateFrom = String(query.dateFrom ?? '').trim();
  const dateTo = String(query.dateTo ?? '').trim();
  if (DATE_RE.test(dateFrom) || DATE_RE.test(dateTo)) {
    filter.date = {};
    if (DATE_RE.test(dateFrom)) filter.date.$gte = dateFrom;
    if (DATE_RE.test(dateTo)) filter.date.$lte = dateTo;
  }

  const hoursMin = Number(query.hoursMin);
  const hoursMax = Number(query.hoursMax);
  const hasMin = query.hoursMin != null && query.hoursMin !== '' && Number.isFinite(hoursMin);
  const hasMax = query.hoursMax != null && query.hoursMax !== '' && Number.isFinite(hoursMax);
  if (hasMin || hasMax) {
    filter.hours = {};
    if (hasMin) filter.hours.$gte = hoursMin;
    if (hasMax) filter.hours.$lte = hoursMax;
  }

  const status = String(query.status ?? '').trim().toLowerCase();
  if (status === 'approved') filter.approvedAt = { $ne: null };
  else if (status === 'pending') filter.approvedAt = null;
  else if (status === 'flagged') filter.flagged = true;
  else if (status === 'unflagged') filter.flagged = false;

  const project = String(query.project ?? '').trim();
  if (project) filter.project = project;

  const category = String(query.category ?? '').trim();
  if (category) filter.category = category;

  return filter;
}
