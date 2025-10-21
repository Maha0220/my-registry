import {
  Controller,
  Get,
  Post,
  Put,
  Head,
  Body,
  Param,
  Req,
  Res,
  Query,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

// 저장소 기본 경로 설정 (프로젝트 루트의 'data' 폴더)
const STORAGE_ROOT = path.join(process.cwd(), 'data');
if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT);
}

// 레지스트리 메타데이터 (임시 메모리 저장소)
const repositoryState: Record<
  string,
  { blobs: Record<string, string>; manifest: any }
> = {};

@Controller('v2')
export class RegistryController {
  private getRepoDir(name: string): string {
    const repoPath = path.join(STORAGE_ROOT, name);
    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true });
    }
    return repoPath;
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
  checkBlob(
    @Param('name') name: string,
    @Param('digest') digest: string,
    @Res() res: Response,
  ) {
    console.log(
      `3.1. Blob ${res.req.method} Check: ${name} with digest ${digest}`,
    );

    const digestHash = digest.split(':')[1];
    const blobPath = path.join(this.getRepoDir(name), digestHash);

    if (fs.existsSync(blobPath)) {
      const stats = fs.statSync(blobPath);
      res.set('Content-Length', stats.size.toString());
      res.set('Docker-Content-Digest', digest);

      return res.status(HttpStatus.OK).end(); // HEAD 요청
    } else {
      return res.status(HttpStatus.NOT_FOUND).json({
        errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob unknown to registry' }],
      });
    }
  }
  @Get(':name/blobs/:digest')
  getBlob(
    @Param('name') name: string,
    @Param('digest') digest: string,
    @Res() res: Response,
  ) {
    console.log(
      `3.1. Blob ${res.req.method} Check: ${name} with digest ${digest}`,
    );

    const digestHash = digest.split(':')[1];
    const blobPath = path.join(this.getRepoDir(name), digestHash);

    if (fs.existsSync(blobPath)) {
      const stats = fs.statSync(blobPath);
      res.set('Content-Length', stats.size.toString());
      res.set('Docker-Content-Digest', digest);

      // GET 요청일 경우 파일 스트리밍
      const fileStream = fs.createReadStream(blobPath);
      return fileStream.pipe(res.status(HttpStatus.OK));

    } else {
      return res.status(HttpStatus.NOT_FOUND).json({
        errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob unknown to registry' }],
      });
    }
  }

  // 3.2. Blob 업로드 세션 시작 (POST)
  @Post('/:name/blobs/uploads')
  startBlobUpload(@Param('name') name: string, @Res() res: Response) {
    const session_uuid = crypto.randomUUID();
    const tempFilePath = path.join(
      this.getRepoDir(name),
      `${session_uuid}.tmp`,
    );

    // 임시 파일 생성 (빈 파일)
    fs.writeFileSync(tempFilePath, '');

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
  appendChunk(
      @Param('name') name: string,
      @Param('uuid') uuid: string,
      @Req() req: any, // Express Request 객체를 직접 사용하여 데이터 스트림 처리
      @Res() res: Response
  ) {
      const repoDir = this.getRepoDir(name);
      const tempFilePath = path.join(repoDir, `${uuid}.tmp`);
      
      console.log(`3.4. Blob PATCH: Appending chunk to ${uuid}.tmp`);
      
      // 1. 임시 파일 존재 확인 (업로드 세션의 유효성 검사)
      if (!fs.existsSync(tempFilePath)) {
            return res.status(HttpStatus.NOT_FOUND).json({ 
              errors: [{ code: 'BLOB_UNKNOWN', message: 'Upload session not found' }] 
            });
      }
      
      // 2. 요청 본문의 데이터를 임시 파일에 스트림으로 추가(Append)
      const fileStream = fs.createWriteStream(tempFilePath, { flags: 'a' });
      
      // 데이터 전송 완료 후 처리
      fileStream.on('finish', () => {
          // 3. 현재 파일 크기를 확인하여 Range 헤더 반환
          const currentSize = fs.statSync(tempFilePath).size;
          
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
          return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('File write error');
      });

      // 요청 본문(데이터 청크)을 임시 파일 스트림으로 파이프
      // NestJS (Express)에서 Raw Body를 처리해야 할 경우, BodyParser 설정을 변경해야 할 수 있습니다.
      // 여기서는 Express의 기본 동작을 가정하고 Request 객체를 직접 사용합니다.
      req.pipe(fileStream); 
  }

  // 3.3. Blob 업로드 완료 (PUT) - Monolithic Upload (단일 요청 업로드 처리)
  @Put('/:name/blobs/uploads/:uuid')
  completeBlobUpload(
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

    // Monolithic Upload: 이 요청의 body에 데이터가 담겨 있다고 가정
    // 실제로는 스트리밍 처리 또는 PATCH/PUT 분할 처리가 필요
    const tempFilePath = path.join(this.getRepoDir(name), `${uuid}.tmp`);

    // 임시 파일 대신 PUT 요청의 Body를 파일로 저장하고 검증하는 로직이 필요하지만,
    // 여기서는 간단히 임시 파일을 최종 파일로 이름만 변경
    const digestHash = digest.split(':')[1];
    const finalBlobPath = path.join(this.getRepoDir(name), digestHash);

    // 실제로는 요청 본문(req.body)을 finalBlobPath에 저장하고 다이제스트를 검증해야 함
    // 여기서는 푸시 성공을 위해 임시 파일이 있다고 가정하고 처리 (실제 구현 시 수정 필요)
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.renameSync(tempFilePath, finalBlobPath); // 임시 파일을 최종 경로로 변경
      } else {
        // POST/PATCH 과정 없이 바로 PUT으로 완료된 경우를 가정하여 빈 파일을 생성
        fs.writeFileSync(finalBlobPath, Buffer.from(res.req.body || ''));
      }
    } catch (error) {
      console.error('File operation error:', error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('File save error');
    }

    repositoryState[name] = repositoryState[name] || {
      blobs: {},
      manifest: null,
    };
    repositoryState[name].blobs[digest] = finalBlobPath;

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
  getManifest(
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
      return res.status(HttpStatus.NOT_FOUND).json({
        errors: [{ code: 'MANIFEST_UNKNOWN', message: 'Manifest unknown' }],
      });
    }
  }

  // 4.2. Manifest 업로드 (PUT)
  @Put('/:name/manifests/:reference')
  putManifest(
    @Param('name') name: string,
    @Param('reference') reference: string,
    @Body() manifest: any,
    @Res() res: Response,
  ) {
    console.log(`4.2. Manifest PUT: ${name} with reference ${reference}`);

    // ********* 핵심 검증 로직 (스터디 필수) *********
    // 실제 Manifest 푸시 전에, Manifest에 명시된 모든 config/layer (Blob)들이
    // repositoryState[name].blobs에 존재하는지 확인해야 합니다.
    // 만약 하나라도 없으면 400 Bad Request 에러를 반환해야 합니다.
    // *******************************************

    repositoryState[name] = repositoryState[name] || {
      blobs: {},
      manifest: null,
    };
    repositoryState[name].manifest = manifest;

    // Manifest의 다이제스트 계산 및 헤더 반환
    const manifest_digest =
      'sha256:' +
      crypto
        .createHash('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex');

    res.set('Content-Length', '0');
    res.set('Docker-Content-Digest', manifest_digest);
    return res.status(HttpStatus.CREATED).end();
  }
}
