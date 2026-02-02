## TODO 

보안
- 인증/인가 구현 (Basic Auth, Bearer Token/JWT)
- 사용자별 repository 접근 권한 관리
- Rate limiting

데이터 무결성
- Digest 검증 (업로드된 blob의 실제 SHA256 vs 클라이언트 제공 digest 비교)
- Manifest 업로드 시 참조된 blob 존재 여부 검증 (Warning 주석 부분)

기능
- Monolithic Upload 지원 (PATCH 없이 PUT으로 바로 완료)
- Cross-repository blob mount (POST /v2/:name/blobs/uploads?mount=&from=)
- Content-Range 헤더 기반 resumable upload

운영
- 메타데이터 영속화 (Redis/SQLite로 repositoryState 대체)