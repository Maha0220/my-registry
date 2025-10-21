import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { createWriteStream, createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { UploadsStore } from './uploads.store';

@Injectable()
export class RegistryService {
  private blobsDir = path.join(process.cwd(), 'storage', 'blobs');
  private manifestsDir = path.join(process.cwd(), 'storage', 'manifests');

  constructor(private readonly store: UploadsStore) {}

  async startUpload(repo: string) {
    return this.store.createSession(repo);
  }

  async appendChunk(repo: string, uuid: string, req: any) {
    const uploadPath = this.store.getUploadPath(repo, uuid);
    const ws = createWriteStream(uploadPath, { flags: 'a' });
    return new Promise((resolve, reject) => {
      req.pipe(ws);
      req.on('finish', resolve);
      req.on('error', reject);
    });
  }

  async finalizeUpload(repo: string, uuid: string, digest: string) {
    const uploadPath = this.store.getUploadPath(repo, uuid);
    const blobPath = path.join(this.blobsDir, digest.replace('sha256:', ''));
    await fs.mkdir(this.blobsDir, { recursive: true });
    await fs.rename(uploadPath, blobPath);
    const computed = await this.hashFile(blobPath);
    if (computed !== digest) throw new Error('Digest mismatch');
    return computed;
  }

  async saveMonolithic(repo: string, digest: string, req: any) {
    await fs.mkdir(this.blobsDir, { recursive: true });
    const blobPath = path.join(this.blobsDir, digest.replace('sha256:', ''));
    const ws = createWriteStream(blobPath);
    await new Promise((resolve, reject) => {
      req.pipe(ws);
      req.on('end', resolve);
      req.on('error', reject);
    });
    return digest;
  }

  async checkBlob(repo: string, digest: string) {
    const blobPath = path.join(this.blobsDir, digest.replace('sha256:', ''));
    try {
      return fs.stat(blobPath);
    } catch {
      return null;
    }
  }

  async getBlob(repo: string, digest: string) {
    const blobPath = path.join(this.blobsDir, digest.replace('sha256:', ''));
    try {
      await fs.access(blobPath);
      return createReadStream(blobPath);
    } catch {
      return null;
    }
  }

  async saveManifest(repo: string, tag: string, req: any) {
    const body = await new Promise<Buffer>((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c as never));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

    const digest = 'sha256:' + createHash('sha256').update(body).digest('hex');
    const repoDir = path.join(this.manifestsDir, repo);
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, `${tag}.json`), body);
    await fs.writeFile(path.join(repoDir, `${digest}.json`), body);
    return digest;
  }

  async getManifest(repo: string, ref: string): Promise<any> {
    const repoDir = path.join(this.manifestsDir, repo);
    const candidates = [
      path.join(repoDir, `${ref}.json`),
      path.join(repoDir, `${ref.replace('sha256:', '')}.json`),
    ];
    for (const file of candidates) {
      try {
        const data = await fs.readFile(file, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        console.error(error);
      }
    }
    return null;
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk);
    return `sha256:${hash.digest('hex')}`;
  }
}
