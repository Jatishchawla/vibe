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

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Phase 1 dedup = DETECT-AND-FLAG only (no auto-supersede, no "which-is-better"
 * LLM). Runs only after the judge accepts and after a successful embed.
 *
 * Uses an in-app cosine scan over the segment's stored vectors — works on any
 * MongoDB (including a local cluster), since dedup is scoped to a single
 * segment and the candidate set is small.
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
    const candidates = await this.repository.listSegmentEmbeddings({
      courseVersionId: input.courseVersionId,
      segmentId: input.segmentId,
    });
    if (candidates.length === 0) return {isDuplicate: false};

    let bestId: ObjectId | undefined;
    let bestScore = -1;
    for (const c of candidates) {
      const score = cosineSimilarity(input.embedding, c.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestId = c._id;
      }
    }

    if (bestScore >= this.hardThreshold) {
      return {isDuplicate: true, nearestScore: bestScore};
    }
    if (bestScore >= this.nearThreshold) {
      return {
        isDuplicate: false,
        possibleDuplicateOf: bestId,
        nearestScore: bestScore,
      };
    }
    return {isDuplicate: false, nearestScore: bestScore};
  }
}
