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

# Start the service
CMD [ "npm", "start" ]