import { Injectable, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createReadStream, createWriteStream, ReadStream, WriteStream } from 'fs';
import * as crypto from 'crypto';

// 저장소 기본 경로 설정 (프로젝트 루트의 'data' 폴더)
const STORAGE_ROOT = path.join(process.cwd(), 'data');

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
  async onModuleInit() {
    await this.ensureDir(STORAGE_ROOT);
  }

  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  async getRepoDir(name: string): Promise<string> {
    const repoPath = path.join(STORAGE_ROOT, name);
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
      console.error('File operation error:', error);
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
}
