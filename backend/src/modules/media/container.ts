import {ContainerModule} from 'inversify';
import {MEDIA_TYPES} from './types.js';
import {VideoAssetRepository} from './repositories/providers/mongodb/VideoAssetRepository.js';
import {VideoStorageService} from './services/storage/VideoStorageService.js';
import {SignedUrlPlaybackProvider} from './services/storage/PlaybackUrlProvider.js';
import {VideoAssetService} from './services/VideoAssetService.js';
import {VideoAssetController} from './controllers/VideoAssetController.js';

export const mediaContainerModule = new ContainerModule(options => {
  // Repository
  options.bind(VideoAssetRepository).toSelf().inSingletonScope();
  options.bind(MEDIA_TYPES.VideoAssetRepo).to(VideoAssetRepository);

  // Cloud storage boundary
  options.bind(VideoStorageService).toSelf().inSingletonScope();
  options.bind(MEDIA_TYPES.VideoStorageService).to(VideoStorageService);

  /**
   * Playback authorization strategy.
   *
   * Per-object signed URLs today. To move to Cloud CDN signed cookies — the
   * better fit for HLS, since a player re-requests segments for the whole
   * session — implement CdnCookiePlaybackProvider and rebind this one line.
   * Nothing else in the module changes.
   */
  options.bind(SignedUrlPlaybackProvider).toSelf().inSingletonScope();
  options.bind(MEDIA_TYPES.PlaybackUrlProvider).to(SignedUrlPlaybackProvider);

  // Service
  options.bind(VideoAssetService).toSelf().inSingletonScope();
  options.bind(MEDIA_TYPES.VideoAssetService).to(VideoAssetService);

  // Controller
  options.bind(VideoAssetController).toSelf().inSingletonScope();
});
