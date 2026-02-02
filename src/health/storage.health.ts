import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class StorageHealthIndicator {
  private storageRoot: string;

  constructor(private readonly configService: ConfigService) {
    const configuredPath = this.configService.get<string>('STORAGE_ROOT', './data');
    this.storageRoot = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(process.cwd(), configuredPath);
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // 스토리지 디렉토리 접근 가능 여부 확인
      await fs.access(this.storageRoot);

      // 쓰기 테스트
      const testFile = path.join(this.storageRoot, '.health-check');
      await fs.writeFile(testFile, Date.now().toString());
      await fs.unlink(testFile);

      return { [key]: { status: 'up', path: this.storageRoot } };
    } catch (error) {
      return { [key]: { status: 'down', error: (error as Error).message } };
    }
  }
}
