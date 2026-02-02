import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createReadStream, createWriteStream, ReadStream, WriteStream } from 'fs';
import * as crypto from 'crypto';

// 레지스트리 메타데이터 (임시 메모리 저장소)
const repositoryState: Record<
  string,
  { blobs: Record<string, string>; manifest: any }
> = {};

export interface BlobInfo {
  exists: boolean;
  size?: number;
  path?: string;
}

export interface ManifestInfo {
  exists: boolean;
  manifest?: any;
  mediaType?: string;
}

@Injectable()
export class RegistryService implements OnModuleInit {
  private readonly logger = new Logger(RegistryService.name);
  private storageRoot: string;

  constructor(private readonly configService: ConfigService) {
    const configuredPath = this.configService.get<string>('STORAGE_ROOT', './data');
    // 상대 경로인 경우 process.cwd() 기준으로 절대 경로 변환
    this.storageRoot = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(process.cwd(), configuredPath);
  }

  async onModuleInit() {
    await this.ensureDir(this.storageRoot);
    this.logger.log(`Storage root initialized: ${this.storageRoot}`);
  }

  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  async getRepoDir(name: string): Promise<string> {
    const repoPath = path.join(this.storageRoot, name);
    await this.ensureDir(repoPath);
    return repoPath;
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }


  // ------------------------------------
  // --- Blob 관련 메서드 ---
  // ------------------------------------

  async getBlobPath(name: string, digest: string): Promise<string> {
    const digestHash = digest.split(':')[1];
    return path.join(await this.getRepoDir(name), digestHash);
  }

  async checkBlobExists(name: string, digest: string): Promise<BlobInfo> {
    const blobPath = await this.getBlobPath(name, digest);

    if (await this.fileExists(blobPath)) {
      const stats = await fs.stat(blobPath);
      return { exists: true, size: stats.size, path: blobPath };
    }
    return { exists: false };
  }

  createBlobReadStream(blobPath: string): ReadStream {
    return createReadStream(blobPath);
  }

  async createUploadSession(name: string): Promise<{ uuid: string; tempFilePath: string }> {
    const uuid = crypto.randomUUID();
    const tempFilePath = path.join(await this.getRepoDir(name), `${uuid}.tmp`);

    // 임시 파일 생성 (빈 파일)
    await fs.writeFile(tempFilePath, '');

    return { uuid, tempFilePath };
  }

  async getTempFilePath(name: string, uuid: string): Promise<string> {
    return path.join(await this.getRepoDir(name), `${uuid}.tmp`);
  }

  createAppendStream(tempFilePath: string): WriteStream {
    return createWriteStream(tempFilePath, { flags: 'a' });
  }

  async getFileSize(filePath: string): Promise<number> {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  async completeBlobUpload(
    name: string,
    uuid: string,
    digest: string,
  ): Promise<{ success: boolean; error?: string }> {
    const repoDir = await this.getRepoDir(name);
    const tempFilePath = path.join(repoDir, `${uuid}.tmp`);

    // Monolithic Upload시 PATCH 없이 바로 PUT으로 완료되지만, 사용하는 도커 클라이언트에서 사용하지 않아 구현하지 않음
    // 추가적으로 해당 PUT 요청으로 오는 optional body 데이터 처리도 필요하지만 테스트시에는 사용하지 않아 구현하지 않음

    // 임시 파일을 최종 파일로 이름변경
    const digestHash = digest.split(':')[1];
    const finalBlobPath = path.join(repoDir, digestHash);

    try {
      if (await this.fileExists(tempFilePath)) {
        await fs.rename(tempFilePath, finalBlobPath); // 임시 파일을 최종 경로로 변경
      }
      // repositoryState[name] = repositoryState[name] || {
      //   blobs: {},
      //   manifest: null,
      // };
      // repositoryState[name].blobs[digest] = finalBlobPath;
      return { success: true };
    } catch (error) {
      this.logger.error('File operation error:', error);
      return { success: false, error: 'File save error' };
    }
  }


  // ------------------------------------
  // --- Manifest 관련 메서드 ---
  // ------------------------------------

  async getManifest(name: string, reference: string): Promise<ManifestInfo> {
    // 메모리 캐시 확인
    const cachedManifest = repositoryState[name]?.manifest;
    if (cachedManifest) {
      return {
        exists: true,
        manifest: cachedManifest,
        mediaType:
          cachedManifest.mediaType ||
          'application/vnd.docker.distribution.manifest.v2+json',
      };
    }

    // 파일에서 로드
    const filePath = path.join(
      await this.getRepoDir(name),
      `manifests-${reference}.json`,
    );

    if (await this.fileExists(filePath)) {
      const content = await fs.readFile(filePath, 'utf-8');
      const manifest = JSON.parse(content);
      repositoryState[name] = repositoryState[name] || {
        blobs: {},
        manifest: null,
      };
      repositoryState[name].manifest = manifest;
      return {
        exists: true,
        manifest,
        mediaType:
          manifest.mediaType ||
          'application/vnd.docker.distribution.manifest.v2+json',
      };
    }

    return { exists: false };
  }

  async getManifestFilePath(name: string, reference: string): Promise<string> {
    return path.join(await this.getRepoDir(name), `manifests-${reference}.json`);
  }

  createManifestWriteStream(filePath: string): WriteStream {
    return createWriteStream(filePath, { flags: 'w' });
  }

  async saveManifestToCache(name: string, filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, 'utf-8');
    const manifest = JSON.parse(content);
    repositoryState[name] = repositoryState[name] || {
      blobs: {},
      manifest: null,
    };
    repositoryState[name].manifest = manifest;

    //실제로는 manifest에 대한 digest로 digest를 관리해야함 (이미지 삭제등의 로직에서 필요)
    const manifestDigest =
      'sha256:' +
      crypto
        .createHash('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex');

    return manifestDigest;
  }

  // ------------------------------------
  // --- 삭제 관련 메서드 ---
  // ------------------------------------

  async deleteBlob(
    name: string,
    digest: string,
  ): Promise<{ success: boolean; error?: string }> {
    const blobPath = await this.getBlobPath(name, digest);

    try {
      if (await this.fileExists(blobPath)) {
        await fs.unlink(blobPath);
        // 메모리 캐시에서도 제거
        if (repositoryState[name]?.blobs[digest]) {
          delete repositoryState[name].blobs[digest];
        }
        return { success: true };
      }
      return { success: false, error: 'Blob not found' };
    } catch (error) {
      this.logger.error('Blob delete error:', error);
      return { success: false, error: 'Failed to delete blob' };
    }
  }

  async deleteManifest(
    name: string,
    reference: string,
  ): Promise<{ success: boolean; error?: string }> {
    const filePath = await this.getManifestFilePath(name, reference);

    try {
      if (await this.fileExists(filePath)) {
        await fs.unlink(filePath);
        // 메모리 캐시에서도 제거
        if (repositoryState[name]) {
          repositoryState[name].manifest = null;
        }
        return { success: true };
      }
      return { success: false, error: 'Manifest not found' };
    } catch (error) {
      this.logger.error('Manifest delete error:', error);
      return { success: false, error: 'Failed to delete manifest' };
    }
  }

  // ------------------------------------
  // --- Garbage Collection ---
  // ------------------------------------

  /**
   * Garbage Collection: 어떤 manifest에서도 참조되지 않는 blob들을 삭제
   * 주의: 실제 운영 환경에서는 더 정교한 로직 필요 (락, 동시성 처리 등)
   */
  async runGarbageCollection(name: string): Promise<{ deleted: string[]; errors: string[] }> {
    const repoDir = await this.getRepoDir(name);
    const deleted: string[] = [];
    const errors: string[] = [];

    try {
      // 1. 해당 repository의 모든 manifest 파일 수집
      const files = await fs.readdir(repoDir);
      const manifestFiles = files.filter((f) => f.startsWith('manifests-') && f.endsWith('.json'));

      // 2. 모든 manifest에서 참조되는 blob digest 수집
      const referencedDigests = new Set<string>();

      for (const manifestFile of manifestFiles) {
        try {
          const content = await fs.readFile(path.join(repoDir, manifestFile), 'utf-8');
          const manifest = JSON.parse(content);

          // config blob 추가
          if (manifest.config?.digest) {
            referencedDigests.add(manifest.config.digest.split(':')[1]);
          }

          // layer blob들 추가
          if (manifest.layers) {
            for (const layer of manifest.layers) {
              if (layer.digest) {
                referencedDigests.add(layer.digest.split(':')[1]);
              }
            }
          }
        } catch (err) {
          errors.push(`Failed to parse manifest: ${manifestFile}`);
        }
      }

      // 3. 참조되지 않는 blob 파일 삭제
      const blobFiles = files.filter(
        (f) =>
          !f.startsWith('manifests-') &&
          !f.endsWith('.tmp') &&
          !f.endsWith('.json'),
      );

      for (const blobFile of blobFiles) {
        if (!referencedDigests.has(blobFile)) {
          try {
            await fs.unlink(path.join(repoDir, blobFile));
            deleted.push(blobFile);
            this.logger.debug(`GC: Deleted unreferenced blob ${blobFile}`);
          } catch (err) {
            errors.push(`Failed to delete blob: ${blobFile}`);
          }
        }
      }

      // 4. 임시 파일(.tmp) 정리 - 오래된 것만 (1시간 이상)
      const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
      const oneHourAgo = Date.now() - 60 * 60 * 1000;

      for (const tmpFile of tmpFiles) {
        try {
          const stats = await fs.stat(path.join(repoDir, tmpFile));
          if (stats.mtimeMs < oneHourAgo) {
            await fs.unlink(path.join(repoDir, tmpFile));
            deleted.push(tmpFile);
            this.logger.debug(`GC: Deleted stale temp file ${tmpFile}`);
          }
        } catch (err) {
          errors.push(`Failed to delete temp file: ${tmpFile}`);
        }
      }
    } catch (error) {
      errors.push(`GC failed for repository ${name}: ${error}`);
    }

    return { deleted, errors };
  }

  /**
   * 모든 repository에 대해 GC 실행
   */
  async runGlobalGarbageCollection(): Promise<{
    results: Record<string, { deleted: string[]; errors: string[] }>;
  }> {
    const results: Record<string, { deleted: string[]; errors: string[] }> = {};

    try {
      const repos = await fs.readdir(this.storageRoot);

      for (const repo of repos) {
        const repoPath = path.join(this.storageRoot, repo);
        const stats = await fs.stat(repoPath);

        if (stats.isDirectory()) {
          results[repo] = await this.runGarbageCollection(repo);
        }
      }
    } catch (error) {
      this.logger.error('Global GC error:', error);
    }

    return { results };
  }

  // ------------------------------------
  // --- Catalog 관련 메서드 ---
  // ------------------------------------

  /**
   * 전체 repository 목록 조회
   */
  async listRepositories(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.storageRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      this.logger.error('Failed to list repositories:', error);
      return [];
    }
  }

  /**
   * 특정 repository의 태그 목록 조회
   */
  async listTags(name: string): Promise<{ exists: boolean; tags: string[] }> {
    const repoDir = path.join(this.storageRoot, name);

    try {
      if (!(await this.fileExists(repoDir))) {
        return { exists: false, tags: [] };
      }

      const files = await fs.readdir(repoDir);
      const tags = files
        .filter((f) => f.startsWith('manifests-') && f.endsWith('.json'))
        .map((f) => f.replace('manifests-', '').replace('.json', ''));

      return { exists: true, tags };
    } catch (error) {
      this.logger.error(`Failed to list tags for ${name}:`, error);
      return { exists: false, tags: [] };
    }
  }
}
