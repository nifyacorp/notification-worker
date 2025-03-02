#!/bin/bash

# Exit on any error
set -e

echo "Building and deploying notification-worker..."

# Set project variables
PROJECT_ID="delta-entity-447812-p2"
REGION="us-central1"
SERVICE_NAME="notification-worker"

# Build and push the container image
gcloud builds submit --tag gcr.io/${PROJECT_ID}/${SERVICE_NAME}

# Deploy to Cloud Run
gcloud run deploy ${SERVICE_NAME} \
  --image gcr.io/${PROJECT_ID}/${SERVICE_NAME} \
  --platform managed \
  --region ${REGION} \
  --project ${PROJECT_ID} \
  --allow-unauthenticated

echo "Deployment complete! Service should be available at:"
echo "https://${SERVICE_NAME}-415554190254.${REGION}.run.app" 