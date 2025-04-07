# Use Node.js LTS as base image
FROM node:18-slim AS builder

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies with necessary SSL packages
RUN apt-get update && \
    apt-get install -y ca-certificates openssl && \
    update-ca-certificates && \
    npm ci

# Copy app source
COPY src/ ./src/

# Build TypeScript code
RUN npm run build

# Use a smaller base image for production
FROM node:18-slim AS production

# Set working directory
WORKDIR /app

# Install necessary packages for SSL
RUN apt-get update && \
    apt-get install -y ca-certificates openssl curl && \
    update-ca-certificates

# Set Node.js environment to production
ENV NODE_ENV=production

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist

# Set environment variables
ENV PUBSUB_SUBSCRIPTION=notification-processor
ENV DLQ_TOPIC=notification-dlq
ENV LOG_LEVEL=info
ENV NODE_TLS_REJECT_UNAUTHORIZED=1
# Note: DB_PASSWORD and INSTANCE_CONNECTION_NAME will be injected by Cloud Run

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Set ownership of app directory
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Set health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Start the service
CMD ["node", "dist/index.js"]