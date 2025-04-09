# Notification Message Schema

This document defines the standardized message format that all parsers should use when publishing notifications to the Notification Worker service.

## Message Format

All parsers (BOE Parser, DOGA Parser, Real Estate Parser, etc.) should adhere to this schema when publishing messages to the `processor-results` PubSub topic.

```json
{
  "version": "1.0",
  "processor_type": "boe|doga|real-estate",
  "timestamp": "2023-04-01T12:00:00.000Z",
  "trace_id": "unique-trace-id-for-tracking",
  "request": {
    "subscription_id": "uuid-of-the-subscription",
    "processing_id": "unique-id-for-this-processing-run",
    "user_id": "uuid-of-the-user",
    "prompts": ["Prompt text used for this search"]
  },
  "results": {
    "query_date": "2023-04-01",
    "matches": [
      {
        "prompt": "Prompt text that produced these matches",
        "documents": [
          {
            "document_type": "boe_document|doga_document|property",
            "title": "Document title",
            "notification_title": "Title to display in notification",
            "summary": "Summary text for the notification",
            "relevance_score": 0.95,
            "links": {
              "html": "https://url-to-original-document.html",
              "pdf": "https://url-to-pdf-version.pdf"
            },
            "publication_date": "2023-04-01T12:00:00.000Z",
            "section": "Document section or category",
            "bulletin_type": "BOE|DOGA|OTHER"
          }
        ]
      }
    ]
  },
  "metadata": {
    "processing_time_ms": 1500,
    "total_matches": 5,
    "status": "success|partial|error",
    "error": null
  }
}
```

## Field Descriptions

### Top Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | String | Yes | Schema version (currently "1.0") |
| `processor_type` | String | Yes | Type of parser that produced this message (e.g., "boe", "doga", "real-estate") |
| `timestamp` | ISO 8601 | Yes | When the message was created |
| `trace_id` | String | Yes | Unique ID for tracing this notification through the system |
| `request` | Object | Yes | Information about the original request |
| `results` | Object | Yes | Results data containing matches |
| `metadata` | Object | No | Additional information about the processing |

### Request Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subscription_id` | UUID | Yes | ID of the subscription that triggered this notification |
| `processing_id` | String | No | Unique ID for this processing run |
| `user_id` | UUID | Yes | ID of the user who owns the subscription |
| `prompts` | Array[String] | No | Array of prompts used for this search |

### Results Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query_date` | String | No | Date the query was performed (YYYY-MM-DD) |
| `matches` | Array[Object] | Yes | Array of match objects |

### Match Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | String | Yes | The prompt that generated these matches |
| `documents` | Array[Object] | Yes | Array of document objects that matched the prompt |

### Document Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `document_type` | String | No | Type of document (e.g., "boe_document") |
| `title` | String | Yes | Original title of the document |
| `notification_title` | String | No | Title to display in the notification (defaults to `title` if not provided) |
| `summary` | String | Yes | Summary text to include in the notification |
| `relevance_score` | Number | No | How relevant this document is to the query (0-1) |
| `links` | Object | No | URLs related to this document |
| `publication_date` | ISO 8601 | No | When the document was published |
| `section` | String | No | Section or category of the document |
| `bulletin_type` | String | No | Type of bulletin (e.g., "BOE", "DOGA") |

### Links Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `html` | String | No | URL to the HTML version of the document |
| `pdf` | String | No | URL to the PDF version of the document |

### Metadata Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `processing_time_ms` | Number | No | Time taken to process this request (milliseconds) |
| `total_matches` | Number | No | Total number of matches found |
| `status` | String | No | Processing status ("success", "partial", or "error") |
| `error` | String/null | No | Error message if status is "error" or "partial" |

## Example Message

```json
{
  "version": "1.0",
  "processor_type": "boe",
  "timestamp": "2023-04-01T12:00:00.000Z",
  "trace_id": "trace-1680350400000-abc123",
  "request": {
    "subscription_id": "550e8400-e29b-41d4-a716-446655440000",
    "processing_id": "proc-1680350400000-def456",
    "user_id": "7a68e0c0-2e5a-4754-b96e-12345678abcd",
    "prompts": ["Licitaciones públicas en Madrid"]
  },
  "results": {
    "query_date": "2023-04-01",
    "matches": [
      {
        "prompt": "Licitaciones públicas en Madrid",
        "documents": [
          {
            "document_type": "boe_document",
            "title": "Licitación para la construcción de infraestructura en Madrid",
            "notification_title": "Nueva licitación en Madrid: Infraestructura",
            "summary": "Licitación pública para la construcción de infraestructura de transporte en la Comunidad de Madrid con un presupuesto de 10 millones de euros.",
            "relevance_score": 0.95,
            "links": {
              "html": "https://www.boe.es/diario_boe/example.html",
              "pdf": "https://www.boe.es/boe/dias/2023/04/01/pdfs/example.pdf"
            },
            "publication_date": "2023-04-01T08:00:00.000Z",
            "section": "Administración Local",
            "bulletin_type": "BOE"
          }
        ]
      }
    ]
  },
  "metadata": {
    "processing_time_ms": 1500,
    "total_matches": 1,
    "status": "success",
    "error": null
  }
}
```

## Publishing a Test Message

To publish a test message using the Google Cloud CLI:

```bash
gcloud pubsub topics publish processor-results --message="$(cat message.json)"
```

Where `message.json` contains your test message in the format described above.

## Notes for Implementers

1. Always include `user_id` and `subscription_id` in the request object as these are required for notification creation.

2. The Notification Worker will use `notification_title` if provided, otherwise falling back to `title`.

3. If no matches are found, still send the message with an empty `matches` array rather than omitting the message entirely.

4. Include a unique `trace_id` in each message to facilitate debugging and tracking.

5. The `processor_type` will be included in notification metadata and can be used by frontend clients to display different notification types. 