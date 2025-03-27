#!/bin/bash
# NIFYA Notification Worker - Create Missing DLQ Topics Script
#
# This script creates the required Dead Letter Queue topics for the notification worker.
# It requires the Google Cloud CLI to be installed and authenticated.

set -e  # Exit immediately if any command fails

# Color codes for prettier output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}NIFYA Notification Worker - Creating DLQ Topics${NC}"
echo -e "${BLUE}=========================================${NC}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: Google Cloud CLI (gcloud) is not installed or not in PATH.${NC}"
    echo -e "${YELLOW}Please install it from: https://cloud.google.com/sdk/docs/install${NC}"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with Google Cloud.${NC}"
    echo -e "${YELLOW}Please run: gcloud auth login${NC}"
    exit 1
fi

# Get current project
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: No Google Cloud project selected.${NC}"
    echo -e "${YELLOW}Please run: gcloud config set project YOUR_PROJECT_ID${NC}"
    exit 1
fi

echo -e "${YELLOW}Using Google Cloud Project: ${PROJECT_ID}${NC}"

# DLQ topic names
NOTIFICATION_DLQ="notification-dlq"
PROCESSOR_RESULTS_DLQ="processor-results-dlq"

# Check if topics exist already
echo -e "\n${BLUE}Checking for existing DLQ topics...${NC}"

TOPICS=$(gcloud pubsub topics list --project=$PROJECT_ID --format="value(name)")

if echo "$TOPICS" | grep -q "$NOTIFICATION_DLQ"; then
    echo -e "${YELLOW}Topic ${NOTIFICATION_DLQ} already exists.${NC}"
    NOTIFICATION_DLQ_EXISTS=true
else
    echo -e "${YELLOW}Topic ${NOTIFICATION_DLQ} does not exist. Will create.${NC}"
    NOTIFICATION_DLQ_EXISTS=false
fi

if echo "$TOPICS" | grep -q "$PROCESSOR_RESULTS_DLQ"; then
    echo -e "${YELLOW}Topic ${PROCESSOR_RESULTS_DLQ} already exists.${NC}"
    PROCESSOR_DLQ_EXISTS=true
else
    echo -e "${YELLOW}Topic ${PROCESSOR_RESULTS_DLQ} does not exist. Will create.${NC}"
    PROCESSOR_DLQ_EXISTS=false
fi

# Create notification-dlq if needed
if [ "$NOTIFICATION_DLQ_EXISTS" = false ]; then
    echo -e "\n${BLUE}Creating topic: ${NOTIFICATION_DLQ}...${NC}"
    gcloud pubsub topics create $NOTIFICATION_DLQ --project=$PROJECT_ID
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Successfully created topic: ${NOTIFICATION_DLQ}${NC}"
    else
        echo -e "${RED}Failed to create topic: ${NOTIFICATION_DLQ}${NC}"
        exit 1
    fi
fi

# Create processor-results-dlq if needed
if [ "$PROCESSOR_DLQ_EXISTS" = false ]; then
    echo -e "\n${BLUE}Creating topic: ${PROCESSOR_RESULTS_DLQ}...${NC}"
    gcloud pubsub topics create $PROCESSOR_RESULTS_DLQ --project=$PROJECT_ID
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Successfully created topic: ${PROCESSOR_RESULTS_DLQ}${NC}"
    else
        echo -e "${RED}Failed to create topic: ${PROCESSOR_RESULTS_DLQ}${NC}"
        exit 1
    fi
fi

# Verify topic creation
echo -e "\n${BLUE}Verifying DLQ topic creation...${NC}"
CREATED_TOPICS=$(gcloud pubsub topics list --project=$PROJECT_ID --format="value(name)")

if echo "$CREATED_TOPICS" | grep -q "$NOTIFICATION_DLQ"; then
    echo -e "${GREEN}✅ Topic ${NOTIFICATION_DLQ} verified.${NC}"
else
    echo -e "${RED}❌ Topic ${NOTIFICATION_DLQ} verification failed!${NC}"
fi

if echo "$CREATED_TOPICS" | grep -q "$PROCESSOR_RESULTS_DLQ"; then
    echo -e "${GREEN}✅ Topic ${PROCESSOR_RESULTS_DLQ} verified.${NC}"
else
    echo -e "${RED}❌ Topic ${PROCESSOR_RESULTS_DLQ} verification failed!${NC}"
fi

echo -e "\n${GREEN}DLQ topic setup completed successfully.${NC}"
echo -e "${BLUE}These topics will be used by the notification worker for handling failed messages.${NC}"
echo -e "${YELLOW}Make sure to update environment variables if they're using different topic names:${NC}"
echo "- PUBSUB_DLQ_TOPIC_NAME"
echo "- DLQ_TOPIC"