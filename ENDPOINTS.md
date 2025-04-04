# Notification Worker API Endpoints

This document provides information about the endpoints available in the Notification Worker service.

## Overview

The Notification Worker is a microservice in the NIFYA platform responsible for:

1. Consuming parser results from PubSub
2. Processing results into notifications
3. Saving notifications to the database
4. Providing diagnostic endpoints for troubleshooting

## Base URL

Production: `https://notification-worker-415554190254.us-central1.run.app`

## Authentication

- Most endpoints require authentication with an API key or service account
- The API key should be provided in the `x-api-key` header
- Internal service-to-service communication uses service accounts

## Endpoints

### Health Check

```
GET /health
```

Returns the health status of the service.

#### Response

```json
{
  "status": "ok",
  "service": "notification-worker",
  "version": "1.0.0",
  "uptime": "1d 2h 34m",
  "dependencies": {
    "database": "connected",
    "pubsub": "connected"
  }
}
```

### Diagnostic Endpoints

#### Get Service Information

```
GET /info
```

Returns information about the service configuration and environment.

**Authentication Required**: Yes (API Key)

#### Response

```json
{
  "service": "notification-worker",
  "version": "1.0.0",
  "environment": "production",
  "nodeVersion": "v18.15.0",
  "processors": ["boe", "real-estate"],
  "pubsubTopics": {
    "input": "parser-results",
    "deadLetter": "notification-worker-dlq"
  }
}
```

#### Debug Notifications

```
GET /debug/notifications
```

Returns recent notifications processed by the service for debugging purposes.

**Authentication Required**: Yes (API Key)

**Query Parameters**:
- `limit` (optional): Number of notifications to return (default: 10)
- `userId` (optional): Filter by user ID
- `subscriptionId` (optional): Filter by subscription ID

#### Response

```json
{
  "notifications": [
    {
      "id": "12345",
      "userId": "user123",
      "subscriptionId": "sub456",
      "title": "BOE Notification",
      "content": "Matched content for your BOE subscription",
      "entityId": "boe-2025-04-01-1",
      "entityType": "boe",
      "created_at": "2025-04-01T10:15:20Z",
      "metadata": {
        "processingTime": 1200,
        "matchConfidence": 0.85
      }
    },
    // Additional notifications...
  ],
  "count": 10,
  "hasMore": true
}
```

#### Process Message Manually

```
POST /debug/process-message
```

Manually process a PubSub message for testing.

**Authentication Required**: Yes (API Key)

**Request Body**:

```json
{
  "message": {
    "data": "BASE64_ENCODED_MESSAGE_DATA",
    "attributes": {
      "type": "boe",
      "userId": "user123",
      "subscriptionId": "sub456"
    }
  }
}
```

#### Response

```json
{
  "success": true,
  "processingResult": {
    "notifications": 2,
    "errors": 0,
    "processingTimeMs": 543
  }
}
```

### PubSub Receipt Endpoint

```
POST /pubsub/receive
```

Endpoint that receives PubSub push notifications.

**Authentication**: Cloud Run service-to-service authentication

**Request Body** (from PubSub):

```json
{
  "message": {
    "data": "BASE64_ENCODED_MESSAGE_DATA",
    "messageId": "12345",
    "publishTime": "2025-04-01T09:00:00.000Z",
    "attributes": {
      "type": "boe",
      "userId": "user123",
      "subscriptionId": "sub456"
    }
  },
  "subscription": "projects/my-project/subscriptions/parser-results-sub"
}
```

#### Response

```json
{
  "success": true
}
```

### Notification Management

#### Check Processing Status

```
GET /notifications/status/{jobId}
```

Check the status of a notification processing job.

**Authentication Required**: Yes (API Key)

**Path Parameters**:
- `jobId`: The job ID to check

#### Response

```json
{
  "status": "completed",
  "jobId": "job123",
  "processed": 5,
  "errors": 0,
  "completedAt": "2025-04-01T10:30:00Z",
  "notifications": [
    "notif123",
    "notif124",
    "notif125"
  ]
}
```

#### Retry Failed Notifications

```
POST /notifications/retry
```

Retry processing failed notifications from the dead letter queue.

**Authentication Required**: Yes (API Key)

**Request Body**:

```json
{
  "messageIds": ["msg123", "msg124"],
  "force": false
}
```

#### Response

```json
{
  "success": true,
  "retriedCount": 2,
  "results": {
    "succeeded": 1,
    "failed": 1,
    "errors": [
      {
        "messageId": "msg124",
        "error": "Invalid message format"
      }
    ]
  }
}
```

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request

```json
{
  "error": "Bad Request",
  "message": "Missing required field: userId",
  "code": "VALIDATION_ERROR"
}
```

### 401 Unauthorized

```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid API key",
  "code": "AUTHENTICATION_ERROR"
}
```

### 403 Forbidden

```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions for this operation",
  "code": "PERMISSION_ERROR"
}
```

### 404 Not Found

```json
{
  "error": "Not Found",
  "message": "Job not found: job123",
  "code": "RESOURCE_NOT_FOUND"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "code": "INTERNAL_ERROR",
  "requestId": "req123"
}
```

## Testing

To test the Notification Worker API:

1. Use the `/health` endpoint to verify service availability
2. Use the `/debug/process-message` endpoint to test message processing
3. Check logs for detailed processing information

## Related Documentation

- [PubSub Structure](../docs/pubsub-structure.md)
- [Subscription Processing Flow](../SUBSCRIPTION-PROCESSING-FLOW.md)
- [Notification Worker README](./README.md)