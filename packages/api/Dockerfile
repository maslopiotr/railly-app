FROM node:22-slim

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

# Install dependencies
RUN npm install --omit=dev --workspace=packages/shared --workspace=packages/api

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/

# Build shared package first
RUN npm run build --workspace=packages/shared

# Build API
RUN npm run build --workspace=packages/api

EXPOSE 3000

CMD ["node", "packages/api/dist/server.js"]