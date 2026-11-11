FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY app/package*.json ./
COPY app/server/package*.json ./server/
COPY app/client/package*.json ./client/

# Install server dependencies
RUN cd server && npm ci --omit=dev

# Install client dependencies and build
RUN cd client && npm ci
COPY app/client/ ./client/
RUN cd client && npm run build

# Copy server source
COPY app/server/ ./server/
COPY app/config/ ./config/

# Create data directory for persistent storage
RUN mkdir -p /data/cache/assets

# Environment
ENV PORT=3001
ENV HOST=0.0.0.0
ENV DB_PATH=/data/user_data.db
ENV USER_DATA_DIR=/data
ENV CACHE_DIR=/data/cache/assets
ENV NODE_ENV=production

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q --spider http://localhost:3001/api/status || exit 1

CMD ["node", "server/index.js"]
