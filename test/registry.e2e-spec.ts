import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('Docker Registry API (e2e)', () => {
  let app: INestApplication;
  const testStorageRoot = path.join(process.cwd(), 'data-test');

  beforeAll(async () => {
    process.env.STORAGE_ROOT = testStorageRoot;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    // 테스트 데이터 정리
    try {
      await fs.rm(testStorageRoot, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('API Version Check', () => {
    it('GET /v2/ should return 200 with Docker-Distribution-API-Version header', () => {
      return request(app.getHttpServer())
        .get('/v2/')
        .expect(200)
        .expect('Docker-Distribution-API-Version', 'registry/2.0');
    });
  });

  describe('Catalog API', () => {
    it('GET /v2/_catalog should return empty repositories initially', () => {
      return request(app.getHttpServer())
        .get('/v2/_catalog')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('repositories');
          expect(Array.isArray(res.body.repositories)).toBe(true);
        });
    });

    it('GET /v2/:name/tags/list should return 404 for non-existent repo', () => {
      return request(app.getHttpServer())
        .get('/v2/nonexistent/tags/list')
        .expect(404)
        .expect((res) => {
          expect(res.body.errors[0].code).toBe('NAME_UNKNOWN');
        });
    });
  });

  describe('Blob Upload Flow', () => {
    const repoName = 'test-repo';
    let uploadUuid: string;
    const testData = Buffer.from('test blob content');
    const testDigest = 'sha256:' + crypto.createHash('sha256').update(testData).digest('hex');

    it('POST /v2/:name/blobs/uploads should start upload session', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/${repoName}/blobs/uploads`)
        .expect(202);

      expect(res.headers['docker-upload-uuid']).toBeDefined();
      expect(res.headers['location']).toContain(`/v2/${repoName}/blobs/uploads/`);
      uploadUuid = res.headers['docker-upload-uuid'];
    });

    it('PATCH /v2/:name/blobs/uploads/:uuid should append chunk', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v2/${repoName}/blobs/uploads/${uploadUuid}`)
        .set('Content-Type', 'application/octet-stream')
        .send(testData)
        .expect(202);

      expect(res.headers['range']).toBeDefined();
    });

    it('PUT /v2/:name/blobs/uploads/:uuid should complete upload', async () => {
      const res = await request(app.getHttpServer())
        .put(`/v2/${repoName}/blobs/uploads/${uploadUuid}?digest=${testDigest}`)
        .expect(201);

      expect(res.headers['docker-content-digest']).toBe(testDigest);
    });

    it('HEAD /v2/:name/blobs/:digest should confirm blob exists', async () => {
      const res = await request(app.getHttpServer())
        .head(`/v2/${repoName}/blobs/${testDigest}`)
        .expect(200);

      expect(res.headers['docker-content-digest']).toBe(testDigest);
      expect(res.headers['content-length']).toBe(testData.length.toString());
    });

    it('GET /v2/:name/blobs/:digest should return blob content', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/${repoName}/blobs/${testDigest}`)
        .expect(200);

      expect(res.body).toEqual(testData);
    });
  });

  describe('Manifest Operations', () => {
    const repoName = 'test-repo';
    const tag = 'latest';
    const testManifest = {
      schemaVersion: 2,
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      config: {
        mediaType: 'application/vnd.docker.container.image.v1+json',
        size: 1234,
        digest: 'sha256:abc123',
      },
      layers: [],
    };

    it('PUT /v2/:name/manifests/:reference should upload manifest', async () => {
      const res = await request(app.getHttpServer())
        .put(`/v2/${repoName}/manifests/${tag}`)
        .set('Content-Type', 'application/vnd.docker.distribution.manifest.v2+json')
        .send(JSON.stringify(testManifest))
        .expect(201);

      expect(res.headers['docker-content-digest']).toBeDefined();
    });

    it('GET /v2/:name/manifests/:reference should return manifest', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/${repoName}/manifests/${tag}`)
        .expect(200);

      expect(res.body.schemaVersion).toBe(2);
    });

    it('GET /v2/:name/tags/list should return tags', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/${repoName}/tags/list`)
        .expect(200);

      expect(res.body.name).toBe(repoName);
      expect(res.body.tags).toContain(tag);
    });
  });

  describe('Delete Operations', () => {
    const repoName = 'delete-test';
    const testData = Buffer.from('delete test blob');
    const testDigest = 'sha256:' + crypto.createHash('sha256').update(testData).digest('hex');

    beforeAll(async () => {
      // Upload a blob first
      const uploadRes = await request(app.getHttpServer())
        .post(`/v2/${repoName}/blobs/uploads`)
        .expect(202);

      const uuid = uploadRes.headers['docker-upload-uuid'];

      await request(app.getHttpServer())
        .patch(`/v2/${repoName}/blobs/uploads/${uuid}`)
        .send(testData)
        .expect(202);

      await request(app.getHttpServer())
        .put(`/v2/${repoName}/blobs/uploads/${uuid}?digest=${testDigest}`)
        .expect(201);
    });

    it('DELETE /v2/:name/blobs/:digest should delete blob', async () => {
      await request(app.getHttpServer())
        .delete(`/v2/${repoName}/blobs/${testDigest}`)
        .expect(202);

      // Verify blob is deleted
      await request(app.getHttpServer())
        .head(`/v2/${repoName}/blobs/${testDigest}`)
        .expect(404);
    });
  });

  describe('Health Check', () => {
    it('GET /health should return health status', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
        });
    });

    it('GET /health/live should return liveness', () => {
      return request(app.getHttpServer())
        .get('/health/live')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
        });
    });
  });
});
