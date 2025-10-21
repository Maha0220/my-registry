import {
  Controller, Post, Patch, Put, Get,
  Param, Query, Req, Res, HttpStatus, NotFoundException,
  Head
} from '@nestjs/common';
import { RegistryService } from './registry.service';
import type { Request, Response } from 'express';

@Controller('v2')
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  // --- 1. 기본 API 확인: GET /v2/ ---
  @Get('/')
  checkApiVersion(@Res() res: Response) {
    console.log('1. API Version Check: /v2/');
    res.set('Docker-Distribution-API-Version', 'registry/2.0');
    return res.status(HttpStatus.OK).send({});
  }

  @Head('/:repo/blobs/:digest')
  async checkBlob(@Param('repo') repo: string, @Param('digest') digest: string, @Res() res: Response) {
    const stats = await this.registry.checkBlob(repo, digest);
    if (!stats) throw new NotFoundException({ code: 'BLOB_UNKNOWN', message: 'Blob unknown to registry' });
    res.set('Content-Length', stats.size.toString());
    res.set('Docker-Content-Digest', digest);
    return res.status(HttpStatus.OK).end();
  }


  @Get('/:repo/blobs/:digest')
  async getBlob(
    @Param('repo') repo: string,
    @Param('digest') digest: string,
    @Res() res: Response
  ) {
    const stats = await this.registry.checkBlob(repo, digest);
    if (!stats) throw new NotFoundException({ code: 'BLOB_UNKNOWN', message: 'Blob unknown to registry' });
    res.set('Content-Length', stats.size.toString());
    res.set('Docker-Content-Digest', digest);
    const stream = await this.registry.getBlob(repo, digest);
    stream?.pipe(res);
  }

  // Blob 업로드 (monolithic 또는 session 생성)
  @Post('/:repo/blobs/uploads')
  async createUpload(
    @Param('repo') repo: string, 
    @Query('digest') digest: string, 
    @Req() req: Request, 
    @Res() res: Response
  ) {
    if (!digest) {
      const uuid = await this.registry.startUpload(repo);
      res.setHeader('Location', `/v2/${repo}/blobs/uploads/${uuid}`);
      return res.status(HttpStatus.ACCEPTED).json({ uuid });
    }
    const d = await this.registry.saveMonolithic(repo, digest, req);
    res.setHeader('Docker-Content-Digest', d);
    return res.status(HttpStatus.CREATED).end();
  }

  @Patch('/:repo/blobs/uploads/:uuid')
  async appendChunk(
    @Param('repo') repo: string, 
    @Param('uuid') uuid: string, 
    @Req() req: Request, 
    @Res() res: Response
  ) {
    await this.registry.appendChunk(repo, uuid, req);
    res.setHeader('Location', `/v2/${repo}/blobs/uploads/${uuid}`);
    return res.status(HttpStatus.ACCEPTED).send();
  }

  @Put('/:repo/blobs/uploads/:uuid')
  async finalizeUpload(
    @Param('repo') repo: string, 
    @Param('uuid') uuid: string, 
    @Query('digest') digest: string, 
    @Res() res: Response
  ) {
    const d = await this.registry.finalizeUpload(repo, uuid, digest);
    res.setHeader('Docker-Content-Digest', d);
    console.log(`Blob Upload Complete for ${repo}, Digest ${digest}`);
    res.status(HttpStatus.CREATED).send();
  }



  // Manifest 저장 및 조회
  @Put('/:repo/manifests/:tag')
  async putManifest(@Param('repo') repo: string, @Param('tag') tag: string, @Req() req: Request, @Res() res: Response) {
    const d = await this.registry.saveManifest(repo, tag, req);
    res.setHeader('Docker-Content-Digest', d);
    res.status(HttpStatus.CREATED).send();
  }

  @Get('/:repo/manifests/:ref')
  async getManifest(@Param('repo') repo: string, @Param('ref') ref: string, @Res() res: Response) {
    const data = await this.registry.getManifest(repo, ref);
    if (!data) throw new NotFoundException();
    res.setHeader('Content-Type', 'application/vnd.docker.distribution.manifest.v2+json');
    res.send(data);
  }
}
