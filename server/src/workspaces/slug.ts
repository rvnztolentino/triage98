// Slugs are the workspace's public handle: every workspace-scoped URL is keyed by
// slug rather than UUID. The database enforces the shape
// (`^[a-z0-9]+(-[a-z0-9]+)*$`), so anything produced here must already match it —
// a rejected insert would surface as a 500 instead of a useful message.

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 63;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True when a string is a valid workspace slug. */
export function isValidSlug(value: string): boolean {
  return (
    value.length >= SLUG_MIN_LENGTH &&
    value.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(value)
  );
}

/**
 * Derives a slug from a workspace name: lowercase, non-alphanumerics collapsed to
 * single hyphens, trimmed. Names that reduce to nothing usable (punctuation only,
 * or non-Latin scripts that leave no ASCII behind) fall back to `workspace`, and
 * the caller's uniqueness loop appends a suffix if that is already taken.
 */
export function slugFromName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // Leave room for the `-2`…`-20` disambiguation suffix.
    .slice(0, SLUG_MAX_LENGTH - 4)
    .replace(/-+$/g, '');

  if (base.length >= SLUG_MIN_LENGTH) return base;
  return base ? `${base}-workspace` : 'workspace';
}

/**
 * Nth candidate slug for a base: the base itself first, then `base-2`, `base-3`, …
 * Used to retry creation when another workspace already claimed the name.
 */
export function slugCandidate(base: string, attempt: number): string {
  return attempt === 0 ? base : `${base}-${attempt + 1}`;
}
