import { EMPLOYMENT_TYPES, WORKPLACES } from '../models/Job.js';
import { SLUG_RE, revalidate } from './blog.js';
import { str } from './fields.js';

// How job postings and applications leave the API, and how their fields are
// read from a request. Admin views carry ids and workflow fields; the public
// view carries only what the careers page shows.

const iso = (d) => (d ? new Date(d).toISOString() : '');

const LIST_FIELDS = ['responsibilities', 'requirements', 'niceToHave', 'benefits'];
const MAX_LIST_ITEMS = 30;

/** Every site path a role can appear on. */
export function pathsForJob(slug) {
  return ['/careers', `/careers/${slug}`, '/sitemap.xml', '/llms.txt'];
}

export function revalidateJob(...slugs) {
  revalidate([...new Set(slugs.filter(Boolean).flatMap(pathsForJob))], ['careers']);
}

export function jobSlugProblem(slug) {
  if (!slug) return 'The URL slug is required.';
  if (slug.length > 100) return 'The URL slug must be at most 100 characters.';
  if (!SLUG_RE.test(slug)) {
    return 'The URL slug may only contain lowercase letters, numbers and single hyphens.';
  }
  return null;
}

const invalid = (message) => ({ status: 400, error: 'invalid', message });

/**
 * Copy posting fields from a request body onto a job; any subset may be
 * sent. Returns the problem to answer with, or null. Nothing is saved here.
 * The slug is handled by the route, since it needs the database.
 */
export function applyJobFields(job, body) {
  if (body.title !== undefined) {
    const title = str(body.title, 120);
    if (!title) return invalid('The job title is required.');
    job.title = title;
  }
  if (body.department !== undefined) job.department = str(body.department, 60);
  if (body.location !== undefined) job.location = str(body.location, 80);
  if (body.experience !== undefined) job.experience = str(body.experience, 60);
  if (body.summary !== undefined) job.summary = str(body.summary, 300);
  if (body.description !== undefined) job.description = str(body.description, 5000);

  if (body.workplace !== undefined) {
    if (!WORKPLACES.includes(body.workplace)) return invalid('Choose on-site, hybrid or remote.');
    job.workplace = body.workplace;
  }
  if (body.employmentType !== undefined) {
    if (!EMPLOYMENT_TYPES.includes(body.employmentType)) return invalid('Choose an employment type.');
    job.employmentType = body.employmentType;
  }

  for (const key of LIST_FIELDS) {
    if (body[key] === undefined) continue;
    if (!Array.isArray(body[key])) return invalid('Lists must be sent as a list of lines.');
    job[key] = body[key].map((line) => str(line, 300)).filter(Boolean).slice(0, MAX_LIST_ITEMS);
  }
  return null;
}

/** What stops a role going live, in words an editor can act on. */
export function publishProblems(job) {
  const problems = [];
  if (!job.title?.trim()) problems.push('Add a job title.');
  if (jobSlugProblem(job.slug)) problems.push('Fix the URL slug.');
  if (!job.summary?.trim()) problems.push('Write a short summary.');
  if (!job.description?.trim()) problems.push('Describe the role.');
  if (job.responsibilities.length === 0) problems.push('List at least one responsibility.');
  if (job.requirements.length === 0) problems.push('List at least one requirement.');
  return problems;
}

/** One row of the admin list. `counts` is { total, new } for its applications. */
export function serializeJobSummary(j, counts = { total: 0, new: 0 }) {
  return {
    id: String(j._id),
    title: j.title,
    slug: j.slug,
    department: j.department ?? '',
    location: j.location ?? '',
    workplace: j.workplace,
    employmentType: j.employmentType,
    status: j.status,
    publishedAt: iso(j.publishedAt),
    closedAt: iso(j.closedAt),
    updatedAt: iso(j.updatedAt),
    updatedBy: j.updatedBy ?? '',
    applications: counts,
  };
}

export function serializeAdminJob(j) {
  return {
    ...serializeJobSummary(j),
    experience: j.experience ?? '',
    summary: j.summary ?? '',
    description: j.description ?? '',
    responsibilities: j.responsibilities ?? [],
    requirements: j.requirements ?? [],
    niceToHave: j.niceToHave ?? [],
    benefits: j.benefits ?? [],
    createdAt: iso(j.createdAt),
    createdBy: j.createdBy ?? '',
  };
}

/** For the careers page; `full` adds the body the role's own page needs. */
export function serializePublicJob(j, { full = false } = {}) {
  const base = {
    title: j.title,
    slug: j.slug,
    department: j.department ?? '',
    location: j.location ?? '',
    workplace: j.workplace,
    employmentType: j.employmentType,
    experience: j.experience ?? '',
    summary: j.summary ?? '',
    status: j.status === 'closed' ? 'closed' : 'open',
    publishedAt: iso(j.publishedAt),
    updatedAt: iso(j.updatedAt),
  };
  if (!full) return base;
  return {
    ...base,
    description: j.description ?? '',
    responsibilities: j.responsibilities ?? [],
    requirements: j.requirements ?? [],
    niceToHave: j.niceToHave ?? [],
    benefits: j.benefits ?? [],
  };
}

export function serializeApplicationSummary(a) {
  return {
    id: String(a._id),
    jobId: a.jobId ? String(a.jobId) : '',
    jobTitle: a.jobTitle ?? '',
    areaOfInterest: a.areaOfInterest ?? '',
    firstName: a.firstName,
    lastName: a.lastName,
    email: a.email,
    status: a.status,
    submittedAt: iso(a.createdAt),
  };
}

export function serializeApplication(a) {
  return {
    ...serializeApplicationSummary(a),
    phone: a.phone,
    linkedIn: a.linkedIn ?? '',
    portfolio: a.portfolio ?? '',
    coverLetter: a.coverLetter ?? '',
    resume: { name: a.resumeName, mime: a.resumeMime, size: a.resumeSize },
    notes: a.notes ?? '',
    statusUpdatedBy: a.statusUpdatedBy ?? '',
    statusUpdatedAt: iso(a.statusUpdatedAt),
  };
}

// ---------------------------------------------------------------- applying

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

const MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Read an uploaded résumé: `{ name, data }` with `data` base64. The type is
 * decided by the file's own first bytes, never by the name or what the
 * browser claimed, so only real PDF and Word files are kept.
 * Returns `{ file }` or `{ problem }`.
 */
export function readResume(input) {
  const rawName = str(input?.name, 200);
  const data = typeof input?.data === 'string' ? input.data.replace(/^data:[^,]*,/, '') : '';
  if (!rawName || !data) return { problem: 'Attach your résumé.' };

  const buf = Buffer.from(data, 'base64');
  if (buf.length === 0) return { problem: 'Your résumé file is empty.' };
  if (buf.length > RESUME_MAX_BYTES) return { problem: 'Your résumé must be 5 MB or smaller.' };

  const ext = rawName.toLowerCase().split('.').pop();
  const head = buf.subarray(0, 8);
  let kind = null;
  if (head.subarray(0, 4).toString('latin1') === '%PDF') kind = 'pdf';
  else if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && ext === 'docx') kind = 'docx';
  else if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) && ext === 'doc') kind = 'doc';
  if (!kind) return { problem: 'Your résumé must be a PDF or Word document (.pdf, .doc or .docx).' };

  // Keep a name that's safe in a download header: no paths, quotes or
  // control characters, and the extension that matches its contents.
  const stem = rawName
    .replace(/\.[^.]*$/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .trim()
    .slice(0, 120) || 'resume';
  return { file: { name: `${stem}.${kind}`, mime: MIME[kind], size: buf.length, data: buf } };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An absolute http(s) link, '' when empty, or null when it isn't one. */
function webLink(value) {
  const v = str(value, 300);
  if (!v) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The applicant's own fields, checked. Returns `{ fields }` or `{ problem }`.
 * `coverLetterRequired` is true for a role, false for a general résumé.
 */
export function readApplicant(body, { coverLetterRequired }) {
  const firstName = str(body.firstName, 80);
  const lastName = str(body.lastName, 80);
  const email = str(body.email, 200).toLowerCase();
  const phone = str(body.phone, 40);
  const coverLetter = str(body.coverLetter, 5000);
  const linkedIn = webLink(body.linkedIn);
  const portfolio = webLink(body.portfolio);

  if (!firstName || !lastName) return { problem: 'Enter your first and last name.' };
  if (!EMAIL_RE.test(email)) return { problem: 'Enter a valid email address.' };
  if (phone.replace(/\D/g, '').length < 6) return { problem: 'Enter a phone number we can reach you on.' };
  if (linkedIn === null) return { problem: 'Your LinkedIn link is not a valid web address.' };
  if (portfolio === null) return { problem: 'Your portfolio link is not a valid web address.' };
  if (coverLetterRequired && coverLetter.length < 20) {
    return { problem: 'Tell us in a few sentences why you are interested in this role.' };
  }
  return { fields: { firstName, lastName, email, phone, linkedIn, portfolio, coverLetter } };
}
