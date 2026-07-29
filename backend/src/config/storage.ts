import { env } from '#root/utils/env.js';

export const storageConfig = {
  googleCloud: {
    projectId: env('GCLOUD_PROJECT'),
    anomalyBucketName: env('GOOGLE_ANOMALY_BUCKET') || 'vibe-anomaly-data',
    facesBucketName: env('GOOGLE_FACES_BUCKET') || 'vibe-faces-data',
    aiServerBucketName: env('GOOGLE_AI_SERVER_BUCKET') || 'vibe-aiserver-data',
  },
  encryption: {
    mediaEncryptionKey: env('MEDIA_ENCRYPTION_KEY'),
  },

  /**
   * Uploaded-video pipeline (media module). Teachers upload straight to
   * `uploadBucket`; a cloud transcoder writes an HLS ladder into
   * `streamBucket`; the backend only ever signs URLs for either.
   *
   * Bucket names and the playlist layout are deployment facts — see
   * `modules/media/services/storage/videoStoragePaths.ts` for the single place
   * the output naming convention is encoded.
   */
  video: {
    /**
     * Raw teacher uploads land here. Writing an object into this bucket is what
     * triggers the Cloud Function that starts transcoding — so the upload is
     * the pipeline's only entry point; ViBe never calls the transcoder.
     */
    uploadBucketName:
      env('GOOGLE_VIDEO_UPLOAD_BUCKET') ||
      'hls-streaming-gcp-raw-files-vibe-5b35a',
    /** Transcoded HLS variants + master playlists are written here. */
    streamBucketName:
      env('GOOGLE_VIDEO_STREAM_BUCKET') ||
      'hls-streaming-gcp-processed-files-vibe-5b35a',
    /** Lifetime of an issued upload URL. One hour covers a large upload. */
    uploadUrlTtlMinutes: Number(env('VIDEO_UPLOAD_URL_TTL_MINUTES') || '60'),
    /**
     * Lifetime of an issued playback URL. HLS re-requests segments for the whole
     * session, so this must exceed the longest expected watch or playback dies
     * mid-lesson. Six hours is deliberately generous; switching to CDN signed
     * cookies (see PlaybackUrlProvider) removes the constraint entirely.
     */
    playbackUrlTtlMinutes: Number(
      env('VIDEO_PLAYBACK_URL_TTL_MINUTES') || '360',
    ),
    /** Largest upload we will issue a URL for (bytes). Default 5 GB. */
    maxUploadBytes: Number(env('VIDEO_MAX_UPLOAD_BYTES') || `${5 * 1024 ** 3}`),
  },
};
