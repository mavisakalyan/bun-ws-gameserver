# ── Stage 1: Install deps ──────────────────────────────────────────
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY tsconfig.json ./
COPY src/ ./src/

# ── Stage 2: Production ───────────────────────────────────────────
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

COPY package.json bun.lockb* ./
RUN bun install --production 2>/dev/null || bun install && \
    rm -rf /root/.bun/install/cache

COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

USER appuser

ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["bun", "src/index.ts"]
