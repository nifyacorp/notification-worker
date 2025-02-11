# Nifya Notification Worker

A Cloud Run service that processes notifications from various content processors (BOE, Real Estate, etc.) and creates user notifications in the database.

## 🚀 Features

- Processes PubSub messages from content processors
- Creates user notifications in the database
- Handles multiple content types (BOE, Real Estate)
- Error handling and DLQ support
- Structured logging with Pino
- Message validation using Zod

## 🛠 Tech Stack

- **Runtime**: Node.js 20
- **Database**: PostgreSQL (shared with main service)
- **Cloud Services**:
  - Cloud Run (service hosting)
  - Cloud Pub/Sub (message processing)
  - Cloud SQL (PostgreSQL hosting)
- **Libraries**:
  - `@google-cloud/pubsub` - PubSub client
  - `pg` - PostgreSQL client
  - `pino` - Logging
  - `zod` - Schema validation

## 📋 Prerequisites

- Google Cloud project with:
  - Cloud Run enabled
  - Cloud Pub/Sub enabled
  - Cloud SQL configured
- Node.js 20+
- Docker (for local development)

## 🏃‍♂️ Local Development

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
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

## 🚀 Deployment

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
  --set-env-vars "PUBSUB_SUBSCRIPTION=notification-processor"
```

## 📊 Monitoring

Key metrics to monitor:
- Messages processed per minute
- Processing success rate
- Database operation latency
- Error rate by type
- DLQ message count

## 🐛 Troubleshooting

Common issues and solutions:

1. Message Processing Failures
   - Check message format against schema
   - Verify database connection
   - Review error logs

2. Database Connection Issues
   - Verify connection string
   - Check IAM permissions
   - Review connection pool settings

3. PubSub Subscription Issues
   - Verify subscription exists
   - Check IAM roles
   - Review message retention

## 📁 Project Structure

```
.
├── src/
│   ├── database/
│   │   └── client.js       # Database connection
│   ├── processors/
│   │   ├── boe.js         # BOE notification processor
│   │   └── real-estate.js # Real estate notification processor
│   ├── services/
│   │   └── notification.js # Notification creation service
│   ├── utils/
│   │   ├── logger.js      # Logging utilities
│   │   └── validation.js  # Message validation
│   └── index.js           # Service entry point
├── Dockerfile
└── package.json
```

## 📄 License

Private and confidential. All rights reserved.