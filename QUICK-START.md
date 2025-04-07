# Notification Worker - Quick Start Guide

This guide provides quick instructions for building, testing, and running the rebuilt Notification Worker.

## Prerequisites

- Node.js 18+ (LTS recommended)
- npm 8+
- Git

## Clone and Setup

```bash
# Clone the repository if not already done
git clone <repository-url>
cd notification-worker

# Install dependencies
npm install
```

## Development Testing

The easiest way to test the rebuilt notification worker locally is to use the mock testing environment, which doesn't require a real database or PubSub connection:

```bash
# Run with mock testing environment
npm run dev:test
```

This will:
1. Start the service with mock implementations
2. Send test BOE and Real Estate messages for processing
3. Log the results to the console

## Building for Development

```bash
# Run in development mode (requires real DB and PubSub)
npm run dev
```

## Building for Production

```bash
# Build TypeScript code
npm run build

# Start the production server
npm start
```

## Configuration

Configure the service using environment variables:

```bash
# Required variables
export NODE_ENV=development
export PORT=8080

# For production
export GOOGLE_CLOUD_PROJECT=your-project-id
export PUBSUB_SUBSCRIPTION=your-subscription-name
export DLQ_TOPIC=your-dlq-topic

# Database connection (not needed for mock testing)
export DB_USER=your-db-user
export DB_PASSWORD=your-db-password
export DB_NAME=your-db-name
export DB_HOST=localhost
export DB_PORT=5432
```

## Testing

```bash
# Type check
npm run typecheck

# Lint code
npm run lint

# Format code
npm run format
```

## API Endpoints

When the service is running, you can access:

- http://localhost:8080/health - Health check
- http://localhost:8080/ready - Readiness check
- http://localhost:8080/status - Service status
- http://localhost:8080/diagnostics - Detailed diagnostics

## Architecture Overview

The notification worker follows a domain-driven design with:

1. **Domain Layer** - Core business models and interfaces
2. **Application Layer** - Service implementations and use cases
3. **Infrastructure Layer** - Database, PubSub, and external service implementations
4. **Interface Layer** - HTTP routes and handlers

### Key Components

- **Message Processors** - Process different message types (BOE, Real Estate)
- **Processor Registry** - Manages and routes messages to appropriate processors
- **Notification Repository** - Handles database operations for notifications
- **PubSub Service** - Handles message publishing and subscription

## Troubleshooting

If you encounter issues:

1. Check the logs for error messages
2. Verify environment variable configuration
3. Ensure dependencies are installed
4. Try using the mock testing environment for isolated testing