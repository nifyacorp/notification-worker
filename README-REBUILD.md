# Notification Worker Rebuild

This document provides details about the notification worker rebuild project, its architecture, and how to build, test, and deploy it.

## Architecture

The notification worker has been rebuilt using a domain-driven design pattern with clear separation of concerns:

- **Domain Layer**: Contains the core domain models and interfaces.
- **Application Layer**: Implements application-specific business logic.
- **Infrastructure Layer**: Implements persistence, messaging, and external services.
- **Interface Layer**: Handles HTTP requests and API endpoints.

### Key Components

1. **Processor Registry**: A flexible system for registering and using message processors based on message type.
2. **Notification Repository**: Manages notification persistence with proper RLS context.
3. **Message Processors**: Processors for different types of messages (BOE, Real Estate, etc.).
4. **PubSub Service**: Handles message publishing and subscription.
5. **Health Monitoring**: Provides robust health checks and service status reporting.

## Building and Testing

### Development Environment

To run the service locally in development mode:

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run with mock testing environment (no real DB or PubSub required)
npm run dev:test
```

### Building for Production

```bash
# Build TypeScript code
npm run build

# Start the production server
npm start
```

### Testing

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Lint code
npm run lint

# Format code
npm run format
```

## Mock Testing

The notification worker includes a mock testing environment that allows you to test the service without requiring actual database or PubSub connections. This is useful for development and testing.

Mock testing includes:
- Mock NotificationRepository implementation
- Mock PubSubService implementation
- Mock message processor for testing

To run with the mock testing environment:

```bash
npm run dev:test
```

This will:
1. Start the service with mock implementations
2. Send test BOE and Real Estate messages for processing
3. Log the results to the console

## Deployment

The service is designed to deploy to Google Cloud Run or any Kubernetes environment.

### Environment Variables

Required environment variables:
- `PORT`: HTTP port (default: 8080)
- `NODE_ENV`: Environment mode (development, production)
- `GOOGLE_CLOUD_PROJECT`: Google Cloud project ID
- `PUBSUB_SUBSCRIPTION`: PubSub subscription name
- `DLQ_TOPIC`: Dead letter queue topic
- `EMAIL_IMMEDIATE_TOPIC`: Topic for immediate email notifications
- `EMAIL_DAILY_TOPIC`: Topic for daily email notifications

Database variables:
- `DB_USER`: Database user
- `DB_PASSWORD`: Database password
- `DB_NAME`: Database name
- `DB_HOST`: Database host (default: localhost)
- `DB_PORT`: Database port (default: 5432)

### Cloud Run Deployment

```bash
# Build container image
gcloud builds submit --tag gcr.io/PROJECT_ID/notification-worker

# Deploy to Cloud Run
gcloud run deploy notification-worker \
  --image gcr.io/PROJECT_ID/notification-worker \
  --platform managed \
  --set-env-vars NODE_ENV=production,PUBSUB_SUBSCRIPTION=SUBSCRIPTION_NAME
```

## API Endpoints

- `/health`: Basic health check
- `/ready`: Readiness check (returns 200 if service is ready to accept requests)
- `/status`: Detailed service status including dependencies
- `/diagnostics`: Enhanced diagnostics information for debugging

## Improvements from Original Version

1. **Type Safety**: Full TypeScript implementation with proper interfaces and type checking.
2. **Error Handling**: Structured error handling with specific error types.
3. **Monitoring**: Enhanced health checks and service status reporting.
4. **Message Processing**: Flexible processor registry with standardized message validation.
5. **Database Connection**: Robust connection management with retry capabilities.
6. **Testing Support**: Mock implementations for easier testing.
7. **Configuration**: Validated configuration with environment variables.
8. **Service Architecture**: Clean separation of concerns with domain-driven design.