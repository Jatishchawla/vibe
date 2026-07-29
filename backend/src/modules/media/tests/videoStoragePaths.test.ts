import {describe, expect, it} from 'vitest';
import {
  buildUploadObjectKey,
  isAllowedSourceFileName,
  isMasterPlaylistBody,
  pickMasterPlaylist,
  streamPrefixFor,
} from '../services/storage/videoStoragePaths.js';

/**
 * These cover the one piece of real branching in the media module: deciding
 * which object in a transcoder's output is the master playlist.
 *
 * It matters because picking a *variant* by mistake does not fail loudly — it
 * silently pins every learner to one bitrate. The transcoding pipeline is owned
 * outside ViBe and its layout was undocumented when this was written, so these
 * tests are also the check that a newly-confirmed layout still resolves.
 */
describe('pickMasterPlaylist', () => {
  it('returns null when the prefix is empty', () => {
    expect(pickMasterPlaylist([])).toBeNull();
  });

  it('returns null when transcoding has produced no playlist yet', () => {
    expect(
      pickMasterPlaylist(['asset1/source.mp4', 'asset1/thumb.jpg']),
    ).toBeNull();
  });

  it('returns the only playlist when there is exactly one', () => {
    expect(pickMasterPlaylist(['asset1/manifest.m3u8'])).toBe(
      'asset1/manifest.m3u8',
    );
  });

  it('prefers a root-level master over per-rendition variants in subdirs', () => {
    const keys = [
      'asset1/720p/index.m3u8',
      'asset1/1080p/index.m3u8',
      'asset1/master.m3u8',
      'asset1/480p/index.m3u8',
    ];
    expect(pickMasterPlaylist(keys)).toBe('asset1/master.m3u8');
  });

  it('prefers a conventional master name among equal-depth playlists', () => {
    const keys = [
      'asset1/720p.m3u8',
      'asset1/manifest.m3u8',
      'asset1/1080p.m3u8',
    ];
    expect(pickMasterPlaylist(keys)).toBe('asset1/manifest.m3u8');
  });

  it('falls back to the shortest key when no name is conventional', () => {
    const keys = ['asset1/video-1080p-high.m3u8', 'asset1/video-720p.m3u8'];
    expect(pickMasterPlaylist(keys)).toBe('asset1/video-720p.m3u8');
  });

  it('ignores non-playlist objects entirely', () => {
    const keys = [
      'asset1/master.m3u8',
      'asset1/seg-00001.ts',
      'asset1/poster.png',
    ];
    expect(pickMasterPlaylist(keys)).toBe('asset1/master.m3u8');
  });

  it('handles an hls/ subdirectory layout', () => {
    const keys = ['asset1/hls/master.m3u8', 'asset1/hls/720p/index.m3u8'];
    expect(pickMasterPlaylist(keys)).toBe('asset1/hls/master.m3u8');
  });
});

describe('isMasterPlaylistBody', () => {
  it('recognizes a multivariant playlist', () => {
    const body = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
      '480p/index.m3u8',
    ].join('\n');
    expect(isMasterPlaylistBody(body)).toBe(true);
  });

  it('rejects a media (variant) playlist', () => {
    const body = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6.0,',
      'seg-00001.ts',
    ].join('\n');
    expect(isMasterPlaylistBody(body)).toBe(false);
  });
});

describe('buildUploadObjectKey', () => {
  it('keys the object by assetId so filenames cannot collide', () => {
    expect(buildUploadObjectKey('abc123', 'lecture 01.mp4')).toBe(
      'uploads/abc123/source.mp4',
    );
  });

  it('normalizes extension casing', () => {
    expect(buildUploadObjectKey('abc123', 'Lecture.MOV')).toBe(
      'uploads/abc123/source.mov',
    );
  });

  it('rejects a non-video extension', () => {
    expect(() => buildUploadObjectKey('abc123', 'notes.txt')).toThrow(
      /Unsupported video file type/,
    );
  });

  it('rejects a file with no extension', () => {
    expect(() => buildUploadObjectKey('abc123', 'lecture')).toThrow(
      /Unsupported video file type/,
    );
  });
});

describe('isAllowedSourceFileName', () => {
  it.each(['a.mp4', 'a.mov', 'a.mkv', 'a.webm', 'a.avi', 'a.m4v'])(
    'accepts %s',
    name => {
      expect(isAllowedSourceFileName(name)).toBe(true);
    },
  );

  it.each(['a.txt', 'a.pdf', 'a.mp3', 'a', ''])('rejects %s', name => {
    expect(isAllowedSourceFileName(name)).toBe(false);
  });
});

describe('streamPrefixFor', () => {
  it('scopes the listing to one asset', () => {
    expect(streamPrefixFor('abc123')).toBe('abc123/');
  });
});
