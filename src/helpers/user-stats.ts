import type { Core } from '@strapi/strapi';

/**
 * Computed (not persisted) reputation metrics exposed on a user document.
 *
 * - `rating` — average `JobRating` of the user's completed applications.
 * - `completedShifts` — number of applications with `applicationStatus: 'completed'`.
 * - `averageDelaySec` — average `EmployeeDelaySec` across completed applications
 *   (missing delay counts as `0`, i.e. on time).
 * - `punctuality` — `averageDelaySec` converted to percent: `100` for no delay,
 *   linearly decreasing down to `0` at one hour of average delay.
 */
export type UserComputedStats = {
  rating: number | null;
  completedShifts: number;
  punctuality: number;
  averageDelaySec: number;
};

type ApplicationStatDoc = {
  applicationStatus?: string;
  JobRating?: unknown;
  EmployeeDelaySec?: unknown;
};

type ApplicationWithOwner = ApplicationStatDoc & { owner?: { id?: number } | number | null };

/**
 * Average delay (seconds) at which punctuality reaches `0%`. Delays longer
 * than one hour all map to `0%`.
 */
export const PUNCTUALITY_ZERO_DELAY_SEC = 60 * 60;

const EMPTY_STATS: UserComputedStats = {
  rating: null,
  completedShifts: 0,
  punctuality: 100,
  averageDelaySec: 0,
};

const APPLICATION_STATS_FIELDS = ['applicationStatus', 'JobRating', 'EmployeeDelaySec'] as const;

function toFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Convert an average delay to a punctuality percentage.
 *
 * `0 s` (or negative) → `100%`, one hour or more → `0%`, linear in between.
 * This is the "middle" converter replacing the previous binary
 * punctual/not-punctual logic.
 *
 * @param averageDelaySec - Average employee delay in seconds.
 * @returns Punctuality as an integer percentage in the `0..100` range.
 */
export function delayToPunctuality(averageDelaySec: number): number {
  if (!Number.isFinite(averageDelaySec) || averageDelaySec <= 0) return 100;
  const ratio = 1 - averageDelaySec / PUNCTUALITY_ZERO_DELAY_SEC;
  return Math.max(0, Math.round(ratio * 100));
}

/**
 * Compute user reputation metrics from their applications. Only completed
 * applications are taken into account; a missing delay is treated as on time.
 *
 * @param applications - Application documents of a single user.
 * @returns The computed stats (`rating` is `null` when there are no ratings).
 */
export function computeUserStats(applications: ApplicationStatDoc[]): UserComputedStats {
  const completed = applications.filter((app) => app.applicationStatus === 'completed');

  const ratings = completed
    .map((app) => toFiniteNumber(app.JobRating))
    .filter((rating): rating is number => rating !== undefined);

  const delays = completed.map((app) => toFiniteNumber(app.EmployeeDelaySec) ?? 0);

  const averageDelaySec = delays.length
    ? Math.round(delays.reduce((sum, delay) => sum + delay, 0) / delays.length)
    : 0;

  return {
    rating: ratings.length
      ? round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length, 2)
      : null,
    completedShifts: completed.length,
    averageDelaySec,
    punctuality: delayToPunctuality(averageDelaySec),
  };
}

/**
 * Load the completed applications of a user and compute their stats.
 *
 * @param strapi - Running Strapi instance.
 * @param userId - Numeric user id of the application owner.
 * @returns The user's computed stats (defaults when they have none).
 */
export async function getUserStats(strapi: Core.Strapi, userId: number): Promise<UserComputedStats> {
  const applications = await strapi.documents('api::application.application').findMany({
    filters: {
      owner: { id: { $eq: userId } },
      applicationStatus: { $eq: 'completed' },
    },
    fields: APPLICATION_STATS_FIELDS as never,
  });

  return computeUserStats(applications as unknown as ApplicationStatDoc[]);
}

/**
 * Batch variant of {@link getUserStats}: loads completed applications for many
 * owners in one query and returns a stats map keyed by user id.
 *
 * @param strapi - Running Strapi instance.
 * @param userIds - User ids to compute stats for (duplicates are ignored).
 * @returns Map with an entry for every requested user, even without applications.
 */
export async function getUserStatsByOwner(
  strapi: Core.Strapi,
  userIds: number[],
): Promise<Map<number, UserComputedStats>> {
  const uniqueIds = Array.from(new Set(userIds.filter((id) => Number.isInteger(id))));
  const result = new Map<number, UserComputedStats>();
  if (uniqueIds.length === 0) return result;

  const applications = await strapi.documents('api::application.application').findMany({
    filters: {
      owner: { id: { $in: uniqueIds } },
      applicationStatus: { $eq: 'completed' },
    },
    fields: APPLICATION_STATS_FIELDS as never,
    populate: { owner: { fields: ['id'] } },
  });

  const grouped = new Map<number, ApplicationStatDoc[]>();
  for (const application of applications as unknown as ApplicationWithOwner[]) {
    const owner = application.owner;
    const ownerId = typeof owner === 'object' && owner !== null ? owner.id : owner;
    if (typeof ownerId !== 'number') continue;
    const list = grouped.get(ownerId) ?? [];
    list.push(application);
    grouped.set(ownerId, list);
  }

  for (const id of uniqueIds) {
    result.set(id, grouped.has(id) ? computeUserStats(grouped.get(id) as ApplicationStatDoc[]) : { ...EMPTY_STATS });
  }

  return result;
}
