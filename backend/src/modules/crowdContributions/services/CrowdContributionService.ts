import {inject, injectable} from 'inversify';
import {ForbiddenError, NotFoundError} from 'routing-controllers';
import {env} from '#root/utils/env.js';
import {CROWD_CONTRIBUTION_TYPES} from '../types.js';
import {CrowdContributionRepository} from '../repositories/providers/mongodb/CrowdContributionRepository.js';
import {AiJudgeService} from './AiJudgeService.js';
import {EmbeddingService} from './EmbeddingService.js';
import {SimilarityService} from './SimilarityService.js';
import {
  CrowdContribution,
  CrowdContributionStatus,
  ICrowdContribution,
  ICrowdContributionOption,
} from '../classes/transformers/CrowdContribution.js';
import {buildContentKey} from '../util/signature.js';

export interface ISubmitResult {
  result: 'accept' | 'reject' | 'needs_fix' | 'unavailable';
  message: string;
  suggestion?: string;
  contributionId?: string;
}

const RATE_WINDOW_MS = Number(env('CROWD_RATE_WINDOW_MS') || `${10 * 60 * 1000}`);
const RATE_MAX_PER_WINDOW = Number(env('CROWD_RATE_MAX_PER_SEGMENT') || '5');

@injectable()
export class CrowdContributionService {
  constructor(
    @inject(CROWD_CONTRIBUTION_TYPES.CrowdContributionRepo)
    private readonly repository: CrowdContributionRepository,
    @inject(CROWD_CONTRIBUTION_TYPES.AiJudgeService)
    private readonly judge: AiJudgeService,
    @inject(CROWD_CONTRIBUTION_TYPES.EmbeddingService)
    private readonly embedding: EmbeddingService,
    @inject(CROWD_CONTRIBUTION_TYPES.SimilarityService)
    private readonly similarity: SimilarityService,
  ) {}

  async submit(input: {
    courseId: string;
    courseVersionId: string;
    segmentId: string;
    questionType: 'SELECT_ONE_IN_LOT';
    questionText: string;
    options: ICrowdContributionOption[];
    correctOptionIndex: number;
    createdBy: string;
  }): Promise<ISubmitResult> {
    const contentKey = buildContentKey(input.questionText, input.options);

    // 1) Rate limit (DB-backed, per user + segment).
    const recent = await this.repository.countAttemptsSince({
      createdBy: input.createdBy,
      segmentId: input.segmentId,
      since: new Date(Date.now() - RATE_WINDOW_MS),
    });
    if (recent >= RATE_MAX_PER_WINDOW) {
      return {
        result: 'reject',
        message:
          "You're submitting a lot of questions for this lesson — take a short break and try again in a few minutes.",
      };
    }

    // 2) Exact-duplicate short-circuit (cheap, no LLM/embedding cost).
    const exact = await this.repository.findExactDuplicate({
      courseVersionId: input.courseVersionId,
      segmentId: input.segmentId,
      normalizedSignature: contentKey,
    });
    if (exact) {
      await this.repository.logAttempt({
        createdBy: input.createdBy,
        segmentId: input.segmentId,
        verdict: 'reject',
        category: 'duplicate',
        normalizedSignature: contentKey,
      });
      return {
        result: 'reject',
        message:
          'A very similar question already exists for this part of the lesson — nice thinking, though!',
      };
    }

    // 3) AI judge (fail CLOSED — never persist if we could not screen).
    let verdict;
    try {
      verdict = await this.judge.screen({
        questionText: input.questionText,
        options: input.options,
        correctOptionIndex: input.correctOptionIndex,
        segmentId: input.segmentId,
      });
    } catch {
      return {
        result: 'unavailable',
        message:
          "We couldn't check your question right now — please try again in a moment.",
      };
    }

    // Log every screened attempt (powers rate limiting + later tuning).
    await this.repository.logAttempt({
      createdBy: input.createdBy,
      segmentId: input.segmentId,
      verdict: verdict.verdict,
      category: verdict.category,
      normalizedSignature: contentKey,
    });

    if (verdict.verdict === 'reject') {
      return {result: 'reject', message: verdict.studentMessage};
    }
    if (verdict.verdict === 'needs_fix') {
      return {
        result: 'needs_fix',
        message: verdict.studentMessage,
        suggestion: verdict.suggestedFix,
      };
    }

    // 4) Accept → embed + near-duplicate check (detect-and-flag only).
    const embedding = await this.embedding.embed(contentKey, 'document');
    let possibleDuplicateOf = null as ICrowdContribution['possibleDuplicateOf'];
    if (embedding) {
      const dup = await this.similarity.checkDuplicate({
        courseVersionId: input.courseVersionId,
        segmentId: input.segmentId,
        embedding,
      });
      if (dup.isDuplicate) {
        return {
          result: 'reject',
          message:
            'A near-identical question already exists for this part of the lesson — great minds think alike!',
        };
      }
      possibleDuplicateOf = dup.possibleDuplicateOf ?? null;
    }

    // 5) Persist as PENDING_REVIEW.
    const doc = new CrowdContribution({
      courseId: input.courseId,
      courseVersionId: input.courseVersionId,
      segmentId: input.segmentId,
      questionType: input.questionType,
      questionText: input.questionText,
      options: input.options,
      correctOptionIndex: input.correctOptionIndex,
      normalizedSignature: contentKey,
      createdBy: input.createdBy,
      screeningVerdict: verdict,
      embedding: embedding ?? undefined,
      embeddingModel: embedding ? this.embedding.modelName : undefined,
      possibleDuplicateOf,
    });
    const contributionId = await this.repository.create(doc);

    return {
      result: 'accept',
      message:
        verdict.studentMessage ||
        'Thanks! Your question passed our checks and is now waiting for a teacher to review it.',
      contributionId,
    };
  }

  async listMyContributions(input: {
    userId: string;
    status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'ALL';
    limit: number;
  }): Promise<ICrowdContribution[]> {
    const status =
      input.status && input.status !== 'ALL'
        ? (input.status as CrowdContributionStatus)
        : undefined;
    return this.repository.listByUser({
      userId: input.userId,
      status,
      limit: input.limit,
    });
  }

  async listReviewQueue(input: {
    reviewerRole: string;
    courseId: string;
    courseVersionId: string;
    limit: number;
  }): Promise<ICrowdContribution[]> {
    this._assertReviewer(input.reviewerRole);
    return this.repository.listReviewQueue({
      courseId: input.courseId,
      courseVersionId: input.courseVersionId,
      limit: input.limit,
    });
  }

  async approve(input: {
    contributionId: string;
    reviewerId: string;
    reviewerRole: string;
  }): Promise<void> {
    this._assertReviewer(input.reviewerRole);
    const existing = await this.repository.findById(input.contributionId);
    if (!existing) throw new NotFoundError('Contribution not found.');
    const ok = await this.repository.updateStatus({
      id: input.contributionId,
      status: 'APPROVED',
      reviewedBy: input.reviewerId,
    });
    if (!ok) throw new NotFoundError('Contribution not found.');
  }

  async reject(input: {
    contributionId: string;
    reviewerId: string;
    reviewerRole: string;
    reason: string;
  }): Promise<void> {
    this._assertReviewer(input.reviewerRole);
    const existing = await this.repository.findById(input.contributionId);
    if (!existing) throw new NotFoundError('Contribution not found.');
    const ok = await this.repository.updateStatus({
      id: input.contributionId,
      status: 'REJECTED',
      reviewedBy: input.reviewerId,
      rejectionReason: input.reason,
    });
    if (!ok) throw new NotFoundError('Contribution not found.');
  }

  /**
   * Phase 1 review gate. Minimal, safe-by-default: only platform admins may
   * review. TODO(auth): extend to course-version instructors/TAs once the
   * course-role lookup is wired (this is the "must-decide before coding" item).
   */
  private _assertReviewer(role: string): void {
    if (role !== 'admin') {
      throw new ForbiddenError(
        'Only reviewers (instructors/admins) can review contributions.',
      );
    }
  }
}
