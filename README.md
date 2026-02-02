# My Registry

Docker Registry API v2 호환 이미지 저장소 서버입니다. NestJS로 구현되었으며, Docker CLI를 통한 이미지 push/pull을 지원합니다.

## 기능

- Docker Registry HTTP API V2 호환
- 이미지 Push/Pull 지원
- Blob 청크 업로드
- Manifest 관리
- 이미지/Blob 삭제
- Garbage Collection
- Catalog API (repository/tag 목록)
- Health Check 엔드포인트
- 요청 ID 기반 로깅

## 빠른 시작

### 로컬 실행

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run start:dev

# 프로덕션 빌드 및 실행
npm run build
npm run start:prod
```

### Docker 실행

```bash
# Docker Compose로 실행
npm run compose:up

# 중지
npm run compose:down
```

## 환경 변수

`.env` 파일 또는 환경 변수로 설정:

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PORT` | 서버 포트 | `5000` |
| `STORAGE_ROOT` | 이미지 저장 경로 | `./data` |

## API 엔드포인트

### 기본

| Method | Path | 설명 |
|--------|------|------|
| GET | `/v2/` | API 버전 확인 |
| GET | `/health` | 헬스체크 |
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe |

### Catalog

| Method | Path | 설명 |
|--------|------|------|
| GET | `/v2/_catalog` | Repository 목록 |
| GET | `/v2/:name/tags/list` | 태그 목록 |

### Blob

| Method | Path | 설명 |
|--------|------|------|
| HEAD | `/v2/:name/blobs/:digest` | Blob 존재 확인 |
| GET | `/v2/:name/blobs/:digest` | Blob 다운로드 |
| POST | `/v2/:name/blobs/uploads` | 업로드 세션 시작 |
| PATCH | `/v2/:name/blobs/uploads/:uuid` | 청크 업로드 |
| PUT | `/v2/:name/blobs/uploads/:uuid?digest=` | 업로드 완료 |
| DELETE | `/v2/:name/blobs/:digest` | Blob 삭제 |

### Manifest

| Method | Path | 설명 |
|--------|------|------|
| GET | `/v2/:name/manifests/:reference` | Manifest 조회 |
| PUT | `/v2/:name/manifests/:reference` | Manifest 업로드 |
| DELETE | `/v2/:name/manifests/:reference` | Manifest 삭제 |

### Garbage Collection

| Method | Path | 설명 |
|--------|------|------|
| POST | `/v2/_gc` | 전체 GC 실행 |
| POST | `/v2/:name/_gc` | 특정 repo GC 실행 |

## Docker CLI 사용법

```bash
# 레지스트리에 이미지 태그
docker tag myimage:latest localhost:5000/myimage:latest

# 이미지 Push
docker push localhost:5000/myimage:latest

# 이미지 Pull
docker pull localhost:5000/myimage:latest
```

> 참고: 로컬 개발 시 insecure registry 설정이 필요할 수 있습니다.
> Docker Desktop > Settings > Docker Engine에서 `"insecure-registries": ["localhost:5000"]` 추가

## 테스트

```bash
# 단위 테스트
npm run test

# E2E 테스트
npm run test:e2e

# 테스트 커버리지
npm run test:cov
```

## 프로젝트 구조

```
src/
├── common/
│   ├── filters/          # Exception filters
│   └── middleware/       # Request ID middleware
├── health/               # Health check module
├── registry/             # Registry API module
│   ├── registry.controller.ts
│   ├── registry.service.ts
│   └── registry.module.ts
├── app.module.ts
└── main.ts
```

## 제한사항

- 인증/인가 미구현 (모든 요청 허용)
- 단일 노드 환경 (분산 스토리지 미지원)
- 메모리 기반 메타데이터 캐시 (서버 재시작 시 캐시 초기화)

## 라이선스

UNLICENSED
