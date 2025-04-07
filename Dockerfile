# Use the official Node.js 20 image
FROM node:20-slim

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
COPY src-new/ ./src-new/

# Build TypeScript code
RUN npm run build

# Clean up dev dependencies to reduce image size
RUN npm prune --production

# Set environment variables
ENV NODE_ENV=production
ENV PUBSUB_SUBSCRIPTION=notification-processor
ENV DLQ_TOPIC=notification-dlq
ENV LOG_LEVEL=info
ENV NODE_TLS_REJECT_UNAUTHORIZED=1
# Note: DB_PASSWORD and INSTANCE_CONNECTION_NAME will be injected by Cloud Run

# Expose the port explicitly
EXPOSE 8080

# Start the service
CMD [ "npm", "start" ]