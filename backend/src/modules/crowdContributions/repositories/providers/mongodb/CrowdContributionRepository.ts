import 'reflect-metadata';
import {Collection, ObjectId} from 'mongodb';
import {injectable, inject} from 'inversify';
import {MongoDatabase} from '#shared/database/providers/mongo/MongoDatabase.js';
import {GLOBAL_TYPES} from '#root/types.js';
import {
  CrowdContribution,
  CrowdContributionStatus,
  ICrowdContribution,
} from '../../../classes/transformers/CrowdContribution.js';

const VECTOR_INDEX_NAME = 'crowd_embedding_idx';
const EMBEDDING_DIM = 1024;

/** A lightweight, append-only record of every submit attempt (incl. rejected),
 * used for DB-backed rate limiting and later filter tuning. */
interface ICrowdAttempt {
  _id?: ObjectId;
  createdBy: ObjectId;
  segmentId: ObjectId;
  verdict?: string;
  category?: string;
  normalizedSignature: string;
  createdAt: Date;
}

export interface IVectorNeighbor {
  _id: ObjectId;
  questionText: string;
  score: number;
}

@injectable()
export class CrowdContributionRepository {
  private collection!: Collection<ICrowdContribution>;
  private attempts!: Collection<ICrowdAttempt>;
  private initialized = false;

  constructor(@inject(GLOBAL_TYPES.Database) private db: MongoDatabase) {}

  private async init() {
    if (this.initialized) return;
    this.collection =
      await this.db.getCollection<ICrowdContribution>('crowdContributions');
    this.attempts =
      await this.db.getCollection<ICrowdAttempt>('crowdContributionAttempts');
    this.initialized = true;

    try {
      await this.collection.createIndex(
        {courseVersionId: 1, segmentId: 1, isDeleted: 1},
        {background: true},
      );
      await this.collection.createIndex(
        {createdBy: 1, isDeleted: 1},
        {background: true},
      );
      await this.collection.createIndex(
        {courseId: 1, courseVersionId: 1, status: 1, isDeleted: 1},
        {background: true},
      );
      await this.collection.createIndex(
        {courseVersionId: 1, segmentId: 1, normalizedSignature: 1, isDeleted: 1},
        {background: true},
      );
      await this.attempts.createIndex(
        {createdBy: 1, segmentId: 1, createdAt: -1},
        {background: true},
      );
    } catch {
      // indexes already exist
    }

    // Atlas Vector Search index — best-effort. Fails on non-Atlas / disabled
    // tiers; the vector-search query degrades to "no neighbours" in that case.
    try {
      await (this.collection as any).createSearchIndex({
        name: VECTOR_INDEX_NAME,
        type: 'vectorSearch',
        definition: {
          fields: [
            {
              type: 'vector',
              path: 'embedding',
              numDimensions: EMBEDDING_DIM,
              similarity: 'cosine',
            },
            {type: 'filter', path: 'segmentId'},
            {type: 'filter', path: 'courseVersionId'},
            {type: 'filter', path: 'status'},
          ],
        },
      });
    } catch (err) {
      // Already exists, or Vector Search not enabled on this cluster.
      console.warn(
        'crowd: vector search index unavailable (dedup falls back to exact-signature):',
        (err as any)?.message,
      );
    }
  }

  async create(contribution: CrowdContribution): Promise<string> {
    await this.init();
    const result = await this.collection.insertOne(contribution);
    return result.insertedId.toString();
  }

  async logAttempt(input: {
    createdBy: string;
    segmentId: string;
    verdict?: string;
    category?: string;
    normalizedSignature: string;
  }): Promise<void> {
    await this.init();
    await this.attempts
      .insertOne({
        createdBy: new ObjectId(input.createdBy),
        segmentId: new ObjectId(input.segmentId),
        verdict: input.verdict,
        category: input.category,
        normalizedSignature: input.normalizedSignature,
        createdAt: new Date(),
      })
      .catch(() => {});
  }

  async countAttemptsSince(input: {
    createdBy: string;
    segmentId: string;
    since: Date;
  }): Promise<number> {
    await this.init();
    return this.attempts.countDocuments({
      createdBy: new ObjectId(input.createdBy),
      segmentId: new ObjectId(input.segmentId),
      createdAt: {$gte: input.since},
    });
  }

  async findExactDuplicate(input: {
    courseVersionId: string;
    segmentId: string;
    normalizedSignature: string;
  }): Promise<ICrowdContribution | null> {
    await this.init();
    return this.collection.findOne({
      courseVersionId: new ObjectId(input.courseVersionId),
      segmentId: new ObjectId(input.segmentId),
      normalizedSignature: input.normalizedSignature,
      status: {$in: ['PENDING_REVIEW', 'APPROVED']},
      isDeleted: {$ne: true},
    });
  }

  /** ANN near-duplicate search scoped to the same segment. Returns [] when the
   * vector index is unavailable / still building (graceful degradation). */
  async vectorSearchSimilar(input: {
    courseVersionId: string;
    segmentId: string;
    embedding: number[];
    limit?: number;
    numCandidates?: number;
  }): Promise<IVectorNeighbor[]> {
    await this.init();
    try {
      const docs = await this.collection
        .aggregate([
          {
            $vectorSearch: {
              index: VECTOR_INDEX_NAME,
              path: 'embedding',
              queryVector: input.embedding,
              numCandidates: input.numCandidates ?? 100,
              limit: input.limit ?? 5,
              filter: {
                segmentId: new ObjectId(input.segmentId),
                courseVersionId: new ObjectId(input.courseVersionId),
                status: {$in: ['PENDING_REVIEW', 'APPROVED']},
                isDeleted: {$ne: true},
              },
            },
          },
          {
            $project: {
              questionText: 1,
              score: {$meta: 'vectorSearchScore'},
            },
          },
        ])
        .toArray();
      return docs.map(d => ({
        _id: d._id as ObjectId,
        questionText: (d as any).questionText,
        score: (d as any).score,
      }));
    } catch (err) {
      console.warn('crowd: $vectorSearch unavailable:', (err as any)?.message);
      return [];
    }
  }

  async findById(id: string): Promise<ICrowdContribution | null> {
    await this.init();
    return this.collection.findOne({
      _id: new ObjectId(id),
      isDeleted: {$ne: true},
    });
  }

  async listByUser(input: {
    userId: string;
    status?: CrowdContributionStatus;
    limit: number;
  }): Promise<ICrowdContribution[]> {
    await this.init();
    const filter: Record<string, unknown> = {
      createdBy: new ObjectId(input.userId),
      isDeleted: {$ne: true},
    };
    if (input.status) filter.status = input.status;
    return this.collection
      .find(filter)
      .sort({createdAt: -1})
      .limit(input.limit)
      .toArray();
  }

  async listReviewQueue(input: {
    courseId: string;
    courseVersionId: string;
    limit: number;
  }): Promise<ICrowdContribution[]> {
    await this.init();
    return this.collection
      .find({
        courseId: new ObjectId(input.courseId),
        courseVersionId: new ObjectId(input.courseVersionId),
        status: 'PENDING_REVIEW',
        isDeleted: {$ne: true},
      })
      .sort({createdAt: -1})
      .limit(input.limit)
      .toArray();
  }

  async updateStatus(input: {
    id: string;
    status: CrowdContributionStatus;
    reviewedBy: string;
    rejectionReason?: string;
  }): Promise<boolean> {
    await this.init();
    const result = await this.collection.updateOne(
      {_id: new ObjectId(input.id), isDeleted: {$ne: true}},
      {
        $set: {
          status: input.status,
          reviewedBy: new ObjectId(input.reviewedBy),
          reviewedAt: new Date(),
          rejectionReason:
            input.status === 'REJECTED' ? input.rejectionReason : undefined,
          updatedAt: new Date(),
        },
      },
    );
    return result.matchedCount > 0;
  }
}
