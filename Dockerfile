# Build stage
FROM node:20-slim AS builder

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install

# Copy source code (respecting .dockerignore)
COPY . .

# Build TypeScript
RUN npm run build

# Final stage
FROM node:20-slim

# Re-install essential runtime tools for node-pty
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install only production dependencies
# This will trigger a clean compile of node-pty for the target OS/arch
RUN npm install --production

# Copy built assets from builder stage
COPY --from=builder /app/dist ./dist

# Create default workspace
RUN mkdir /workspace && chmod 777 /workspace

EXPOSE 3000

CMD ["node", "dist/server.js"]
