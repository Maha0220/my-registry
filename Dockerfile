# ---------- 1. Build Stage ----------
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# ---------- 2. Production Stage ----------
FROM node:18-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# 보안: non-root 사용자로 실행
RUN addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 nestjs

COPY --from=builder /app/package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist

# data 디렉토리 생성 및 권한 설정
RUN mkdir -p /app/data && chown -R nestjs:nodejs /app

# non-root 사용자로 전환
USER nestjs

EXPOSE 5000

# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD wget --no-verbose --tries=1 --spider http://localhost:5000/v2/ || exit 1

CMD ["node", "dist/main.js"]
