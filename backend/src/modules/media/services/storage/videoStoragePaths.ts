import path from 'path';

/**
 * The ONE place the bucket layout is encoded.
 *
 * The transcoding pipeline is owned outside ViBe, and its output naming
 * convention was not documented when this was written. Rather than block on
 * that answer, readiness is resolved by *listing* the asset's stream prefix and
 * picking the master playlist out of whatever is there — which works for any
 * convention. If the layout is later confirmed, collapse `pickMasterPlaylist`
 * to a single deterministic path; nothing outside this file changes.
 */

/** Extensions we accept as a source upload. */
const ALLOWED_SOURCE_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.avi',
  '.m4v',
]);

/**
 * Object key for a raw upload. Keyed by assetId (not filename) so two teachers
 * uploading `lecture.mp4` cannot collide, and so the key is guessable only by
 * someone who already knows the assetId.
 */
export function buildUploadObjectKey(
  assetId: string,
  originalFileName: string,
): string {
  const ext = normalizeExtension(originalFileName);
  return `uploads/${assetId}/source${ext}`;
}

/**
 * Prefixes to search for this asset's transcoded output, most likely first.
 *
 * Transcoding is kicked off by a Cloud Function watching the raw bucket, so the
 * output path is derived from the *input object path* by code we don't own. It
 * may mirror the input path, or flatten to the asset id, or nest under the input
 * basename — all three are common. GCS listing needs a literal prefix (there is
 * no substring search), so rather than guess once we probe an ordered set.
 *
 * Every candidate contains the assetId, so a probe can never stray into another
 * asset's output.
 */
export function candidateStreamPrefixes(
  assetId: string,
  uploadObjectKey?: string,
): string[] {
  const candidates = [
    // The transcoder mirrored the input path verbatim.
    `uploads/${assetId}/`,
    // Output was flattened to just the asset id.
    `${assetId}/`,
  ];

  // Nested under the input file's basename, e.g. uploads/<id>/source/…
  if (uploadObjectKey) {
    const withoutExtension = uploadObjectKey.replace(/\.[^./]+$/, '');
    candidates.push(`${withoutExtension}/`);
  }

  return [...new Set(candidates)];
}

/** Lowercased extension, validated against the accepted source list. */
export function normalizeExtension(originalFileName: string): string {
  const ext = path.extname(originalFileName || '').toLowerCase();
  if (!ALLOWED_SOURCE_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported video file type "${ext || '(none)'}". Allowed: ${[
        ...ALLOWED_SOURCE_EXTENSIONS,
      ].join(', ')}`,
    );
  }
  return ext;
}

export function isAllowedSourceFileName(originalFileName: string): boolean {
  return ALLOWED_SOURCE_EXTENSIONS.has(
    path.extname(originalFileName || '').toLowerCase(),
  );
}

/** Names a master playlist conventionally uses, most likely first. */
const MASTER_NAME_PREFERENCE = [
  'master',
  'manifest',
  'index',
  'playlist',
  'stream',
];

/**
 * Choose the master playlist from every `.m3u8` found under an asset's prefix.
 *
 * An HLS ladder contains one master plus one variant playlist per rendition, and
 * picking a variant would silently pin every learner to a single bitrate — so
 * this is ranked, not "first match":
 *
 *   1. shallowest path wins (masters sit at the root, variants in subdirs)
 *   2. then a conventional master name (master/manifest/index/…)
 *   3. then shortest key, as a stable tiebreak
 *
 * Returns null when the prefix holds no playlist yet — the normal state while
 * transcoding is still running.
 */
export function pickMasterPlaylist(objectKeys: string[]): string | null {
  const playlists = objectKeys.filter(key => key.toLowerCase().endsWith('.m3u8'));
  if (playlists.length === 0) return null;
  if (playlists.length === 1) return playlists[0];

  const ranked = [...playlists].sort((a, b) => {
    const depthDelta = depthOf(a) - depthOf(b);
    if (depthDelta !== 0) return depthDelta;

    const nameDelta = masterNameRank(a) - masterNameRank(b);
    if (nameDelta !== 0) return nameDelta;

    return a.length - b.length;
  });

  return ranked[0];
}

/**
 * True when the playlist body is a master (an HLS multivariant playlist).
 * Used to confirm the ranked guess before an asset is marked READY, so a
 * layout we did not anticipate fails loudly instead of streaming one rendition.
 */
export function isMasterPlaylistBody(body: string): boolean {
  return body.includes('#EXT-X-STREAM-INF');
}

function depthOf(objectKey: string): number {
  return objectKey.split('/').length;
}

function masterNameRank(objectKey: string): number {
  const base = path.basename(objectKey, '.m3u8').toLowerCase();
  const index = MASTER_NAME_PREFERENCE.indexOf(base);
  return index === -1 ? MASTER_NAME_PREFERENCE.length : index;
}
