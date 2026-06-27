import {inject, injectable} from 'inversify';
import {ObjectId} from 'mongodb';
import {env} from '#root/utils/env.js';
import {CROWD_CONTRIBUTION_TYPES} from '../types.js';
import {CrowdContributionRepository} from '../repositories/providers/mongodb/CrowdContributionRepository.js';

export interface IDuplicateDecision {
  /** true => a near-identical question already exists; reject the newcomer. */
  isDuplicate: boolean;
  /** set when a near (but not identical) duplicate exists; flag for the teacher. */
  possibleDuplicateOf?: ObjectId;
  nearestScore?: number;
}

/**
 * Phase 1 dedup = DETECT-AND-FLAG only (no auto-supersede, no "which-is-better"
 * LLM). Runs only after the judge accepts and after a successful embed.
 */
@injectable()
export class SimilarityService {
  private readonly hardThreshold = Number(
    env('CROWD_HARD_DUP_THRESHOLD') || '0.985',
  );
  private readonly nearThreshold = Number(
    env('CROWD_NEAR_DUP_THRESHOLD') || '0.92',
  );

  constructor(
    @inject(CROWD_CONTRIBUTION_TYPES.CrowdContributionRepo)
    private readonly repository: CrowdContributionRepository,
  ) {}

  async checkDuplicate(input: {
    courseVersionId: string;
    segmentId: string;
    embedding: number[];
  }): Promise<IDuplicateDecision> {
    const neighbours = await this.repository.vectorSearchSimilar({
      courseVersionId: input.courseVersionId,
      segmentId: input.segmentId,
      embedding: input.embedding,
      limit: 3,
    });
    if (neighbours.length === 0) return {isDuplicate: false};

    const nearest = neighbours[0];
    if (nearest.score >= this.hardThreshold) {
      return {isDuplicate: true, nearestScore: nearest.score};
    }
    if (nearest.score >= this.nearThreshold) {
      return {
        isDuplicate: false,
        possibleDuplicateOf: nearest._id,
        nearestScore: nearest.score,
      };
    }
    return {isDuplicate: false, nearestScore: nearest.score};
  }
}
