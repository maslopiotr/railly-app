# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/consumer/package.json packages/consumer/

# Install all dependencies (including dev for build)
RUN npm install --workspace=packages/shared --workspace=packages/consumer

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/consumer/ packages/consumer/

# Build shared package first
RUN npm run build --workspace=packages/shared

# Build consumer
RUN npm run build --workspace=packages/consumer

# Stage 2: Production runtime
FROM node:22-slim

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/consumer/package.json packages/consumer/

# Install only production dependencies
RUN npm install --omit=dev --workspace=packages/shared --workspace=packages/consumer

# Copy built files from builder
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/consumer/dist packages/consumer/dist

# Run as non-root user for security
USER node

CMD ["node", "packages/consumer/dist/index.js"]