#!/bin/bash

# Script to create the required DLQ topics for the notification pipeline
# This addresses the NOTIFICATION-PIPELINE-CONCLUSIONS.md issues

# Set your project ID (this should match the environment variable in your services)
PROJECT_ID="415554190254"

# Create the notification DLQ topic (missing according to error logs)
echo "Creating notification-dlq topic..."
gcloud pubsub topics create notification-dlq --project=$PROJECT_ID

# Verify creation
echo "Verifying topic creation..."
gcloud pubsub topics list --filter=name:notification-dlq --project=$PROJECT_ID

# Create the processor-results-dlq topic (if missing)
echo "Creating processor-results-dlq topic..."
gcloud pubsub topics create processor-results-dlq --project=$PROJECT_ID

# Verify creation
echo "Verifying topic creation..."
gcloud pubsub topics list --filter=name:processor-results-dlq --project=$PROJECT_ID

echo "DLQ Topics created successfully!"
echo "Next steps:"
echo "1. Verify the schemas in the BOE Parser match what the Notification Worker expects"
echo "2. Verify the error handling in the Notification Worker is working properly"
echo "3. Restart both services to apply changes"