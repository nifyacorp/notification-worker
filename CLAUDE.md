# NIFYA Notification Worker

## Overview

The Notification Worker service processes messages from various NIFYA parsers (BOE, DOGA, etc.) and creates user notifications. It supports a unified message format and maintains backward compatibility with legacy formats.

## Architecture

The service consists of the following key components:

1. **PubSub Integration**: Listens for new notification messages on a Cloud PubSub subscription.
2. **Unified Parser**: Processes messages from any source using a common parser implementation.
3. **Database Integration**: Stores notifications in PostgreSQL with proper Row-Level Security (RLS).
4. **Email Notification**: Publishes to email topics for immediate and daily digest emails.
5. **Realtime Notification**: Triggers realtime notifications for frontend updates.

## Code Organization

The codebase has been refactored to use a unified approach:

1. **Unified Parser**: All parser logic is now centralized in `src/services/parser.js`
2. **Type System**: All type definitions use a common schema in `src/types/parser.js`
3. **Message Processing**: The processors now use a single implementation with source-specific adapters
4. **Backward Compatibility**: Legacy adapters ensure existing code continues to work

The refactoring has eliminated redundant code and improved maintainability while ensuring all functionality works with both new and legacy message formats.

## Database Interaction

The service interacts with two primary tables:

1. **notifications**: Stores notifications created from processing messages
   - Key fields populated: user_id, subscription_id, title, content, source_url, source, data, metadata, entity_type
   - The service maps PubSub message contents to the appropriate notification fields

2. **subscription_processing**: Tracks transient processing states
   - Once notifications are created successfully for a subscription, the corresponding processing record is deleted
   - This cleanup prevents duplicate processing and maintains a clean state

## Message Format

The standard message format is:

```json
{
  "trace_id": "unique-trace-id",
  "request": {
    "texts": ["User query 1", "User query 2"],
    "subscription_id": "user_subscription_id",
    "user_id": "user_id"
  },
  "results": {
    "boe_info": {
      "issue_number": "123",
      "publication_date": "2025-04-15",
      "source_url": "https://www.boe.es/datosabiertos/api/boe/sumario/20250415"
    },
    "query_date": "2025-04-15",
    "results": [
      {
        "prompt": "User query 1",
        "matches": [
          {
            "document_type": "RESOLUTION",
            "title": "Original BOE title",
            "notification_title": "Optimized notification title",
            "issuing_body": "Issuing organization",
            "summary": "Brief summary of relevance",
            "relevance_score": 85,
            "links": {
              "html": "HTML URL",
              "pdf": "PDF URL"
            }
          }
        ],
        "metadata": {
          "processing_time_ms": 1200,
          "model_used": "gemini-2.0-flash-lite",
          "token_usage": {
            "input_tokens": 12000,
            "output_tokens": 500,
            "total_tokens": 12500
          }
        }
      }
    ]
  },
  "metadata": {
    "processing_time_ms": 1200,
    "total_items_processed": 50,
    "status": "success"
  }
}
```

## Message to Database Mapping

| Message Field | Database Column | Notes |
|---------------|----------------|-------|
| request.user_id | user_id | User who owns the notification |
| request.subscription_id | subscription_id | Related subscription |
| match.notification_title / match.title | title | Optimized title for display |
| match.summary | content | Main notification content |
| match.links.html | source_url | URL to source document |
| processor_type / source | source | Source system (boe, doga, etc.) |
| document details | data | JSON with document metadata |
| processing details | metadata | JSON with processing metadata |
| match.document_type | entity_type | Type of document as entity |

## Key Components

- `src/services/parser.js`: Unified message parser for all notification formats
- `src/processors/message-processor.js`: Unified message processor
- `src/processors/index.js`: Adapters for backward compatibility
- `src/database/client.js`: Database connection and query handling
- `src/types/parser.js`: Common type definitions for all parsers

## Configuration

Environment variables:
- `PUBSUB_SUBSCRIPTION`: PubSub subscription to listen for notification messages
- `DLQ_TOPIC`: Dead Letter Queue topic for failed messages
- `EMAIL_IMMEDIATE_TOPIC`: Topic for immediate email notifications
- `EMAIL_DAILY_TOPIC`: Topic for daily digest email notifications
- Database configuration is handled through Secret Manager or environment variables

## Build Commands
- `npm start` - Run the service in production mode
- `npm run lint` - Check code for style issues with ESLint
- `npm run format` - Automatically format code with Prettier
- `npm test` - Run tests with Vitest
- Single Test: `npx vitest run <test-file-path>`
- Dev Test: `npx vitest <test-file-name> --watch`

## Code Style Guidelines
- **Type System**: Use Zod schemas for validation with explicit error handling
- **Imports**: External first, then internal grouped by functionality
- **Exports**: Use named exports for clarity (avoid default exports)
- **Naming**: camelCase for functions/variables, UPPER_CASE for constants
- **Error Handling**: Structured error objects with context for logging
- **Formatting**: 2-space indent, standard Prettier config
- **Logging**: Use structured logging with context object containing request IDs
- **Database**: Always set RLS context and use parameterized queries
- **Fallbacks**: Implement exponential backoff for external service retries

## Resilience Guidelines
- Handle database connection failures with automatic retries
- Validate all incoming messages before processing
- Include detailed context in error logs for troubleshooting
- Sanitize and validate user input before processing or storage
- Always release database clients after use with client.release()

## Testing

The service includes testing utilities:
- `test-notification-processor.js`: Tests the notification processor with various message formats
- `test-message-processing.js`: Tests the complete flow including subscription processing cleanup