import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class UploadsStore {
  private uploadsDir = path.join(process.cwd(), 'storage', 'uploads');

  async createSession(repo: string) {
    const uuid = randomUUID();
    const dir = path.join(this.uploadsDir, repo);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, uuid), '');
    return uuid;
  }

  getUploadPath(repo: string, uuid: string) {
    return path.join(this.uploadsDir, repo, uuid);
  }
}
