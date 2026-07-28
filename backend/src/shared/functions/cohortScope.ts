import {ObjectId} from 'mongodb';
import {ForbiddenError} from 'routing-controllers';
import {inject, injectable} from 'inversify';
import {AuthenticatedUser} from '#root/shared/interfaces/models.js';
import {ICourseRepository} from '#root/shared/database/interfaces/ICourseRepository.js';
import {GLOBAL_TYPES} from '#root/types.js';

/**
 * Roles whose reach is confined to explicitly assigned cohorts. MANAGER and TA
 * are deliberately excluded — they retain course/version-wide reach.
 */
export const COHORT_SCOPED_ROLES: ReadonlySet<string> = new Set([
  'INSTRUCTOR',
  'STAFF',
]);

/**
 * The set of cohorts a caller may read or act on for one course version.
 *
 * `cohortIds: null` means **unrestricted** — admins, cohort-agnostic roles
 * (MANAGER/TA) and versions that have no cohorts at all. Read it through
 * `cohortScopeFilter`/`cohortScopeIds` rather than testing the field, so the
 * null convention stays in one place.
 *
 * (Modelled as one shape rather than a discriminated union because this
 * project compiles with `strict: false`, where boolean-literal discriminants
 * do not narrow.)
 */
export interface CohortScope {
  cohortIds: ObjectId[] | null;
}

/**
 * Translate a scope into a Mongo filter fragment. An unrestricted scope
 * contributes nothing; a restricted one always contributes an `$in`, even for
 * a single cohort, so callers cannot accidentally widen it later.
 */
export function cohortScopeFilter(
  scope: CohortScope,
  field = 'cohortId',
): Record<string, unknown> {
  if (!scope || scope.cohortIds === null) return {};
  return {[field]: {$in: scope.cohortIds}};
}

/** The cohort ids in a scope, or `null` when it is unrestricted. */
export function cohortScopeIds(scope: CohortScope): ObjectId[] | null {
  return scope?.cohortIds ?? null;
}

const UNRESTRICTED: CohortScope = {cohortIds: null};

/**
 * Resolves which cohorts a caller may touch on a given course version.
 *
 * This is the single place that decides cohort visibility. Call sites must
 * pass the resolved scope into their queries instead of the request's
 * `cohortId` — a client-supplied cohort is a *request*, never a grant.
 */
@injectable()
export class CohortScopeService {
  constructor(
    @inject(GLOBAL_TYPES.CourseRepo)
    private readonly courseRepo: ICourseRepository,
  ) {}

  async resolve(
    user: AuthenticatedUser,
    courseId: string,
    versionId: string,
    requestedCohortId?: string,
  ): Promise<CohortScope> {
    const allowed = this.allowedCohortIds(user, courseId, versionId);

    if (allowed === null) {
      if (!requestedCohortId) return UNRESTRICTED;
      return {cohortIds: [toObjectId(requestedCohortId)]};
    }

    if (allowed.length === 0) {
      // Nothing assigned. Distinguish "this version has no cohorts, so there
      // is nothing to wall off" from "an admin has not assigned any yet",
      // which must fail loudly rather than look like an empty course.
      if (await this.versionHasCohorts(versionId)) {
        throw new ForbiddenError(
          'You have no cohorts assigned for this course version. Ask an administrator to assign one.',
        );
      }
      return UNRESTRICTED;
    }

    if (requestedCohortId) {
      if (!allowed.includes(requestedCohortId)) {
        throw new ForbiddenError(
          'You do not have access to the requested cohort',
        );
      }
      return {cohortIds: [toObjectId(requestedCohortId)]};
    }

    return {cohortIds: allowed.map(toObjectId)};
  }

  /**
   * Cohorts allowed across every enrollment the caller holds on this version,
   * or `null` when at least one of them is cohort-agnostic.
   */
  allowedCohortIds(
    user: AuthenticatedUser,
    courseId: string,
    versionId: string,
  ): string[] | null {
    if (user.globalRole === 'admin') return null;

    const matching = user.enrollments.filter(
      e => e.courseId === courseId && e.versionId === versionId,
    );
    if (matching.length === 0) return [];
    if (matching.some(e => e.cohortIds === null)) return null;

    return [...new Set(matching.flatMap(e => e.cohortIds ?? []))];
  }

  private async versionHasCohorts(versionId: string): Promise<boolean> {
    const version = await this.courseRepo.readVersion(versionId);
    return (version?.cohorts?.length ?? 0) > 0;
  }
}

function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new ForbiddenError('Invalid cohort identifier');
  }
  return new ObjectId(id);
}
