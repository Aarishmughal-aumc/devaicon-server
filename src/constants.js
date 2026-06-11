export const CATEGORIES = [
  'Coding',
  'Meeting',
  'Planning',
  'Training',
  'Code Review',
  'Bug Fix',
  'Docs',
  'Research',
  'Other',
];

export const SESSION_COOKIE_NAME = 'devaicon_session';
export const SESSION_TTL_HOURS = 12;
export const SESSION_TTL_SECONDS = SESSION_TTL_HOURS * 60 * 60;

export const HOURS_MAX = 3;
export const DESCRIPTION_MIN_LENGTH = 10;
export const DESCRIPTION_MAX_LENGTH = 1000;
export const FLAG_REASON_MAX_LENGTH = 500;

// Listing / pagination
export const PAGE_SIZE_DEFAULT = 12;
export const PAGE_SIZE_MAX = 100;
export const LOG_STATUSES = ['approved', 'pending', 'flagged', 'unflagged'];
export const BULK_IDS_MAX = 500;
