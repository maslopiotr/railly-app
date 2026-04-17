# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

# Install all dependencies (including dev for build)
RUN npm install --workspace=packages/shared --workspace=packages/api

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/

# Build shared package first
RUN npm run build --workspace=packages/shared

# Build API
RUN npm run build --workspace=packages/api

# Stage 2: Production runtime
FROM node:22-slim

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

# Install only production dependencies
RUN npm install --omit=dev --workspace=packages/shared --workspace=packages/api

# Copy built files from builder
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/api/dist packages/api/dist

EXPOSE 3000

CMD ["node", "packages/api/dist/server.js"]