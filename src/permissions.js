/**
 * The permission catalogue. Roles toggle these on and off; they cannot invent
 * new ones, because every key here is checked somewhere in the routes.
 *
 * The client never keeps its own copy: GET /api/roles sends this list along
 * with the roles, so a permission added here shows up in the Roles grid
 * without a client deploy.
 */
export const PERMISSIONS = [
  {
    key: 'timelogs.log',
    group: 'Time logs',
    label: 'Log own time',
    description: 'Use the time tracker: log, view and delete their own entries.',
  },
  {
    key: 'timelogs.review',
    group: 'Time logs',
    label: 'Review everyone’s logs',
    description: 'See every entry, approve or unapprove it, and flag it.',
  },
  {
    key: 'timelogs.delete_any',
    group: 'Time logs',
    label: 'Delete any log',
    description: 'Delete anyone’s entries, including approved ones.',
  },
  {
    key: 'timelogs.export',
    group: 'Time logs',
    label: 'Export and print reports',
    description: 'Download CSV exports and print time-log reports.',
  },
  {
    key: 'projects.manage',
    group: 'Time logs',
    label: 'Manage projects',
    description: 'Add and remove the projects time can be logged against.',
  },
  {
    key: 'posts.write',
    group: 'Insights',
    label: 'Write posts',
    description: 'Create posts and edit drafts, including uploading images.',
  },
  {
    key: 'posts.publish',
    group: 'Insights',
    label: 'Publish posts',
    description:
      'Publish, schedule and unpublish posts, and edit posts that are live.',
  },
  {
    key: 'posts.delete',
    group: 'Insights',
    label: 'Delete posts',
    description: 'Delete posts for good, including live ones.',
  },
  {
    key: 'blog.library',
    group: 'Insights',
    label: 'Manage the blog library',
    description: 'Add and edit authors, calls to action and categories.',
  },
  {
    key: 'users.manage',
    group: 'Team',
    label: 'Manage users',
    description:
      'Create accounts, assign roles, reset passwords and deactivate people.',
  },
  {
    key: 'roles.manage',
    group: 'Team',
    label: 'Manage roles',
    description:
      'Create, rename and delete roles and change what each one allows.',
  },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Drop anything that isn't a known key, and de-duplicate. */
export function cleanPermissions(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const key of value) {
    if (typeof key !== 'string') return null;
    if (PERMISSION_KEYS.includes(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Built-in roles created on first start. Owner is locked; the rest are not. */
export const OWNER_ROLE_NAME = 'Owner';

export const DEFAULT_ROLES = [
  {
    name: 'Admin',
    description: 'Runs the time logger and the team, but cannot change roles.',
    permissions: PERMISSION_KEYS.filter((k) => k !== 'roles.manage'),
  },
  {
    name: 'Developer',
    description: 'Logs their own time.',
    permissions: ['timelogs.log'],
  },
];
