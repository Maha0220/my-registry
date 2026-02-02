import {
  Controller,
  Get,
  Post,
  Put,
  Head,
  Delete,
  Param,
  Req,
  Res,
  Query,
  HttpStatus,
  Patch,
  Logger,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { RegistryService } from './registry.service';

@Controller('v2')
export class RegistryController {
  private readonly logger = new Logger(RegistryController.name);

  constructor(private readonly registryService: RegistryService) { }

  // --- 1. 기본 API 확인: GET /v2/ ---
  @Get('/')
  @ApiTags('registry')
  @ApiOperation({ summary: 'API 버전 확인', description: 'Docker Registry API V2 지원 여부 확인' })
  @ApiResponse({ status: 200, description: 'API V2 지원' })
  checkApiVersion(@Res() res: Response) {
    this.logger.debug('API Version Check: /v2/');
    res.set('Docker-Distribution-API-Version', 'registry/2.0');
    return res.status(HttpStatus.OK).send({});
  }

  // ------------------------------------
  // --- 2. Catalog API ---
  // ------------------------------------

  @Get('/_catalog')
  @ApiTags('catalog')
  @ApiOperation({ summary: 'Repository 목록 조회', description: '전체 repository 목록 반환' })
  @ApiResponse({ status: 200, description: 'Repository 목록' })
  async listRepositories(@Res() res: Response) {
    this.logger.debug('Catalog: List repositories');
    const repositories = await this.registryService.listRepositories();
    return res.status(HttpStatus.OK).json({ repositories });
  }

  @Get('/:name/tags/list')
  @ApiTags('catalog')
  @ApiOperation({ summary: '태그 목록 조회', description: '특정 repository의 태그 목록 반환' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiResponse({ status: 200, description: '태그 목록' })
  @ApiResponse({ status: 404, description: 'Repository를 찾을 수 없음' })
  async listTags(@Param('name') name: string, @Res() res: Response) {
    this.logger.debug(`Tags List: ${name}`);
    const result = await this.registryService.listTags(name);

    if (!result.exists) {
      return res.status(HttpStatus.NOT_FOUND).json({
        errors: [{ code: 'NAME_UNKNOWN', message: 'Repository not found' }],
      });
    }

    return res.status(HttpStatus.OK).json({ name, tags: result.tags });
  }

  // 3. 인증처리 (임시로 인증 없이 허용)

  // ------------------------------------
  // --- 3. Blob (레이어) 처리 ---
  // ------------------------------------

  @Head(':name/blobs/:digest')
  @ApiTags('blob')
  @ApiOperation({ summary: 'Blob 존재 확인', description: 'Blob 존재 여부 및 크기 확인' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiParam({ name: 'digest', description: 'Blob digest (sha256:...)' })
  @ApiResponse({ status: 200, description: 'Blob 존재' })
  @ApiResponse({ status: 404, description: 'Blob을 찾을 수 없음' })
  async checkBlob(
    @Param('name') name: string,
    @Param('digest') digest: string,
    @Res() res: Response,
  ) {
    this.logger.debug(`Blob HEAD Check: ${name} - ${digest}`);
    const blobInfo = await this.registryService.checkBlobExists(name, digest);

    if (blobInfo.exists) {
      res.set('Content-Length', blobInfo.size!.toString());
      res.set('Docker-Content-Digest', digest);
      return res.status(HttpStatus.OK).end();
    }

    return res.status(HttpStatus.NOT_FOUND).json({
      errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob unknown to registry' }],
    });
  }


  @Get(':name/blobs/:digest')
  @ApiTags('blob')
  @ApiOperation({ summary: 'Blob 다운로드', description: 'Blob 콘텐츠 다운로드' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiParam({ name: 'digest', description: 'Blob digest (sha256:...)' })
  @ApiResponse({ status: 200, description: 'Blob 콘텐츠' })
  @ApiResponse({ status: 404, description: 'Blob을 찾을 수 없음' })
  async getBlob(
    @Param('name') name: string,
    @Param('digest') digest: string,
    @Res() res: Response,
  ) {
    this.logger.debug(`Blob GET: ${name} - ${digest}`);
    const blobInfo = await this.registryService.checkBlobExists(name, digest);

    if (blobInfo.exists) {
      res.set('Content-Length', blobInfo.size!.toString());
      res.set('Docker-Content-Digest', digest);
      const fileStream = this.registryService.createBlobReadStream(blobInfo.path!);
      return fileStream.pipe(res.status(HttpStatus.OK));
    }

    return res.status(HttpStatus.NOT_FOUND).json({
      errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob unknown to registry' }],
    });
  }

  @Post('/:name/blobs/uploads')
  @ApiTags('blob')
  @ApiOperation({ summary: 'Blob 업로드 세션 시작', description: '새로운 blob 업로드 세션 생성' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiResponse({ status: 202, description: '업로드 세션 생성됨' })
  async startBlobUpload(@Param('name') name: string, @Res() res: Response) {
    const { uuid } = await this.registryService.createUploadSession(name);
    this.logger.log(`Blob Upload Session Start: ${name} - UUID ${uuid}`);

    res.set('Location', `/v2/${name}/blobs/uploads/${uuid}`);
    res.set('Range', '0-0');
    res.set('Docker-Upload-UUID', uuid);
    return res.status(HttpStatus.ACCEPTED).end();
  }

  @Patch('/:name/blobs/uploads/:uuid')
  @ApiTags('blob')
  @ApiOperation({ summary: 'Blob 청크 업로드', description: 'Blob 데이터 청크 추가' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiParam({ name: 'uuid', description: '업로드 세션 UUID' })
  @ApiResponse({ status: 202, description: '청크 업로드 완료' })
  @ApiResponse({ status: 404, description: '업로드 세션을 찾을 수 없음' })
  async appendChunk(
    @Param('name') name: string,
    @Param('uuid') uuid: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    const tempFilePath = await this.registryService.getTempFilePath(name, uuid);
    this.logger.debug(`Blob PATCH: Appending chunk to ${uuid}.tmp`);

    // 1. 임시 파일 존재 확인 (업로드 세션의 유효성 검사)
    if (!(await this.registryService.fileExists(tempFilePath))) {
      return res.status(HttpStatus.NOT_FOUND).json({
        errors: [{ code: 'BLOB_UNKNOWN', message: 'Upload session not found' }],
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

      this.logger.debug(`Chunk appended. Current size: ${currentSize}`);
      return res.status(HttpStatus.ACCEPTED).end(); // 202 Accepted로 응답
    });

    fileStream.on('error', (err) => {
      this.logger.error('File stream error during PATCH:', err);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('File write error');
    });

    req.pipe(fileStream);
  }

  @Put('/:name/blobs/uploads/:uuid')
  @ApiTags('blob')
  @ApiOperation({ summary: 'Blob 업로드 완료', description: 'Blob 업로드 세션 완료 및 저장' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiParam({ name: 'uuid', description: '업로드 세션 UUID' })
  @ApiQuery({ name: 'digest', description: 'Blob digest (sha256:...)', required: true })
  @ApiResponse({ status: 201, description: 'Blob 저장 완료' })
  @ApiResponse({ status: 400, description: 'digest 파라미터 누락' })
  async completeBlobUpload(
    @Param('name') name: string,
    @Param('uuid') uuid: string,
    @Query('digest') digest: string,
    @Res() res: Response,
  ) {
    if (!digest) {
      return res.status(HttpStatus.BAD_REQUEST).send('Digest required for completion.');
    }

    const result = await this.registryService.completeBlobUpload(name, uuid, digest);

    if (!result.success) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(result.error);
    }

    this.logger.log(`Blob Upload Complete: ${name} - ${digest}`);
    res.set('Content-Length', '0');
    res.set('Docker-Content-Digest', digest);
    return res.status(HttpStatus.CREATED).end();
  }


  // ------------------------------------
  // --- 4. 매니페스트 (Manifest) 처리 ---
  // ------------------------------------

  @Get('/:name/manifests/:reference')
  @ApiTags('manifest')
  @ApiOperation({ summary: 'Manifest 조회', description: 'Manifest 다운로드' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiParam({ name: 'reference', description: '태그 또는 digest' })
  @ApiResponse({ status: 200, description: 'Manifest 콘텐츠' })
  @ApiResponse({ status: 404, description: 'Manifest를 찾을 수 없음' })
  async getManifest(
    @Param('name') name: string,
    @Param('reference') reference: string,
    @Res() res: Response,
  ) {
    this.logger.debug(`Manifest GET: ${name}:${reference}`);
    const manifestInfo = await this.registryService.getManifest(name, reference);

    if (manifestInfo.exists) {
      res.set('Content-Type', manifestInfo.mediaType!);
      return res.status(HttpStatus.OK).send(manifestInfo.manifest);
    }

    return res.status(HttpStatus.NOT_FOUND).json({
      errors: [{ code: 'MANIFEST_UNKNOWN', message: 'Manifest unknown' }],
    });
  }

  @Put('/:name/manifests/:reference')
  @ApiTags('manifest')
  @ApiOperation({ summary: 'Manifest 업로드', description: 'Manifest 저장' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiParam({ name: 'reference', description: '태그 또는 digest' })
  @ApiResponse({ status: 201, description: 'Manifest 저장 완료' })
  async putManifest(
    @Param('name') name: string,
    @Param('reference') reference: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    this.logger.log(`Manifest PUT: ${name}:${reference}`);
    const filePath = await this.registryService.getManifestFilePath(name, reference);
    const fileStream = this.registryService.createManifestWriteStream(filePath);

    fileStream.on('finish', async () => {
      const manifestDigest = await this.registryService.saveManifestToCache(name, filePath);
      res.set('Content-Length', '0');
      res.set('Docker-Content-Digest', manifestDigest);
      return res.status(HttpStatus.CREATED).end();
    });

    fileStream.on('error', (err) => {
      this.logger.error('File stream error during Put manifest:', err);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('File write error');
    });
    // ********* Warning *********
    // 실제 Manifest 푸시 전에, Manifest에 명시된 모든 config/layer (Blob)들이
    // repositoryState[name].blobs에 존재하는지 확인
    // 만약 하나라도 없으면 400 Bad Request 에러를 반환
    // *******************************************

    req.pipe(fileStream);
  }

  // ------------------------------------
  // --- 5. 삭제 (DELETE) 처리 ---
  // ------------------------------------

  @Delete('/:name/blobs/:digest')
  @ApiTags('blob')
  @ApiOperation({ summary: 'Blob 삭제', description: 'Blob 삭제' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiParam({ name: 'digest', description: 'Blob digest (sha256:...)' })
  @ApiResponse({ status: 202, description: 'Blob 삭제 완료' })
  @ApiResponse({ status: 404, description: 'Blob을 찾을 수 없음' })
  async deleteBlob(
    @Param('name') name: string,
    @Param('digest') digest: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Blob DELETE: ${name} - ${digest}`);
    const result = await this.registryService.deleteBlob(name, digest);

    if (result.success) {
      return res.status(HttpStatus.ACCEPTED).end();
    }

    return res.status(HttpStatus.NOT_FOUND).json({
      errors: [{ code: 'BLOB_UNKNOWN', message: result.error || 'Blob unknown to registry' }],
    });
  }

  @Delete('/:name/manifests/:reference')
  @ApiTags('manifest')
  @ApiOperation({ summary: 'Manifest 삭제', description: 'Manifest 삭제' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiParam({ name: 'reference', description: '태그 또는 digest' })
  @ApiResponse({ status: 202, description: 'Manifest 삭제 완료' })
  @ApiResponse({ status: 404, description: 'Manifest를 찾을 수 없음' })
  async deleteManifest(
    @Param('name') name: string,
    @Param('reference') reference: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Manifest DELETE: ${name}:${reference}`);
    const result = await this.registryService.deleteManifest(name, reference);

    if (result.success) {
      return res.status(HttpStatus.ACCEPTED).end();
    }

    return res.status(HttpStatus.NOT_FOUND).json({
      errors: [{ code: 'MANIFEST_UNKNOWN', message: result.error || 'Manifest unknown' }],
    });
  }

  // ------------------------------------
  // --- 6. Garbage Collection ---
  // ------------------------------------

  @Post('/:name/_gc')
  @ApiTags('gc')
  @ApiOperation({ summary: 'Repository GC 실행', description: '특정 repository의 미참조 blob 정리' })
  @ApiParam({ name: 'name', description: 'Repository 이름' })
  @ApiResponse({ status: 200, description: 'GC 결과' })
  async runGarbageCollection(@Param('name') name: string, @Res() res: Response) {
    this.logger.log(`Garbage Collection: ${name}`);
    const result = await this.registryService.runGarbageCollection(name);
    return res.status(HttpStatus.OK).json({
      repository: name,
      deleted: result.deleted,
      errors: result.errors,
    });
  }

  @Post('/_gc')
  @ApiTags('gc')
  @ApiOperation({ summary: '전체 GC 실행', description: '모든 repository의 미참조 blob 정리' })
  @ApiResponse({ status: 200, description: 'GC 결과' })
  async runGlobalGarbageCollection(@Res() res: Response) {
    this.logger.log('Global Garbage Collection');
    const result = await this.registryService.runGlobalGarbageCollection();
    return res.status(HttpStatus.OK).json(result);
  }
}
