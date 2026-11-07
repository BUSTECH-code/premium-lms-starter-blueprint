import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import { LearningError, type MediaAssetRow } from '@lms/db';

/**
 * Content-provider seam (docs/architecture/system-architecture.md).
 *
 * Phase 3 ships ONLY the approved `local_fixture` provider: clearly marked
 * development media stored outside the web root, delivered by the backend
 * after entitlement + lesson-unlock checks. Private Google Drive is the
 * confirmed production repository, but no credentials or private file IDs are
 * available in this environment, so no Drive adapter or fake integration is
 * implemented here. A future `GoogleDriveMediaProvider` implements this same
 * interface without changing learning/business logic.
 */

export interface MediaRange {
  /** Inclusive byte offsets. */
  start: number;
  end: number;
}

export interface MediaStream {
  stream: Readable;
  sizeBytes: number;
  contentLength: number;
  mimeType: string;
  fileName: string;
}

export interface MediaProvider {
  open(asset: MediaAssetRow, range?: MediaRange): Promise<MediaStream>;
}

export function defaultFixtureDir(): string {
  // Works from src/media and from compiled dist/media.
  return fileURLToPath(new URL('../../assets/fixtures', import.meta.url));
}

const SAFE_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class LocalFixtureMediaProvider implements MediaProvider {
  constructor(private readonly fixtureDir: string = defaultFixtureDir()) {}

  async open(asset: MediaAssetRow, range?: MediaRange): Promise<MediaStream> {
    if (asset.provider !== 'local_fixture') {
      throw new LearningError(
        'media_provider_unavailable',
        'No approved media provider is configured for this asset.',
      );
    }
    const reference = asset.provider_reference;
    if (!SAFE_BASENAME.test(reference) || path.basename(reference) !== reference) {
      throw new LearningError('media_provider_unavailable', 'Invalid private media reference.');
    }
    const fullPath = path.join(this.fixtureDir, reference);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      throw new LearningError('media_provider_unavailable', 'Learning resource is temporarily unavailable.');
    }

    const expectedSize = Number(asset.file_size_bytes);
    if (stat.size !== expectedSize) {
      throw new LearningError(
        'media_provider_unavailable',
        'Learning resource is incomplete.',
      );
    }
    // Integrity verification (development fixtures are small; a managed
    // provider would verify its own checksum out of band).
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const verificationStream = createReadStream(fullPath);
      verificationStream.on('data', (chunk: Buffer | string) => hash.update(chunk));
      verificationStream.on('error', reject);
      verificationStream.on('end', () => resolve());
    });
    if (hash.digest('hex') !== asset.checksum_sha256) {
      throw new LearningError(
        'media_provider_unavailable',
        'Learning resource failed integrity verification.',
      );
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, stat.size - 1);
    if (start > end || end >= stat.size || start < 0) {
      throw new LearningError('media_provider_unavailable', 'Invalid media range.');
    }
    const stream = createReadStream(fullPath, range ? { start, end } : undefined);
    return {
      stream,
      sizeBytes: stat.size,
      contentLength: end - start + 1,
      mimeType: asset.mime_type,
      fileName: asset.file_name,
    };
  }
}

export function createMediaProvider(): MediaProvider {
  return new LocalFixtureMediaProvider();
}
