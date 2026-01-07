# Stage 1: Build
FROM node:18-bookworm AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3, bcrypt, secp256k1)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY packages/core/package*.json ./packages/core/
COPY packages/chains/package*.json ./packages/chains/
COPY packages/backend/package*.json ./packages/backend/
COPY packages/tools/package*.json ./packages/tools/
COPY packages/web/package*.json ./packages/web/

# Install all dependencies
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY packages/ ./packages/

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:18-bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy built artifacts and hoisted node_modules (npm workspaces)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/chains/dist ./packages/chains/dist
COPY --from=builder /app/packages/chains/package.json ./packages/chains/
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/package.json ./packages/backend/
# Copy schema.sql for database migrations
COPY --from=builder /app/packages/backend/src/db/schema.sql ./packages/backend/src/db/schema.sql
COPY package.json ./

# Create directories for runtime
RUN mkdir -p /app/packages/backend/data /app/packages/backend/logs

WORKDIR /app/packages/backend

EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:80/rpc || exit 1

CMD ["node", "dist/index.js"]
