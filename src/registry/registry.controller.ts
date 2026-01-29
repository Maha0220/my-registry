import {
  Controller,
  Get,
  Post,
  Put,
  Head,
  Param,
  Req,
  Res,
  Query,
  HttpStatus,
  Patch,
  OnModuleInit,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Response, Request } from 'express';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import * as crypto from 'crypto';

// 저장소 기본 경로 설정 (프로젝트 루트의 'data' 폴더)
const STORAGE_ROOT = path.join(process.cwd(), 'data');

// 레지스트리 메타데이터 (임시 메모리 저장소)
const repositoryState: Record<
  string,
  { blobs: Record<string, string>; manifest: any }
> = {};

@Controller('v2')
export class RegistryController implements OnModuleInit {
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

  private async getRepoDir(name: string): Promise<string> {
    const repoPath = path.join(STORAGE_ROOT, name);
    await this.ensureDir(repoPath);
    return repoPath;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // --- 1. 기본 API 확인: GET /v2/ ---
  @Get('/')
  checkApiVersion(@Res() res: Response) {
    console.log('1. API Version Check: /v2/');
    res.set('Docker-Distribution-API-Version', 'registry/2.0');
    return res.status(HttpStatus.OK).send({});
  }


  // 2. 인증처리 (임시로 인증 없이 허용)

  // ------------------------------------
  // --- 3. Blob (레이어) 처리 ---
  // ------------------------------------

  // 3.1. Blob 존재 여부 확인 (HEAD) 및 다운로드 (GET)
  @Head(':name/blobs/:digest')
  async checkBlob(
    @Param('name') name: string,
    @Param('digest') digest: string,
    @Res() res: Response,
  ) {
    console.log(
      `3.1. Blob ${res.req.method} Check: ${name} with digest ${digest}`,
    );

    const digestHash = digest.split(':')[1];
    const blobPath = path.join(await this.getRepoDir(name), digestHash);

    if (await this.fileExists(blobPath)) {
      const stats = await fs.stat(blobPath);
      res.set('Content-Length', stats.size.toString());
      res.set('Docker-Content-Digest', digest);
      return res.status(HttpStatus.OK).end();
    } else {
      return res.status(HttpStatus.NOT_FOUND).json({
        errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob unknown to registry' }],
      });
    }
  }

  @Get(':name/blobs/:digest')
  async getBlob(
    @Param('name') name: string,
    @Param('digest') digest: string,
    @Res() res: Response,
  ) {
    console.log(
      `3.1. Blob ${res.req.method} Check: ${name} with digest ${digest}`,
    );

    const digestHash = digest.split(':')[1];
    const blobPath = path.join(await this.getRepoDir(name), digestHash);

    if (await this.fileExists(blobPath)) {
      const stats = await fs.stat(blobPath);
      res.set('Content-Length', stats.size.toString());
      res.set('Docker-Content-Digest', digest);

      const fileStream = createReadStream(blobPath);
      return fileStream.pipe(res.status(HttpStatus.OK));
    } else {
      return res.status(HttpStatus.NOT_FOUND).json({
        errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob unknown to registry' }],
      });
    }
  }

  // 3.2. Blob 업로드 세션 시작 (POST)
  @Post('/:name/blobs/uploads')
  async startBlobUpload(@Param('name') name: string, @Res() res: Response) {
    const session_uuid = crypto.randomUUID();
    const tempFilePath = path.join(
      await this.getRepoDir(name),
      `${session_uuid}.tmp`,
    );

    // 임시 파일 생성 (빈 파일)
    await fs.writeFile(tempFilePath, '');

    console.log(
      `3.2. Blob Upload Session Start for ${name}: UUID ${session_uuid}`,
    );

    res.set('Location', `/v2/${name}/blobs/uploads/${session_uuid}`);
    res.set('Range', '0-0');
    res.set('Docker-Upload-UUID', session_uuid);
    return res.status(HttpStatus.ACCEPTED).end();
  }


  // 3.4. Blob 청크 추가 (PATCH)
  @Patch('/:name/blobs/uploads/:uuid')
  async appendChunk(
    @Param('name') name: string,
    @Param('uuid') uuid: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    const repoDir = await this.getRepoDir(name);
    const tempFilePath = path.join(repoDir, `${uuid}.tmp`);

    console.log(`3.4. Blob PATCH: Appending chunk to ${uuid}.tmp`);

    // 1. 임시 파일 존재 확인 (업로드 세션의 유효성 검사)
    if (!(await this.fileExists(tempFilePath))) {
      return res.status(HttpStatus.NOT_FOUND).json({
        errors: [
          { code: 'BLOB_UNKNOWN', message: 'Upload session not found' },
        ],
      });
    }

    // 2. 요청 본문의 데이터를 임시 파일에 스트림으로 추가(Append)
    const fileStream = createWriteStream(tempFilePath, { flags: 'a' });

    // 데이터 전송 완료 후 처리
    fileStream.on('finish', async () => {
      // 3. 현재 파일 크기를 확인하여 Range 헤더 반환
      const stats = await fs.stat(tempFilePath);
      const currentSize = stats.size;

      // Docker CLI는 Location 및 Range 헤더를 사용하여 다음 청크를 전송할 위치를 파악합니다.
      res.set('Location', `/v2/${name}/blobs/uploads/${uuid}`);
      res.set('Range', `0-${currentSize - 1}`); // 현재 저장된 바이트 범위 (0부터 크기-1까지)
      res.set('Content-Length', '0');
      res.set('Docker-Upload-UUID', uuid);

      console.log(`Chunk appended. Current size: ${currentSize}`);
      return res.status(HttpStatus.ACCEPTED).end(); // 202 Accepted로 응답
    });

    fileStream.on('error', (err) => {
      console.error('File stream error during PATCH:', err);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('File write error');
    });

    req.pipe(fileStream);
  }

  // 3.3. Blob 업로드 완료 (PUT)
  @Put('/:name/blobs/uploads/:uuid')
  async completeBlobUpload(
    @Param('name') name: string,
    @Param('uuid') uuid: string,
    @Query('digest') digest: string,
    @Res() res: Response,
  ) {
    if (!digest) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .send('Digest required for completion.');
    }

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
    } catch (error) {
      console.error('File operation error:', error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('File save error');
    }

    // repositoryState[name] = repositoryState[name] || {
    //   blobs: {},
    //   manifest: null,
    // };
    // repositoryState[name].blobs[digest] = finalBlobPath;

    console.log(`3.3. Blob Upload Complete for ${name}, Digest ${digest}`);

    res.set('Content-Length', '0');
    res.set('Docker-Content-Digest', digest);
    return res.status(HttpStatus.CREATED).end();
  }


  // ------------------------------------
  // --- 4. 매니페스트 (Manifest) 처리 ---
  // ------------------------------------

  // 4.1. Manifest 다운로드 (GET)
  @Get('/:name/manifests/:reference')
  async getManifest(
    @Param('name') name: string,
    @Param('reference') reference: string,
    @Res() res: Response,
  ) {
    console.log(`4.1. Manifest GET: ${name} with reference ${reference}`);
    const manifest = repositoryState[name]?.manifest;

    if (manifest) {
      res.set(
        'Content-Type',
        manifest.mediaType ||
        'application/vnd.docker.distribution.manifest.v2+json',
      );
      return res.status(HttpStatus.OK).send(manifest);
    } else {
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
        return res.status(HttpStatus.OK).send(manifest);
      }

      return res.status(HttpStatus.NOT_FOUND).json({
        errors: [{ code: 'MANIFEST_UNKNOWN', message: 'Manifest unknown' }],
      });
    }
  }

  // 4.2. Manifest 업로드 (PUT)
  @Put('/:name/manifests/:reference')
  async putManifest(
    @Param('name') name: string,
    @Param('reference') reference: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    console.log(`4.2. Manifest PUT: ${name} with reference ${reference}`);

    const filePath = path.join(
      await this.getRepoDir(name),
      `manifests-${reference}.json`,
    );

    const fileStream = createWriteStream(filePath, { flags: 'w' });

    fileStream.on('finish', async () => {
      const content = await fs.readFile(filePath, 'utf-8');
      const manifest = JSON.parse(content);
      repositoryState[name] = repositoryState[name] || {
        blobs: {},
        manifest: null,
      };
      repositoryState[name].manifest = manifest;

      const manifest_digest =
        'sha256:' +
        crypto
          .createHash('sha256')
          .update(JSON.stringify(manifest))
          .digest('hex');

      res.set('Content-Length', '0');
      res.set('Docker-Content-Digest', manifest_digest);
      //실제로는 manifest에 대한 digest로 digest를 관리해야함 (이미지 삭제등의 로직에서 필요)
      return res.status(HttpStatus.CREATED).end();
    });

    fileStream.on('error', (err) => {
      console.error('File stream error during Put manifest:', err);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('File write error');
    });
    // ********* Warning *********
    // 실제 Manifest 푸시 전에, Manifest에 명시된 모든 config/layer (Blob)들이
    // repositoryState[name].blobs에 존재하는지 확인
    // 만약 하나라도 없으면 400 Bad Request 에러를 반환
    // *******************************************

    req.pipe(fileStream);
  }
}
