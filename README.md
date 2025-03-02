# Nifya Notification Worker

A Cloud Run service that processes notifications from various content processors (BOE, Real Estate, etc.) and creates user notifications in the database. This service listens to a PubSub subscription and processes incoming messages to generate user notifications based on document matches.

## 🚀 Features

- Processes PubSub messages from content processors
- Creates user notifications in the database with proper Row-Level Security (RLS) context
- Handles multiple content types (BOE, DOGA, Real Estate)
- Error handling with Dead Letter Queue (DLQ) for failed messages
- Retry mechanism with exponential backoff for transient failures
- Structured logging with Pino for enhanced observability
- Message validation using Zod for schema enforcement
- Health and diagnostics endpoints for monitoring and troubleshooting
- Secure database operations with PostgreSQL RLS policies

## 🛠 Tech Stack
- **Runtime**: Node.js 20
- **Database**: PostgreSQL (shared with main service)
- **Cloud Services**:
  - Cloud Run (service hosting)
  - Cloud Pub/Sub (message processing)
  - Cloud SQL (PostgreSQL hosting)
  - Cloud Logging (centralized logs)
- **Libraries**:
  - `@google-cloud/pubsub` - PubSub client
  - `pg` - PostgreSQL client
  - `pino` - Structured logging
  - `zod` - Schema validation
  - `uuid` - Generating trace IDs

## 🌃 Architecture

The notification worker is a critical component in the NIFYA notification pipeline:

1. **Message Reception**: Listens to the `notification-processor` PubSub subscription
2. **Message Validation**: Validates incoming messages against a schema
3. **Processor Selection**: Routes messages to the appropriate processor based on the `processor_type` field
4. **RLS Context Management**: Sets PostgreSQL Row-Level Security context for database operations
5. **Notification Creation**: Inserts notification records into the database with proper user context
6. **Error Handling**: Publishes failed messages to a Dead Letter Queue (DLQ) for investigation
7. **Health Monitoring**: Provides HTTP endpoints for health checks and diagnostics

## 🧑‍💻 Local Development

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and configure your environment variables:
```bash
# Database Configuration
export DB_NAME=nifya
export DB_USER=nifya
export DB_PASSWORD=your-password-here

# Google Cloud Configuration
export GOOGLE_CLOUD_PROJECT=your-project-id
export INSTANCE_CONNECTION_NAME=your-instance-connection

# PubSub Configuration
export PUBSUB_SUBSCRIPTION=notification-processor
export DLQ_TOPIC=notification-dlq
```

3. Start the service:
```bash
npm start
```

## 🧪 Testing

Run the test suite:
```bash
npm test
```

Run linting:
```bash
npm run lint
```

Format code:
```bash
npm run format
```

### Manual Testing

The service provides diagnostic endpoints for testing:

- **Health Check**: `GET /health` - Basic service health status
- **Database Diagnostics**: `GET /diagnostics/database?userId=YOUR_USER_ID` - Tests database connectivity and RLS functionality
- **Create Test Notification**: `POST /diagnostics/create-notification` - Creates a test notification with proper RLS context

Example test notification creation:
```bash
curl -X POST http://localhost:8080/diagnostics/create-notification \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "8bf705b5-2423-4257-92bd-ab0df1ee3218",
    "subscriptionId": "00000000-0000-0000-0000-000000000000",
    "title": "Test Notification",
    "content": "This is a test notification"
  }'
```

## 🐳 Docker Build

Build the container:
```bash
docker build -t notification-worker .
```

Run locally:
```bash
docker run -p 8080:8080 \
  --env-file .env \
  notification-worker
```

## 🚀 Cloud Run Deployment

Deploy to Cloud Run:

```bash
# Build and push container
gcloud builds submit --tag gcr.io/PROJECT_ID/notification-worker

# Deploy service
gcloud run deploy notification-worker \
  --image gcr.io/PROJECT_ID/notification-worker \
  --platform managed \
  --region us-central1 \
  --service-account notification-worker@PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars "PUBSUB_SUBSCRIPTION=notification-processor,DLQ_TOPIC=notification-dlq" \
  --set-secrets "DB_PASSWORD=projects/PROJECT_NUMBER/secrets/notification-worker-db-password/versions/latest" \
  --add-cloudsql-instances PROJECT_ID:REGION:INSTANCE_NAME

# Verify deployment
gcloud run services describe notification-worker \
  --platform managed --region us-central1
```

## 📊 Monitoring

Key metrics to monitor:

- **Messages processed per minute**: Rate of message processing
- **Processing success rate**: Percentage of successful vs. failed messages
- **Database operation latency**: Time taken for database operations
- **Error rate by type**: Breakdown of different error types
- **DLQ message count**: Number of messages sent to the Dead Letter Queue
- **Cloud Run instance count**: Number of instances running
- **CPU/Memory usage**: Resource utilization

The service logs detailed operational metrics that can be viewed in Cloud Logging.

## 💬 Message Format

The notification worker expects PubSub messages in the following format:

```json
{
  "version": "1.0",
  "processor_type": "boe",
  "timestamp": "2023-04-10T14:30:00Z",
  "trace_id": "c4e01a9b-5c1d-4b5e-8b4a-3e9f0e8c2d7a",
  "request": {
    "subscription_id": "550e8400-e29b-41d4-a716-446655440000",
    "processing_id": "7a1b9c8d-6e5f-4d3c-2b1a-0c9d8e7f6a5b",
    "user_id": "123e4567-e89b-12d3-a456-426614174000",
    "prompts": ["subvenciones agricultura", "ayudas ganadería"]
  },
  "results": {
    "query_date": "2023-04-10",
    "matches": [
      {
        "prompt": "subvenciones agricultura",
        "documents": [
          {
            "document_type": "resolution",
            "title": "Resolución de ayudas al sector agrícola",
            "summary": "Convocatoria de subvenciones para agricultores...",
            "relevance_score": 0.92,
            "links": {
              "html": "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2023-12345",
              "pdf": "https://www.boe.es/boe/dias/2023/04/10/pdfs/BOE-A-2023-12345.pdf"
            }
          }
        ]
      }
    ]
  }
}
```

## 🔍 Troubleshooting

Common issues and solutions:

1. **Message Processing Failures**
   - Check message format against expected schema
   - Verify database connection and credentials
   - Ensure Cloud SQL proxy is working
   - Review error logs in Cloud Logging

2. **Database Connection Issues**
   - Verify connection string and credentials
   - Check IAM permissions for the service account
   - Review connection pool settings
   - Verify RLS policies are properly configured

3. **PubSub Subscription Issues**
   - Verify subscription exists and is properly configured
   - Check IAM roles for the service account
   - Review message retention settings
   - Validate service account permissions

4. **Cloud Run Issues**
   - Check instance logs in Cloud Logging
   - Verify memory and CPU limits are sufficient
   - Check service account permissions
   - Examine container startup logs

## 📂 Project Structure

```
.
├── src/
│   ├── database/
│   │   └── client.js       # Database connection and RLS handling
│   ├── processors/
│   │   ├── boe.js          # BOE notification processor
│   │   └── real-estate.js  # Real estate notification processor
│   ├── services/
│   │   └── notification.js # Notification creation service with RLS support
│   ├── types/
│   │   └── message.js      # TypeScript-like schema definitions
│   ├── utils/
│   │   ├── logger.js       # Structured logging utilities
│   │   └── validation.js   # Message validation schemas
│   └── index.js            # Service entry point and HTTP server
├── Dockerfile              # Container definition
├── package.json            # Dependencies and scripts
├── .env.example            # Example environment variables
└── test-diagnostics.js     # Diagnostic test script
```

## 🔒 Security Considerations

The notification worker implements several security measures:

1. **Row-Level Security (RLS)**: Sets the PostgreSQL `app.current_user_id` session variable to ensure notifications are only accessible by their owners.

2. **UUID Validation**: Validates user IDs against a UUID regex pattern before using them in database queries.

3. **Environment Variables**: Uses environment variables and Cloud Secret Manager for sensitive configuration.

4. **Service Account**: Runs with a dedicated service account with minimal required permissions.

5. **Input Validation**: Validates all incoming messages against a schema before processing.

## 📋 Integration with NIFYA Platform

The notification worker integrates with other NIFYA services:

1. **Subscription Worker**: Receives processed subscription results via PubSub.

2. **Frontend**: Creates notifications that are displayed to users in the dashboard.

3. **Backend API**: Shares the database with the main backend API.

4. **Email Service**: Publishes events for email notifications.

## 📝 License

This project is proprietary software. All rights reserved.
