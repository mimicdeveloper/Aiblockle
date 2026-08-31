# Portable container for the AIBlockle filtering proxy.
# Build context is the repo root so the proxy can reach ../src/main/blocklist.js.
#   docker build -t aiblockle-proxy .
#   docker run -p 3000:3000 aiblockle-proxy
# Works on Railway, Fly.io, Google Cloud Run, or any container host.
FROM node:20-slim
WORKDIR /app

# Install proxy deps first for better layer caching.
COPY proxy/package*.json ./proxy/
RUN cd proxy && npm install --omit=dev

# Copy the rest of the repo (proxy needs ../src for the shared blocklist).
COPY . .

WORKDIR /app/proxy
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
