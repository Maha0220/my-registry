import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, DiskHealthIndicator } from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { StorageHealthIndicator } from './storage.health';

@Controller('health')
@ApiTags('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private disk: DiskHealthIndicator,
    private storage: StorageHealthIndicator,
  ) { }

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: '전체 헬스체크', description: '스토리지 및 디스크 상태 확인' })
  @ApiResponse({ status: 200, description: '정상' })
  @ApiResponse({ status: 503, description: '비정상' })
  check() {
    return this.health.check([
      () => this.storage.isHealthy('storage'),
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe', description: '서버 생존 여부 확인' })
  @ApiResponse({ status: 200, description: '서버 정상 동작 중' })
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe', description: '서버 준비 상태 확인' })
  @ApiResponse({ status: 200, description: '요청 처리 가능' })
  @ApiResponse({ status: 503, description: '요청 처리 불가' })
  readiness() {
    return this.health.check([() => this.storage.isHealthy('storage')]);
  }
}
