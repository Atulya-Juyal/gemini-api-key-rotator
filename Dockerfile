# Stage 1: Build stage 
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install dependencies first for layer caching
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source code and build it
COPY src/ ./src
RUN npm run build

# Stage 2: Runtime stage
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

# Set production environment
ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled JavaScript files from builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Expose standard port
EXPOSE 3000

# Start application
CMD ["node", "dist/index.js"]
