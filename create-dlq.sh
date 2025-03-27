#!/bin/bash
# Script to create the missing DLQ topic for the notification pipeline
# This script requires the Google Cloud SDK to be installed

# Print colored output
function print_info() {
  echo -e "\033[1;34m[INFO]\033[0m $1"
}

function print_success() {
  echo -e "\033[1;32m[SUCCESS]\033[0m $1"
}

function print_error() {
  echo -e "\033[1;31m[ERROR]\033[0m $1"
}

function print_warning() {
  echo -e "\033[1;33m[WARNING]\033[0m $1"
}

# Get the project ID from gcloud config
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
  print_error "No project ID found in gcloud config. Please set a project first with:"
  print_error "gcloud config set project YOUR-PROJECT-ID"
  exit 1
fi

print_info "Creating DLQ topics for notification pipeline in project: $PROJECT_ID"

# Create notification-dlq topic
print_info "Creating notification-dlq topic..."
NOTIFICATION_DLQ_RESULT=$(gcloud pubsub topics create notification-dlq --project=$PROJECT_ID 2>&1)
NOTIFICATION_DLQ_EXIT_CODE=$?

if [ $NOTIFICATION_DLQ_EXIT_CODE -eq 0 ]; then
  print_success "Successfully created notification-dlq topic"
elif [[ $NOTIFICATION_DLQ_RESULT == *"Resource already exists"* ]]; then
  print_warning "notification-dlq topic already exists"
else
  print_error "Failed to create notification-dlq topic: $NOTIFICATION_DLQ_RESULT"
  exit 1
fi

# Create processor-results-dlq topic (for BOE parser)
print_info "Creating processor-results-dlq topic..."
PROCESSOR_DLQ_RESULT=$(gcloud pubsub topics create processor-results-dlq --project=$PROJECT_ID 2>&1)
PROCESSOR_DLQ_EXIT_CODE=$?

if [ $PROCESSOR_DLQ_EXIT_CODE -eq 0 ]; then
  print_success "Successfully created processor-results-dlq topic"
elif [[ $PROCESSOR_DLQ_RESULT == *"Resource already exists"* ]]; then
  print_warning "processor-results-dlq topic already exists"
else
  print_error "Failed to create processor-results-dlq topic: $PROCESSOR_DLQ_RESULT"
  exit 1
fi

# Create a short-term subscription for the DLQ topics to monitor them
print_info "Creating monitoring subscription for notification-dlq topic..."
NOTIFICATION_SUB_RESULT=$(gcloud pubsub subscriptions create notification-dlq-monitor \
  --topic=notification-dlq \
  --message-retention-duration=7d \
  --project=$PROJECT_ID 2>&1)
NOTIFICATION_SUB_EXIT_CODE=$?

if [ $NOTIFICATION_SUB_EXIT_CODE -eq 0 ]; then
  print_success "Successfully created notification-dlq-monitor subscription"
elif [[ $NOTIFICATION_SUB_RESULT == *"Resource already exists"* ]]; then
  print_warning "notification-dlq-monitor subscription already exists"
else
  print_error "Failed to create monitoring subscription: $NOTIFICATION_SUB_RESULT"
fi

print_info "Creating monitoring subscription for processor-results-dlq topic..."
PROCESSOR_SUB_RESULT=$(gcloud pubsub subscriptions create processor-results-dlq-monitor \
  --topic=processor-results-dlq \
  --message-retention-duration=7d \
  --project=$PROJECT_ID 2>&1)
PROCESSOR_SUB_EXIT_CODE=$?

if [ $PROCESSOR_SUB_EXIT_CODE -eq 0 ]; then
  print_success "Successfully created processor-results-dlq-monitor subscription"
elif [[ $PROCESSOR_SUB_RESULT == *"Resource already exists"* ]]; then
  print_warning "processor-results-dlq-monitor subscription already exists"
else
  print_error "Failed to create monitoring subscription: $PROCESSOR_SUB_RESULT"
fi

print_success "DLQ topics and monitoring subscriptions created successfully!"
print_info "To view dead-letter messages, use:"
print_info "gcloud pubsub subscriptions pull --auto-ack notification-dlq-monitor"
print_info "gcloud pubsub subscriptions pull --auto-ack processor-results-dlq-monitor"