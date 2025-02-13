# Use the official Node.js 20 image
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY src/ ./src/

# Set environment variables
ENV NODE_ENV=production
ENV PUBSUB_SUBSCRIPTION=notification-processor
ENV DLQ_TOPIC=notification-dlq
ENV LOG_LEVEL=info
# Note: DB_PASSWORD and INSTANCE_CONNECTION_NAME will be injected by Cloud Run

# Start the service
CMD [ "npm", "start" ]