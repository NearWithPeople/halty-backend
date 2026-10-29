/**
 * Central authorization policy (ABAC-lite).
 *
 * `can` is the single source of truth for object/action-level access decisions:
 * it receives the subject (authenticated user), the action being performed and
 * the attributes of the target resource, and returns allow/deny. Rules for
 * other resources (`application`, `vacancy`, …) are added here over time so
 * controllers never re-implement the same checks.
 */

/**
 * Subject attributes used by the policy. Mirrors the authenticated user that
 * users-permissions exposes on `ctx.state.user` (JWT payload + loaded row).
 */
export type AuthUser = {
  id?: number;
  documentId?: string;
  accountRole?: 'user' | 'employer' | 'admin';
  companyName?: string;
};

/** Actions that can be authorized by {@link can}. */
export type PolicyAction = 'favorites:read' | 'favorites:add' | 'favorites:remove';

/** Attributes of the target resource required to evaluate a rule. */
export type PolicyContext = {
  /** Owner id of the target resource. */
  userId?: number;
};

/**
 * Decide whether `user` may perform `action` on the resource described by
 * `context`.
 *
 * Denies by default: an anonymous user, an unknown action, or a rule whose
 * required context is missing all return `false`. Callers are responsible for
 * mapping the result to the appropriate HTTP status (e.g. `403`/`404`).
 *
 * @param user - Authenticated subject (`ctx.state.user`); may be undefined.
 * @param action - Action being attempted (see {@link PolicyAction}).
 * @param context - Attributes of the target resource (see {@link PolicyContext}).
 * @returns `true` when access is allowed, `false` otherwise.
 *
 * @example
 * can(user, 'favorites:read', { userId: user.id }); // own favorites only
 */
export function can(
  user: AuthUser | undefined,
  action: PolicyAction,
  context: PolicyContext = {},
): boolean {
  if (!user || typeof user.id !== 'number') {
    return false;
  }

  switch (action) {
    case 'favorites:read':
    case 'favorites:add':
    case 'favorites:remove':
      // Favorites are strictly owner-scoped: only the owning user may act on them.
      return typeof context.userId === 'number' && user.id === context.userId;
    default:
      return false;
  }
}
