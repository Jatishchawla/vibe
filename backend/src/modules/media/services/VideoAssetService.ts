import {inject, injectable} from 'inversify';
import {ObjectId} from 'mongodb';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from 'routing-controllers';
import {EnrollmentService} from '#root/modules/users/services/EnrollmentService.js';
import {IUser} from '#root/shared/interfaces/models.js';
import {storageConfig} from '#root/config/storage.js';
import {MEDIA_TYPES} from '../types.js';
import {
  IVideoAsset,
  VideoAsset,
} from '../classes/transformers/VideoAsset.js';
import {VideoAssetRepository} from '../repositories/providers/mongodb/VideoAssetRepository.js';
import {VideoStorageService} from './storage/VideoStorageService.js';
import {
  PlaybackGrant,
  PlaybackUrlProvider,
} from './storage/PlaybackUrlProvider.js';
import {
  buildUploadObjectKey,
  isAllowedSourceFileName,
} from './storage/videoStoragePaths.js';

/** Enrollment roles allowed to upload and manage course video. */
const MANAGING_ROLES = new Set(['INSTRUCTOR', 'MANAGER', 'TA', 'STAFF']);

@injectable()
export class VideoAssetService {
  constructor(
    @inject(MEDIA_TYPES.VideoAssetRepo)
    private readonly repository: VideoAssetRepository,
    @inject(MEDIA_TYPES.VideoStorageService)
    private readonly storage: VideoStorageService,
    @inject(MEDIA_TYPES.PlaybackUrlProvider)
    private readonly playbackUrls: PlaybackUrlProvider,
    @inject(EnrollmentService)
    private readonly enrollments: EnrollmentService,
  ) {}

  /**
   * Reserve an asset and hand back a signed URL the browser PUTs the file to.
   *
   * The bytes never transit ViBe — this only issues the grant, so a large
   * upload costs the backend one signature instead of a long-lived request.
   */
  async createUploadUrl(input: {
    user: IUser;
    courseId: string;
    courseVersionId: string;
    fileName: string;
    contentType: string;
    sizeBytes?: number;
  }): Promise<{
    assetId: string;
    uploadUrl: string;
    uploadObjectKey: string;
    expiresAt: Date;
    requiredContentType: string;
  }> {
    const userId = requireUserId(input.user);
    await this.assertCanManage(input.user, input.courseId, input.courseVersionId);

    if (!isAllowedSourceFileName(input.fileName)) {
      throw new BadRequestError(
        'Unsupported video file type. Allowed: .mp4, .mov, .mkv, .webm, .avi, .m4v',
      );
    }
    if (!input.contentType?.startsWith('video/')) {
      throw new BadRequestError('contentType must be a video/* MIME type.');
    }
    if (
      input.sizeBytes !== undefined &&
      input.sizeBytes > storageConfig.video.maxUploadBytes
    ) {
      throw new BadRequestError(
        `File exceeds the maximum upload size of ${storageConfig.video.maxUploadBytes} bytes.`,
      );
    }

    // The object key embeds the assetId, so the id has to exist first.
    const assetId = new ObjectId();
    const uploadObjectKey = buildUploadObjectKey(
      assetId.toString(),
      input.fileName,
    );

    const asset = new VideoAsset({
      courseId: input.courseId,
      courseVersionId: input.courseVersionId,
      createdBy: userId,
      originalFileName: input.fileName,
      contentType: input.contentType,
      uploadObjectKey,
    });
    await this.repository.create({...asset, _id: assetId});

    const {url, expiresAt} = await this.storage.createUploadUrl(
      uploadObjectKey,
      input.contentType,
    );

    return {
      assetId: assetId.toString(),
      uploadUrl: url,
      uploadObjectKey,
      expiresAt,
      requiredContentType: input.contentType,
    };
  }

  /**
   * Called by the client once its PUT succeeds.
   *
   * Treated as a *hint*, not a fact: the transition only happens if the object
   * is actually present in the bucket, so a client cannot advance an asset it
   * never uploaded.
   */
  async markUploaded(assetId: string, user: IUser): Promise<IVideoAsset> {
    const asset = await this.loadManageable(assetId, user);

    const {exists, sizeBytes} = await this.storage.statUpload(
      asset.uploadObjectKey,
    );
    // Only a definite "not there" blocks. 'unknown' means our credentials are
    // write-only on the upload bucket — the correct least-privilege grant — so
    // we cannot look, and refusing here would break every upload. READY still
    // requires a real playlist in the stream bucket, which a client cannot fake.
    if (exists === false) {
      throw new BadRequestError(
        'Upload not found in storage. Complete the upload before marking it done.',
      );
    }

    const updated = await this.repository.update(assetId, {
      status: 'PROCESSING',
      uploadedAt: new Date(),
      sizeBytes,
    });
    return updated ?? asset;
  }

  /**
   * Current state, refreshing it from the stream bucket when still in flight.
   *
   * Polling lives here rather than in a webhook handler so readiness works
   * whether or not the pipeline notifies us. A webhook can later call
   * `refreshReadiness` directly and this stays correct.
   */
  async getStatus(
    assetId: string,
    user: IUser,
  ): Promise<IVideoAsset> {
    const asset = await this.loadPlayable(assetId, user);
    if (asset.status === 'READY' || asset.status === 'FAILED') return asset;
    return this.refreshReadiness(asset);
  }

  /** Probe the stream bucket once and persist any state change. */
  async refreshReadiness(asset: IVideoAsset): Promise<IVideoAsset> {
    const assetId = asset._id?.toString();
    if (!assetId) return asset;

    let probe;
    try {
      probe = await this.storage.probeForPlaylist({
        assetId,
        uploadObjectKey: asset.uploadObjectKey,
      });
    } catch (error) {
      // A storage hiccup must not flip a good asset to FAILED — leave the state
      // alone and let the next poll retry.
      console.warn(
        `[VideoAssetService] readiness probe failed for ${assetId}:`,
        error,
      );
      await this.repository.update(assetId, {lastPolledAt: new Date()});
      return asset;
    }

    if (probe.playlistObjectKey) {
      const updated = await this.repository.update(assetId, {
        status: 'READY',
        playlistObjectKey: probe.playlistObjectKey,
        readyAt: new Date(),
        lastPolledAt: new Date(),
        failureReason: undefined,
      });
      return updated ?? asset;
    }

    if (probe.problem) {
      const updated = await this.repository.update(assetId, {
        status: 'FAILED',
        failureReason: probe.problem,
        lastPolledAt: new Date(),
      });
      return updated ?? asset;
    }

    // Nothing yet. If the raw upload has landed, we are legitimately waiting on
    // the transcoder; otherwise the asset is still awaiting its upload.
    const updated = await this.repository.update(assetId, {
      lastPolledAt: new Date(),
    });
    return updated ?? asset;
  }

  /**
   * Issue a playback grant for a learner.
   *
   * Authorization is resolved from the asset's own course scope, so it holds
   * even before any item references the asset.
   */
  async createPlaybackGrant(
    assetId: string,
    user: IUser,
  ): Promise<PlaybackGrant> {
    const userId = requireUserId(user);
    let asset = await this.loadPlayable(assetId, user);

    if (asset.status !== 'READY') {
      asset = await this.refreshReadiness(asset);
    }
    if (asset.status !== 'READY' || !asset.playlistObjectKey) {
      throw new BadRequestError(
        `Video is not ready to play (status: ${asset.status}).`,
      );
    }

    return this.playbackUrls.createGrant({
      playlistObjectKey: asset.playlistObjectKey,
      userId,
    });
  }

  /** Teacher-facing listing for one course version. */
  async listByCourseVersion(input: {
    user: IUser;
    courseId: string;
    courseVersionId: string;
    limit?: number;
  }): Promise<IVideoAsset[]> {
    await this.assertCanManage(
      input.user,
      input.courseId,
      input.courseVersionId,
    );
    return this.repository.listByCourseVersion(
      input.courseVersionId,
      input.limit ?? 100,
    );
  }

  /**
   * Advance every in-flight asset one step. Intended for a cron sweep so an
   * asset still becomes READY even if nobody is polling it from the UI.
   */
  async sweepInFlight(limit = 25): Promise<{checked: number; ready: number}> {
    const pending = await this.repository.listInFlight(limit);
    let ready = 0;
    for (const asset of pending) {
      const updated = await this.refreshReadiness(asset);
      if (updated.status === 'READY') ready += 1;
    }
    return {checked: pending.length, ready};
  }

  // ── authorization ────────────────────────────────────────────────────────

  private async loadManageable(
    assetId: string,
    user: IUser,
  ): Promise<IVideoAsset> {
    const asset = await this.requireAsset(assetId);
    await this.assertCanManage(
      user,
      asset.courseId.toString(),
      asset.courseVersionId.toString(),
    );
    return asset;
  }

  private async loadPlayable(
    assetId: string,
    user: IUser,
  ): Promise<IVideoAsset> {
    const asset = await this.requireAsset(assetId);
    const userId = requireUserId(user);

    // The uploader always keeps access, so a teacher can verify an asset before
    // it is attached to any item.
    if (asset.createdBy.toString() === userId) return asset;
    if (isAdmin(user)) return asset;

    const enrolled = await this.hasAnyEnrollment(
      userId,
      asset.courseId.toString(),
      asset.courseVersionId.toString(),
    );
    if (!enrolled) {
      throw new ForbiddenError(
        'You do not have access to this video.',
      );
    }
    return asset;
  }

  private async requireAsset(assetId: string): Promise<IVideoAsset> {
    const asset = await this.repository.findById(assetId);
    if (!asset) throw new NotFoundError('Video asset not found.');
    return asset;
  }

  private async assertCanManage(
    user: IUser,
    courseId: string,
    courseVersionId: string,
  ): Promise<void> {
    if (isAdmin(user)) return;
    const userId = requireUserId(user);
    const enrollments = await this.enrollments.getAllEnrollments(userId);
    const canManage = enrollments.some(
      enrollment =>
        enrollment.courseId?.toString() === courseId &&
        enrollment.courseVersionId?.toString() === courseVersionId &&
        MANAGING_ROLES.has(String(enrollment.role ?? '').toUpperCase()),
    );
    if (!canManage) {
      throw new ForbiddenError(
        'You do not have permission to manage video for this course version.',
      );
    }
  }

  private async hasAnyEnrollment(
    userId: string,
    courseId: string,
    courseVersionId: string,
  ): Promise<boolean> {
    const enrollments = await this.enrollments.getAllEnrollments(userId);
    return enrollments.some(
      enrollment =>
        enrollment.courseId?.toString() === courseId &&
        enrollment.courseVersionId?.toString() === courseVersionId,
    );
  }
}

function requireUserId(user: IUser): string {
  const userId = user?._id?.toString();
  if (!userId) {
    throw new ForbiddenError('Unable to resolve authenticated user.');
  }
  return userId;
}

/**
 * `roles` on a user doc has been observed as both a scalar and an array, so
 * normalize defensively — the same posture as shared/functions/AbilityDecorator.
 */
function isAdmin(user: IUser): boolean {
  const values = Array.isArray(user?.roles) ? user.roles : [user?.roles];
  return values.some(
    role => typeof role === 'string' && role.toLowerCase() === 'admin',
  );
}
