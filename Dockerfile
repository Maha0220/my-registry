# ---------- 1. Build Stage ----------
FROM node:18-alpine AS builder
# 작업 디렉토리 설정
WORKDIR /app
# 의존성 설치 (package*.json만 복사 → 캐시 최적화)
COPY package*.json ./
# Nest CLI가 필요한 경우
RUN npm install -g @nestjs/cli
# 의존성 설치
RUN npm ci
# 소스 복사
COPY . .
# NestJS 빌드
RUN npm run build

# ---------- 2. Production Stage ----------
FROM node:18-alpine AS runner
WORKDIR /app
# 프로덕션 환경 설정
ENV NODE_ENV=production
# builder 단계에서 필요한 파일만 복사
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# 포트 노출
EXPOSE 5000
# 실행 명령
CMD ["node", "dist/main.js"]
