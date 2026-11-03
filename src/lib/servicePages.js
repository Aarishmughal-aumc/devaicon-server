import { SLUG_RE, revalidate } from './blog.js';
import { safeUrl, str } from './fields.js';

// Service pages built from content blocks: the block catalogue, how a page's
// fields are read from a request, and how pages leave the API.
//
// The catalogue mirrors client/src/lib/service-pages/blocks.ts, which adds
// the labels, hints and AI guidance. Keep the two in step: a block type or
// limit added on one side only is refused or cut by the other.

const iso = (d) => (d ? new Date(d).toISOString() : '');
const invalid = (message) => ({ status: 400, error: 'invalid', message });

export const ICONS = [
  'sparkles', 'bot', 'brain', 'cpu', 'cloud', 'server', 'database', 'shield-check',
  'lock', 'code', 'layers', 'workflow', 'settings', 'wrench', 'rocket', 'trending-up',
  'chart-column', 'chart-line', 'users', 'user-check', 'briefcase', 'building', 'globe',
  'map-pin', 'graduation-cap', 'book-open', 'message-square', 'headphones', 'smartphone',
  'monitor', 'zap', 'target', 'lightbulb', 'clipboard-check', 'file-text', 'search',
  'handshake', 'gauge', 'network', 'puzzle', 'clock', 'badge-check', 'coins',
  'shopping-cart', 'heart-pulse', 'factory', 'landmark',
];

/** Breadcrumb parents a page may sit under; '' puts it straight under Home. */
export const PARENTS = [
  '',
  '/whatwedo',
  '/capabilities/intelligent-systems-data',
  '/capabilities/application-software-development',
  '/capabilities/infrastructure-enterprise-systems',
  '/capabilities/consulting-transformation',
  '/capabilities/open-edx-services',
  '/industries',
  '/engagement-models',
];

export const MAX_BLOCKS = 40;
// Paths under /services the site uses for its own pages.
const RESERVED_SLUGS = new Set(['preview']);

const text = (max, extra = {}) => ({ kind: 'text', max, ...extra });
const area = (max, extra = {}) => ({ kind: 'textarea', max, ...extra });
const md = (max, extra = {}) => ({ kind: 'markdown', max, ...extra });

const HEADING = text(120);

export const BLOCKS = {
  richText: { label: 'Text section', fields: { heading: HEADING, body: md(8000, { required: true }) } },
  featureGrid: {
    label: 'Feature grid',
    fields: {
      heading: HEADING,
      intro: md(1000),
      columns: { kind: 'select', options: ['2', '3'] },
      items: {
        kind: 'items',
        required: true,
        minItems: 2,
        maxItems: 12,
        fields: { icon: { kind: 'icon' }, title: text(100, { required: true }), text: area(400) },
      },
    },
  },
  steps: {
    label: 'Process steps',
    fields: {
      heading: HEADING,
      intro: md(1000),
      items: {
        kind: 'items',
        required: true,
        minItems: 2,
        maxItems: 10,
        fields: { title: text(100, { required: true }), text: area(600) },
      },
    },
  },
  stats: {
    label: 'Key figures',
    fields: {
      heading: HEADING,
      items: {
        kind: 'items',
        required: true,
        minItems: 2,
        maxItems: 4,
        fields: { value: text(20, { required: true }), label: text(100, { required: true }) },
      },
      note: text(200),
    },
  },
  checklist: {
    label: 'Checklist',
    fields: {
      heading: HEADING,
      intro: md(1000),
      items: { kind: 'strings', max: 300, required: true, minItems: 1, maxItems: 20 },
    },
  },
  comparisonTable: {
    label: 'Comparison table',
    fields: {
      heading: HEADING,
      intro: md(1000),
      columns: { kind: 'strings', max: 80, required: true, minItems: 2, maxItems: 5 },
      rows: { kind: 'rows', max: 300, required: true, minItems: 1, maxItems: 20 },
      caption: text(200),
    },
  },
  callout: { label: 'Callout', fields: { heading: HEADING, body: md(2000, { required: true }) } },
  imageText: {
    label: 'Image and text',
    fields: {
      heading: HEADING,
      body: md(3000, { required: true }),
      image: { kind: 'image', required: true },
      imageAlt: text(200, { required: true }),
      imagePosition: { kind: 'select', options: ['right', 'left'] },
    },
  },
  image: {
    label: 'Image',
    fields: {
      src: { kind: 'image', required: true },
      alt: text(200, { required: true }),
      caption: text(200),
    },
  },
  quote: {
    label: 'Quote',
    fields: { quote: area(600, { required: true }), name: text(80), role: text(120) },
  },
  techStack: {
    label: 'Technologies',
    fields: {
      heading: HEADING,
      intro: md(1000),
      items: { kind: 'strings', max: 40, required: true, minItems: 1, maxItems: 30 },
    },
  },
  cta: {
    label: 'Call to action',
    fields: {
      heading: text(120, { required: true }),
      body: area(400),
      buttonLabel: text(40, { required: true }),
      buttonUrl: { kind: 'url', required: true },
      style: { kind: 'select', options: ['panel', 'banner', 'inline'] },
    },
  },
  faq: {
    label: 'FAQs',
    once: true,
    fields: {
      items: {
        kind: 'items',
        required: true,
        minItems: 1,
        maxItems: 20,
        fields: { question: text(200, { required: true }), answer: area(1500, { required: true }) },
      },
    },
  },
  related: {
    label: 'Related pages',
    fields: {
      heading: HEADING,
      items: {
        kind: 'items',
        required: true,
        minItems: 1,
        maxItems: 6,
        fields: {
          title: text(100, { required: true }),
          description: area(200),
          path: { kind: 'url', required: true },
          image: { kind: 'image' },
        },
      },
    },
  },
};

const MAX_CELLS = 5;

/**
 * One field's value, read and capped. Returns `{ value }`, or `{ problem }`
 * for a link that isn't safe to put on the page.
 */
function readField(spec, raw, where) {
  switch (spec.kind) {
    case 'text':
    case 'textarea':
    case 'markdown':
      return { value: str(raw, spec.max) };
    case 'url':
    case 'image': {
      const url = safeUrl(raw);
      if (url === null) return { problem: `${where}: links must start with / or https://.` };
      return { value: url };
    }
    case 'icon':
      return { value: ICONS.includes(raw) ? raw : ICONS[0] };
    case 'select':
      return { value: spec.options.includes(String(raw)) ? String(raw) : spec.options[0] };
    case 'strings':
      return {
        value: (Array.isArray(raw) ? raw : [])
          .map((s) => str(s, spec.max))
          .filter(Boolean)
          .slice(0, spec.maxItems),
      };
    case 'rows':
      return {
        value: (Array.isArray(raw) ? raw : [])
          .filter(Array.isArray)
          .map((row) => row.slice(0, MAX_CELLS).map((c) => str(c, spec.max)))
          .filter((row) => row.some(Boolean))
          .slice(0, spec.maxItems),
      };
    case 'items': {
      const items = [];
      for (const item of (Array.isArray(raw) ? raw : []).slice(0, spec.maxItems)) {
        if (!item || typeof item !== 'object') continue;
        const out = {};
        for (const [key, sub] of Object.entries(spec.fields)) {
          const r = readField(sub, item[key], where);
          if (r.problem) return r;
          out[key] = r.value;
        }
        if (Object.entries(out).some(([k, v]) => spec.fields[k].kind !== 'icon' && v)) items.push(out);
      }
      return { value: items };
    }
    default:
      return { value: '' };
  }
}

/** A block from a request: known fields only, each capped. */
function readBlock(raw, n) {
  const def = BLOCKS[raw?.type];
  if (!def) return { problem: `Block ${n} is of a kind this site doesn't have (${String(raw?.type)}).` };
  const block = { type: raw.type };
  for (const [key, spec] of Object.entries(def.fields)) {
    const r = readField(spec, raw[key], `Block ${n} (${def.label})`);
    if (r.problem) return r;
    block[key] = r.value;
  }
  return { block };
}

export function readBlocks(raw) {
  if (!Array.isArray(raw)) return { problem: 'Blocks must be sent as a list.' };
  if (raw.length > MAX_BLOCKS) return { problem: `A page can hold at most ${MAX_BLOCKS} blocks.` };
  const blocks = [];
  for (const [i, b] of raw.entries()) {
    const r = readBlock(b, i + 1);
    if (r.problem) return r;
    blocks.push(r.block);
  }
  for (const [type, def] of Object.entries(BLOCKS)) {
    if (def.once && blocks.filter((b) => b.type === type).length > 1) {
      return { problem: `A page can have only one ${def.label} block.` };
    }
  }
  return { blocks };
}

export function servicePath(slug) {
  return `/services/${slug}`;
}

export function revalidateServicePage(...slugs) {
  const paths = slugs.filter(Boolean).map(servicePath);
  revalidate([...new Set([...paths, '/sitemap.xml', '/llms.txt'])], ['services']);
}

export function serviceSlugProblem(slug) {
  if (!slug) return 'The URL slug is required.';
  if (slug.length > 100) return 'The URL slug must be at most 100 characters.';
  if (!SLUG_RE.test(slug)) {
    return 'The URL slug may only contain lowercase letters, numbers and single hyphens.';
  }
  if (RESERVED_SLUGS.has(slug)) return `“${slug}” is used by the site itself. Choose another URL.`;
  return null;
}

const URL_FIELDS = { heroImage: 'The hero image', heroButtonLink: 'The hero button link' };
const SEO_TEXT = { metaTitle: 120, metaDescription: 320, focusKeyphrase: 100, ogTitle: 120, ogDescription: 320 };

/**
 * Copy page fields from a request body onto a page; any subset may be sent.
 * Returns the problem to answer with, or null. Nothing is saved here. The
 * slug is handled by the route, since it needs the database.
 */
export function applyServicePageFields(page, body) {
  if (body.title !== undefined) {
    const title = str(body.title, 120);
    if (!title) return invalid('The page title is required.');
    page.title = title;
  }
  if (body.label !== undefined) page.label = str(body.label, 60);
  if (body.subtitle !== undefined) page.subtitle = str(body.subtitle, 400);
  if (body.heroButtonText !== undefined) page.heroButtonText = str(body.heroButtonText, 40);
  if (body.serviceType !== undefined) page.serviceType = str(body.serviceType, 120);
  if (body.areaServed !== undefined) page.areaServed = str(body.areaServed, 80);
  if (body.icon !== undefined) page.icon = ICONS.includes(body.icon) ? body.icon : ICONS[0];
  if (body.parent !== undefined) {
    if (!PARENTS.includes(body.parent)) return invalid('Choose where the page sits in the breadcrumb trail.');
    page.parent = body.parent;
  }
  for (const [key, name] of Object.entries(URL_FIELDS)) {
    if (body[key] === undefined) continue;
    const url = safeUrl(body[key]);
    if (url === null) return invalid(`${name} must start with / or https://.`);
    page[key] = url;
  }

  if (body.seo !== undefined) {
    const seo = body.seo ?? {};
    const next = { ...(page.seo?.toObject?.() ?? page.seo ?? {}) };
    for (const [key, max] of Object.entries(SEO_TEXT)) {
      if (seo[key] !== undefined) next[key] = str(seo[key], max);
    }
    if (seo.keywords !== undefined) {
      if (!Array.isArray(seo.keywords)) return invalid('Keywords must be sent as a list.');
      next.keywords = [...new Set(seo.keywords.map((k) => str(k, 60).toLowerCase()).filter(Boolean))].slice(0, 20);
    }
    for (const key of ['canonicalUrl', 'ogImage']) {
      if (seo[key] === undefined) continue;
      const url = safeUrl(seo[key]);
      if (url === null) {
        return invalid(`The ${key === 'canonicalUrl' ? 'canonical URL' : 'share image'} must start with / or https://.`);
      }
      next[key] = url;
    }
    if (seo.noindex !== undefined) next.noindex = Boolean(seo.noindex);
    page.seo = next;
  }

  if (body.blocks !== undefined) {
    const r = readBlocks(body.blocks);
    if (r.problem) return invalid(r.problem);
    page.blocks = r.blocks;
    page.markModified('blocks');
  }
  return null;
}

// Field keys as an editor would say them.
const SAID = { body: 'text', src: 'image', imageAlt: 'image description', buttonUrl: 'button link', path: 'link' };
const said = (key) => SAID[key] ?? key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
const withArticle = (words) => `${/^[aeiou]/.test(words) ? 'an' : 'a'} ${words}`;

/** What a block still needs before it can go live, as short phrases. */
function blockGaps(block) {
  const def = BLOCKS[block.type];
  const gaps = [];
  for (const [key, spec] of Object.entries(def.fields)) {
    const v = block[key];
    if (spec.kind === 'items' || spec.kind === 'strings' || spec.kind === 'rows') {
      const n = Array.isArray(v) ? v.length : 0;
      if (spec.required && n < (spec.minItems ?? 1)) gaps.push(`at least ${spec.minItems ?? 1} ${said(key)}`);
      if (spec.kind === 'items') {
        for (const [sub, subSpec] of Object.entries(spec.fields)) {
          if (subSpec.required && (v ?? []).some((item) => !item[sub])) gaps.push(`${withArticle(said(sub))} on every item`);
        }
      }
    } else if (spec.required && !v) {
      gaps.push(withArticle(said(key)));
    }
  }
  return gaps;
}

/** What stops a page going live, in words an editor can act on. */
export function publishProblems(page) {
  const problems = [];
  if (!page.title?.trim()) problems.push('Add a page title.');
  if (serviceSlugProblem(page.slug)) problems.push('Fix the URL slug.');
  if (!page.subtitle?.trim()) problems.push('Write a subtitle for the hero.');
  if (!page.seo?.metaDescription?.trim() && !page.subtitle?.trim()) problems.push('Write a meta description.');
  if (page.blocks.length === 0) problems.push('Add at least one content block.');
  for (const [i, block] of page.blocks.entries()) {
    const gaps = blockGaps(block);
    if (gaps.length) problems.push(`Block ${i + 1} (${BLOCKS[block.type].label}) needs ${gaps.join(', ')}.`);
  }
  return problems;
}

function seoOf(p) {
  const s = p.seo ?? {};
  return {
    metaTitle: s.metaTitle ?? '',
    metaDescription: s.metaDescription ?? '',
    focusKeyphrase: s.focusKeyphrase ?? '',
    keywords: s.keywords ?? [],
    canonicalUrl: s.canonicalUrl ?? '',
    ogTitle: s.ogTitle ?? '',
    ogDescription: s.ogDescription ?? '',
    ogImage: s.ogImage ?? '',
    noindex: Boolean(s.noindex),
  };
}

/** Everything the page renders, shared by the admin and public views. */
function content(p) {
  return {
    title: p.title,
    slug: p.slug,
    label: p.label ?? '',
    icon: p.icon || ICONS[0],
    subtitle: p.subtitle ?? '',
    heroImage: p.heroImage ?? '',
    heroButtonText: p.heroButtonText ?? '',
    heroButtonLink: p.heroButtonLink ?? '',
    parent: p.parent ?? '',
    blocks: p.blocks ?? [],
    seo: seoOf(p),
    serviceType: p.serviceType ?? '',
    areaServed: p.areaServed ?? '',
  };
}

export function serializeServicePageSummary(p) {
  return {
    id: String(p._id),
    title: p.title,
    slug: p.slug,
    status: p.status,
    noindex: Boolean(p.seo?.noindex),
    blockCount: (p.blocks ?? []).length,
    publishedAt: iso(p.publishedAt),
    updatedAt: iso(p.updatedAt),
    updatedBy: p.updatedBy ?? '',
  };
}

export function serializeAdminServicePage(p) {
  return {
    ...serializeServicePageSummary(p),
    ...content(p),
    createdAt: iso(p.createdAt),
    createdBy: p.createdBy ?? '',
  };
}

/** For the public site: `full` adds the body the page itself needs. */
export function serializePublicServicePage(p, { full = false } = {}) {
  const base = {
    title: p.title,
    slug: p.slug,
    subtitle: p.subtitle ?? '',
    noindex: Boolean(p.seo?.noindex),
    canonicalUrl: p.seo?.canonicalUrl ?? '',
    metaDescription: p.seo?.metaDescription ?? '',
    publishedAt: iso(p.publishedAt),
    updatedAt: iso(p.updatedAt),
  };
  return full ? { ...base, ...content(p), status: p.status } : base;
}
