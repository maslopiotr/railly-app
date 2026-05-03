# Stage 1: Build the React app
FROM node:22-slim AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/frontend/package.json packages/frontend/

# Install dependencies
RUN npm install --workspace=packages/shared --workspace=packages/frontend

# Copy source code
COPY packages/shared/ packages/shared/
COPY packages/frontend/ packages/frontend/
COPY tsconfig.json ./

# Build shared package first
RUN npm run build --workspace=packages/shared

# Build frontend
RUN npm run build --workspace=packages/frontend

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built frontend assets
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# Create proxy cache directory and ensure nginx user owns everything
RUN mkdir -p /var/cache/nginx/api && \
    chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
