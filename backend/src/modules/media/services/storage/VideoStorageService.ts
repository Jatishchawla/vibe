import {injectable} from 'inversify';
import {Storage} from '@google-cloud/storage';
import {storageConfig} from '#root/config/storage.js';
import {
  candidateStreamPrefixes,
  isMasterPlaylistBody,
  pickMasterPlaylist,
} from './videoStoragePaths.js';

/** Outcome of probing the stream bucket for an asset's transcoded output. */
export interface PlaylistProbeResult {
  /** Master playlist key, when a confirmed master was found. */
  playlistObjectKey?: string;
  /** True when objects exist under the prefix but no master playlist yet. */
  inProgress: boolean;
  /**
   * Set when playlists exist but none is a master — an unanticipated output
   * layout. Surfaced rather than swallowed so it fails loudly.
   */
  problem?: string;
}

/**
 * Thin wrapper over the two video buckets: signs upload/playback URLs and
 * observes transcoder output. Deliberately the only class in the module that
 * knows `@google-cloud/storage` exists.
 */
@injectable()
export class VideoStorageService {
  private readonly storage: Storage;
  private readonly uploadBucketName: string;
  private readonly streamBucketName: string;

  constructor() {
    this.storage = new Storage({
      projectId: storageConfig.googleCloud.projectId,
    });
    this.uploadBucketName = storageConfig.video.uploadBucketName;
    this.streamBucketName = storageConfig.video.streamBucketName;
  }

  /**
   * A V4 signed PUT URL for a raw upload.
   *
   * `contentType` is pinned into the signature: the browser's PUT must send
   * exactly this header or GCS rejects it. That is intentional — it stops an
   * issued URL being reused to upload something else.
   */
  async createUploadUrl(
    objectKey: string,
    contentType: string,
  ): Promise<{url: string; expiresAt: Date}> {
    const expiresAt = minutesFromNow(
      storageConfig.video.uploadUrlTtlMinutes,
    );
    const [url] = await this.storage
      .bucket(this.uploadBucketName)
      .file(objectKey)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: expiresAt,
        contentType,
      });
    return {url, expiresAt};
  }

  /** A V4 signed GET URL for a transcoded playlist or segment. */
  async createPlaybackUrl(
    objectKey: string,
  ): Promise<{url: string; expiresAt: Date}> {
    const expiresAt = minutesFromNow(
      storageConfig.video.playbackUrlTtlMinutes,
    );
    const [url] = await this.storage
      .bucket(this.streamBucketName)
      .file(objectKey)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: expiresAt,
      });
    return {url, expiresAt};
  }

  /** Whether the raw upload actually landed, and how big it is. */
  async statUpload(
    objectKey: string,
  ): Promise<{exists: boolean; sizeBytes?: number}> {
    const file = this.storage.bucket(this.uploadBucketName).file(objectKey);
    const [exists] = await file.exists();
    if (!exists) return {exists: false};
    const [metadata] = await file.getMetadata();
    return {exists: true, sizeBytes: Number(metadata.size ?? 0) || undefined};
  }

  /**
   * Look for a finished HLS ladder for this asset.
   *
   * Searches each candidate output prefix rather than assuming one layout, then
   * *confirms* the ranked candidate really is a multivariant playlist by reading
   * it. A confident guess that turns out to be a single rendition would silently
   * pin every learner to one bitrate, so it is verified rather than trusted.
   */
  async probeForPlaylist(input: {
    assetId: string;
    uploadObjectKey?: string;
  }): Promise<PlaylistProbeResult> {
    const bucket = this.storage.bucket(this.streamBucketName);
    const prefixes = candidateStreamPrefixes(
      input.assetId,
      input.uploadObjectKey,
    );

    let sawAnyObject = false;

    for (const prefix of prefixes) {
      const [files] = await bucket.getFiles({prefix});
      if (files.length === 0) continue;
      sawAnyObject = true;

      const candidate = pickMasterPlaylist(files.map(file => file.name));
      if (!candidate) continue;

      const [body] = await bucket.file(candidate).download();
      if (!isMasterPlaylistBody(body.toString('utf8'))) {
        return {
          inProgress: false,
          problem:
            `Found playlist "${candidate}" but it is not a multivariant master ` +
            '(no #EXT-X-STREAM-INF). The transcoder output layout differs from ' +
            'what videoStoragePaths.pickMasterPlaylist expects.',
        };
      }

      return {playlistObjectKey: candidate, inProgress: false};
    }

    // Objects exist but no playlist yet => transcoding is genuinely running.
    // Nothing at all => still waiting on the upload or the trigger.
    return {inProgress: sawAnyObject};
  }
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}
