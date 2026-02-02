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
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Response, Request } from 'express';
import { RegistryService } from './registry.service';

@Controller('v2')
export class RegistryController {
  constructor(private readonly registryService: RegistryService) { }

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

    const blobInfo = await this.registryService.checkBlobExists(name, digest);

    if (blobInfo.exists) {
      res.set('Content-Length', blobInfo.size!.toString());
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

    const blobInfo = await this.registryService.checkBlobExists(name, digest);

    if (blobInfo.exists) {
      res.set('Content-Length', blobInfo.size!.toString());
      res.set('Docker-Content-Digest', digest);

      const fileStream = this.registryService.createBlobReadStream(blobInfo.path!);
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
    const { uuid } = await this.registryService.createUploadSession(name);

    console.log(`3.2. Blob Upload Session Start for ${name}: UUID ${uuid}`);

    res.set('Location', `/v2/${name}/blobs/uploads/${uuid}`);
    res.set('Range', '0-0');
    res.set('Docker-Upload-UUID', uuid);
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
    const tempFilePath = await this.registryService.getTempFilePath(name, uuid);

    console.log(`3.4. Blob PATCH: Appending chunk to ${uuid}.tmp`);

    // 1. 임시 파일 존재 확인 (업로드 세션의 유효성 검사)
    if (!(await this.registryService.fileExists(tempFilePath))) {
      return res.status(HttpStatus.NOT_FOUND).json({
        errors: [
          { code: 'BLOB_UNKNOWN', message: 'Upload session not found' },
        ],
      });
    }

    // 2. 요청 본문의 데이터를 임시 파일에 스트림으로 추가(Append)
    const fileStream = this.registryService.createAppendStream(tempFilePath);

    // 데이터 전송 완료 후 처리
    fileStream.on('finish', async () => {
      // 3. 현재 파일 크기를 확인하여 Range 헤더 반환
      const currentSize = await this.registryService.getFileSize(tempFilePath);

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

    const result = await this.registryService.completeBlobUpload(name, uuid, digest);

    if (!result.success) {
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send(result.error);
    }

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

    const manifestInfo = await this.registryService.getManifest(name, reference);

    if (manifestInfo.exists) {
      res.set('Content-Type', manifestInfo.mediaType!);
      return res.status(HttpStatus.OK).send(manifestInfo.manifest);
    }

    return res.status(HttpStatus.NOT_FOUND).json({
      errors: [{ code: 'MANIFEST_UNKNOWN', message: 'Manifest unknown' }],
    });
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

    const filePath = await this.registryService.getManifestFilePath(name, reference);
    const fileStream = this.registryService.createManifestWriteStream(filePath);

    fileStream.on('finish', async () => {
      const manifestDigest = await this.registryService.saveManifestToCache(name, filePath);

      res.set('Content-Length', '0');
      res.set('Docker-Content-Digest', manifestDigest);
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
