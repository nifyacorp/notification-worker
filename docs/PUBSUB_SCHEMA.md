# PubSub Message Schema Documentation

This document explains the schema used for communication between the BOE Parser and the Notification Worker via Google PubSub.

## Message Structure

The BOE Parser service publishes analysis results to a PubSub topic, which is consumed by the Notification Worker service. To ensure compatibility, both services must agree on the message structure.

### Required Fields

```javascript
{
  "trace_id": "string", // Unique identifier for tracing the request
  "request": {
    "subscription_id": "string", // REQUIRED: ID of the subscription (empty string if not available)
    "user_id": "string", // REQUIRED: ID of the user (empty string if not available)
    "texts": ["string"] // Array of prompts/search texts
  },
  "results": {
    "boe_info": {
      "publication_date": "string", // Publication date in YYYY-MM-DD format
      "source_url": "string" // Source URL
    },
    "query_date": "string", // Query date in YYYY-MM-DD format
    "results": [
      {
        "prompt": "string", // The prompt used for analysis
        "matches": [], // Array of matches found
        "metadata": {} // Metadata for this result
      }
    ]
  },
  "metadata": {
    "processing_time_ms": number, // Processing time in milliseconds
    "total_items_processed": number, // Total number of items processed
    "status": "string" // Processing status
  }
}
```

## Important Notes

1. **Required String Fields**: `subscription_id` and `user_id` are **required** and must be strings, even if they don't have actual values. In such cases, they should be empty strings (`""`) rather than null or undefined.

2. **Schema Validation**: Both the publishing and consuming services should validate messages against this schema to ensure compatibility.

## Validation Process in Notification Worker

The notification worker uses a multi-step validation process:

1. **Shared Schema Validation**: First tries to validate against the shared schema (`validateBoeParserMessage`) that matches exactly what the BOE parser produces.

2. **Zod Schema Validation**: Then validates against the Zod schema (`MessageSchema`) that defines the expected structure for the notification worker.

3. **Normalization**: If validation fails, attempts to normalize the message structure to fit the expected schema.

4. **Revalidation**: Validates the normalized message against both schemas again.

## Sharing the Schema

The schema definition is available in both services at:

- BOE Parser: `src/utils/schemas/pubsubMessages.js`
- Notification Worker: `src/utils/schemas/pubsubMessages.js`

To ensure compatibility, these files should be kept in sync. When changes are needed:

1. Update the schema in both services simultaneously
2. Update this documentation
3. Test the integration to verify compatibility

## Troubleshooting

Common validation errors:

- "request.subscription_id must be a string": Make sure subscription_id is a string (empty string if not available, not null or undefined)
- "request.user_id must be a string": Make sure user_id is a string (empty string if not available, not null or undefined)
- "Missing required field": Ensure all required fields are present in the message 