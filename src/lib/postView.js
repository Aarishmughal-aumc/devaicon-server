// How posts and their library entries leave the API. Admin views carry ids
// for editing; public views carry only what a reader's page needs.

const iso = (d) => (d ? new Date(d).toISOString() : '');
const idOf = (ref) => (ref ? String(ref._id ?? ref) : '');

export function serializeAuthor(a) {
  if (!a) return null;
  return {
    id: String(a._id),
    name: a.name,
    type: a.type ?? 'Person',
    jobTitle: a.jobTitle ?? '',
    bio: a.bio ?? '',
    avatarUrl: a.avatarUrl ?? '',
    links: a.links ?? [],
  };
}

export function serializeCategory(c) {
  if (!c) return null;
  return { id: String(c._id), name: c.name, slug: c.slug, description: c.description ?? '' };
}

export function serializeCta(c) {
  if (!c) return null;
  return {
    id: String(c._id),
    name: c.name,
    heading: c.heading,
    body: c.body ?? '',
    buttonLabel: c.buttonLabel,
    buttonUrl: c.buttonUrl,
    style: c.style ?? 'panel',
  };
}

/** One row of a post list. `authorId` / `categoryId` may be populated. */
export function serializeSummary(p) {
  return {
    id: String(p._id),
    title: p.title,
    subtitle: p.subtitle ?? '',
    slug: p.slug,
    status: p.status,
    featured: Boolean(p.featured),
    publishedAt: iso(p.publishedAt),
    updatedAt: iso(p.updatedAt),
    updatedBy: p.updatedBy ?? '',
    readingMinutes: p.readingMinutes ?? 1,
    heroImage: { url: p.heroImage?.url ?? '', alt: p.heroImage?.alt ?? '' },
    tags: p.tags ?? [],
    noindex: Boolean(p.seo?.noindex),
    author: p.authorId?.name ? { name: p.authorId.name } : null,
    category: p.categoryId?.name
      ? { name: p.categoryId.name, slug: p.categoryId.slug }
      : null,
  };
}

/** Everything the editor needs, with references as ids. */
export function serializeAdminPost(p) {
  return {
    id: String(p._id),
    title: p.title,
    subtitle: p.subtitle ?? '',
    slug: p.slug,
    previousSlugs: p.previousSlugs ?? [],
    categoryId: idOf(p.categoryId),
    tags: p.tags ?? [],
    authorId: idOf(p.authorId),
    heroImage: { url: p.heroImage?.url ?? '', alt: p.heroImage?.alt ?? '' },
    body: p.body ?? { type: 'doc', content: [] },
    faqs: (p.faqs ?? []).map((f) => ({ question: f.question, answer: f.answer })),
    closingCtaId: idOf(p.closingCtaId),
    toc: {
      enabled: p.toc?.enabled !== false,
      depth: p.toc?.depth === 2 ? 2 : 3,
      title: p.toc?.title ?? 'On this page',
      labels: (p.toc?.labels ?? []).map((l) => ({ id: l.id, text: l.text })),
    },
    seo: {
      metaTitle: p.seo?.metaTitle ?? '',
      metaDescription: p.seo?.metaDescription ?? '',
      focusKeyphrase: p.seo?.focusKeyphrase ?? '',
      canonicalUrl: p.seo?.canonicalUrl ?? '',
      ogTitle: p.seo?.ogTitle ?? '',
      ogDescription: p.seo?.ogDescription ?? '',
      ogImage: p.seo?.ogImage ?? '',
      noindex: Boolean(p.seo?.noindex),
    },
    featured: Boolean(p.featured),
    status: p.status,
    publishedAt: iso(p.publishedAt),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
    createdBy: p.createdBy ?? '',
    updatedBy: p.updatedBy ?? '',
    readingMinutes: p.readingMinutes ?? 1,
  };
}

/**
 * What a reader's page needs: the post with its author, category and CTAs
 * resolved. `ctas` maps id → CTA for every CTA the body places inline.
 * Also used for the editor's preview, which renders exactly this.
 */
export function serializePublicPost(p, ctas = []) {
  const admin = serializeAdminPost(p);
  return {
    title: admin.title,
    subtitle: admin.subtitle,
    slug: admin.slug,
    tags: admin.tags,
    heroImage: admin.heroImage,
    body: admin.body,
    faqs: admin.faqs,
    toc: admin.toc,
    seo: admin.seo,
    status: admin.status,
    publishedAt: admin.publishedAt,
    updatedAt: admin.updatedAt,
    readingMinutes: admin.readingMinutes,
    author: serializeAuthor(p.authorId?.name ? p.authorId : null),
    category: serializeCategory(p.categoryId?.name ? p.categoryId : null),
    closingCta: serializeCta(p.closingCtaId?.heading ? p.closingCtaId : null),
    ctas: Object.fromEntries(ctas.map((c) => [String(c._id), serializeCta(c)])),
  };
}
