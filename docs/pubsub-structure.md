# NIFYA PubSub Message Schema Documentation

This document defines the standardized message schema used for communication between NIFYA services, specifically between parser services (BOE parser, DOGA parser) and the notification worker.

## Schema Overview

All PubSub messages follow a consistent structure to ensure compatibility between services. This schema is enforced using Zod validation in the notification-worker service.

## Common Message Structure

```typescript
{
  "version": string,               // Message schema version (e.g. "1.0")
  "trace_id": string,              // Unique ID for tracing/debugging
  "processor_type": string,        // "boe", "doga", etc.
  "timestamp": string,             // ISO-8601 timestamp
  
  "request": {
    "subscription_id": string,     // UUID of the subscription
    "user_id": string,             // UUID of the user
    "processing_id": string,       // Unique ID for this processing request
    "prompts": string[]            // Array of user prompts
  },
  
  "results": {
    "query_date": string,          // Date of the query (YYYY-MM-DD)
    "matches": Match[]             // Array of match objects (see below)
  },
  
  "metadata": {
    "processing_time_ms": number,  // Processing time in milliseconds
    "total_items_processed": number, // Number of items processed
    "total_matches": number,       // Number of matches found
    "model_used": string,          // AI model used for processing
    "status": "success" | "error", // Processing status
    "error": string | null         // Error message if status is "error"
  }
}
```

## Match Object (Generic)

```typescript
{
  "prompt": string,                // User prompt that generated this match
  "documents": Document[]          // Array of document objects
}
```

## Document Object (Generic)

```typescript
{
  "document_type": string,         // Type of document
  "title": string,                 // Document title
  "summary": string,               // Document summary
  "relevance_score": number,       // Relevance score (0-1)
  "links": {
    "html": string,                // URL to HTML version
    "pdf": string                  // URL to PDF version (optional)
  }
}
```

## BOE-specific Document Fields

```typescript
{
  // All generic document fields +
  "document_type": "boe_document", // Must be "boe_document"
  "publication_date": string,      // ISO-8601 date
  "section": string,               // BOE section
  "bulletin_type": string          // Bulletin type
}
```

## Complete BOE Message Example

```json
{
  "version": "1.0",
  "trace_id": "47e47250-00e0-4502-90ed-031e23dcc222",
  "processor_type": "boe",
  "timestamp": "2025-03-26T07:49:40.330Z",
  
  "request": {
    "subscription_id": "bbcde7bb-bc04-4a0b-8c47-01682a31cc15",
    "user_id": "65c6074d-dbc4-4091-8e45-b6aecffd9ab9",
    "processing_id": "20b3ed68-4db3-461f-9815-793beac65e8f",
    "prompts": ["quiero ser funcionario"]
  },
  
  "results": {
    "query_date": "2025-03-26",
    "matches": [
      {
        "prompt": "quiero ser funcionario",
        "documents": [
          {
            "document_type": "boe_document",
            "title": "Convocatoria oposiciones administrativo",
            "notification_title": "Convocatoria oposiciones",
            "issuing_body": "Ministerio de Hacienda",
            "summary": "Convocatoria de oposiciones para el cuerpo de administrativos",
            "relevance_score": 0.95,
            "links": {
              "html": "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-1234",
              "pdf": "https://www.boe.es/boe/dias/2025/03/26/pdfs/BOE-A-2025-1234.pdf"
            },
            "publication_date": "2025-03-26T00:00:00.000Z",
            "section": "II.B",
            "bulletin_type": "BOE"
          }
        ]
      }
    ]
  },
  
  "metadata": {
    "processing_time_ms": 1969,
    "total_items_processed": 1936,
    "total_matches": 1,
    "model_used": "gemini-2.0-pro-exp-02-05",
    "status": "success",
    "error": null
  }
}
```

## Empty Match Example (No Results Found)

```json
{
  "version": "1.0",
  "trace_id": "47e47250-00e0-4502-90ed-031e23dcc222",
  "processor_type": "boe",
  "timestamp": "2025-03-26T07:49:40.330Z",
  
  "request": {
    "subscription_id": "bbcde7bb-bc04-4a0b-8c47-01682a31cc15",
    "user_id": "65c6074d-dbc4-4091-8e45-b6aecffd9ab9",
    "processing_id": "20b3ed68-4db3-461f-9815-793beac65e8f",
    "prompts": ["quiero ser funcionario"]
  },
  
  "results": {
    "query_date": "2025-03-26",
    "matches": [
      {
        "prompt": "quiero ser funcionario",
        "documents": []
      }
    ]
  },
  
  "metadata": {
    "processing_time_ms": 1969,
    "total_items_processed": 1936,
    "total_matches": 0,
    "model_used": "gemini-2.0-pro-exp-02-05",
    "status": "success",
    "error": null
  }
}
```

## Implementation Notes

1. **Validation**: The notification-worker validates incoming messages using Zod schemas defined in `notification-worker/src/types/boe.js` and `notification-worker/src/types/messages.js`.

2. **Error Handling**: If a message fails validation, the notification-worker will still attempt to process it with best-effort, but will log warnings.

3. **Required Fields**: The most critical fields that must be present:
   - `processor_type`
   - `request.user_id`
   - `request.subscription_id`
   - `results.matches` (array, can be empty)

4. **DLQ**: Messages that cannot be processed will be sent to a Dead Letter Queue (DLQ).

## Services Implementation

### BOE Parser (`boe-parser/src/utils/pubsub.js`)
The BOE parser formats messages according to this schema in the `publishResults` function.

### Notification Worker (`notification-worker/src/types/boe.js`)
The notification worker validates messages against this schema using Zod validation in `validateMessage`.

## Schema Changes

Any changes to this message schema must be coordinated between all services:

1. Update the schema definition in `notification-worker/src/types/boe.js`
2. Update the message construction in `boe-parser/src/utils/pubsub.js`
3. Update this documentation
4. Update tests for both services

**IMPORTANT**: Breaking changes should be versioned to maintain backward compatibility.