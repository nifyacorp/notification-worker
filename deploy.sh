#!/bin/bash
# Deployment script for Notification Worker service

# Exit on any error
set -e

# Configuration
PROJECT_ID=${GOOGLE_CLOUD_PROJECT:-"delta-entity-447812-p2"}
REGION=${REGION:-"us-central1"}
SERVICE_NAME=${SERVICE_NAME:-"notification-worker"}
PUBSUB_SUBSCRIPTION=${PUBSUB_SUBSCRIPTION:-"notification-processor"}
DLQ_TOPIC=${DLQ_TOPIC:-"notification-dlq"}
EMAIL_IMMEDIATE_TOPIC=${EMAIL_IMMEDIATE_TOPIC:-"email-notifications-immediate"}
EMAIL_DAILY_TOPIC=${EMAIL_DAILY_TOPIC:-"email-notifications-daily"}

# Display banner
echo "=============================================="
echo "  Notification Worker Deployment"
echo "=============================================="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo "Subscription: $PUBSUB_SUBSCRIPTION"
echo "DLQ Topic: $DLQ_TOPIC"
echo "=============================================="

# Ensure gcloud is configured correctly
echo "Checking gcloud configuration..."
CURRENT_PROJECT=$(gcloud config get-value project)
if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
  echo "Setting project to $PROJECT_ID"
  gcloud config set project $PROJECT_ID
fi

# Check if user wants to continue
read -p "Continue with deployment? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Deployment cancelled"
  exit 1
fi

# Build and tag the Docker image
echo "Building Docker image..."
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME:$(git rev-parse --short HEAD)"
docker build -t $IMAGE_NAME .

# Push the image to Google Container Registry
echo "Pushing image to Container Registry..."
docker push $IMAGE_NAME

# Create or update PubSub resources
echo "Setting up PubSub resources..."

# Check if DLQ topic exists, create if not
if ! gcloud pubsub topics describe $DLQ_TOPIC &>/dev/null; then
  echo "Creating Dead Letter Queue topic: $DLQ_TOPIC"
  gcloud pubsub topics create $DLQ_TOPIC
else
  echo "Dead Letter Queue topic already exists: $DLQ_TOPIC"
fi

# Check if email topics exist, create if not
for TOPIC in $EMAIL_IMMEDIATE_TOPIC $EMAIL_DAILY_TOPIC; do
  if ! gcloud pubsub topics describe $TOPIC &>/dev/null; then
    echo "Creating topic: $TOPIC"
    gcloud pubsub topics create $TOPIC
  else
    echo "Topic already exists: $TOPIC"
  fi
done

# Check if subscription exists, create if not
TOPIC_NAME=$(echo $PUBSUB_SUBSCRIPTION | sed 's/-subscription$//')
if ! gcloud pubsub subscriptions describe $PUBSUB_SUBSCRIPTION &>/dev/null; then
  echo "Creating subscription: $PUBSUB_SUBSCRIPTION for topic: $TOPIC_NAME"
  gcloud pubsub subscriptions create $PUBSUB_SUBSCRIPTION \
    --topic=$TOPIC_NAME \
    --ack-deadline=60 \
    --message-retention-duration=7d \
    --min-retry-delay=10s \
    --max-retry-delay=600s \
    --dead-letter-topic=$DLQ_TOPIC \
    --max-delivery-attempts=5
else
  echo "Subscription already exists: $PUBSUB_SUBSCRIPTION"
fi

# Deploy to Cloud Run
echo "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image=$IMAGE_NAME \
  --platform=managed \
  --region=$REGION \
  --memory=512Mi \
  --cpu=1 \
  --concurrency=50 \
  --timeout=60s \
  --set-env-vars="NODE_ENV=production,PUBSUB_SUBSCRIPTION=$PUBSUB_SUBSCRIPTION,DLQ_TOPIC=$DLQ_TOPIC,EMAIL_IMMEDIATE_TOPIC=$EMAIL_IMMEDIATE_TOPIC,EMAIL_DAILY_TOPIC=$EMAIL_DAILY_TOPIC" \
  --add-cloudsql-instances="$PROJECT_ID:$REGION:nifya-db" \
  --service-account="notification-worker@$PROJECT_ID.iam.gserviceaccount.com" \
  --allow-unauthenticated

# Output deployment info
echo "=============================================="
echo "Deployment completed successfully!"
echo "=============================================="
echo "Service URL: $(gcloud run services describe $SERVICE_NAME --platform=managed --region=$REGION --format='value(status.url)')"
echo "Verify the service is running by checking health endpoint:"
echo "curl $(gcloud run services describe $SERVICE_NAME --platform=managed --region=$REGION --format='value(status.url)')/health"
echo "=============================================="