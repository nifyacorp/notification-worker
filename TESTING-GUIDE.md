# Notification Worker Testing Guide

This guide explains the different ways to test the Notification Worker service.

## Testing Methods

There are two primary ways to test the Notification Worker:

1. **Local testing** with direct function calls
2. **Integration testing** using PubSub messages

## Method 1: Local Testing

The local testing approach bypasses PubSub and tests the notification processing logic directly.

### Prerequisites

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Test Script

```bash
node test-notification-processor.js
```

### How It Works

The test script:
1. Creates a sample notification message in memory
2. Mocks the `createNotification` and `logger` dependencies
3. Calls the `createNotificationsFromMessage` function directly
4. Validates the result has the expected number of created notifications

This type of testing is useful for:
- Rapid development iterations
- Testing logic changes without deploying
- Unit testing specific components

## Method 2: Integration Testing with PubSub

This approach tests the complete flow by publishing a real message to PubSub that the running notification worker will process.

### Prerequisites

1. Set up Google Cloud SDK on your machine
2. Authenticate with the appropriate project:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

### Option 1: Using the gcloud CLI

Create a file `test-message.json` with the following structure (adjust as needed):

```json
{
  "version": "1.0",
  "processor_type": "boe",
  "timestamp": "2023-04-01T12:00:00.000Z",
  "trace_id": "test-trace-123",
  "request": {
    "subscription_id": "test-subscription-id",
    "user_id": "test-user-id",
    "prompts": ["Test prompt"]
  },
  "results": {
    "matches": [
      {
        "prompt": "Test prompt",
        "documents": [
          {
            "title": "Test Document",
            "summary": "This is a test document summary",
            "links": {
              "html": "https://example.com/doc"
            }
          }
        ]
      }
    ]
  }
}
```

Then publish the message:

```bash
gcloud pubsub topics publish processor-results --message="$(cat test-message.json)"
```

### Option 2: Using the Google Cloud Console

1. Navigate to the Google Cloud Console
2. Go to Pub/Sub → Topics
3. Select the `processor-results` topic
4. Click "Publish message"
5. Paste your JSON message in the Message body field
6. Click "Publish"

### Verifying the Test

To verify that the notification was processed correctly:

1. Check the notification worker logs:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=notification-worker" --limit 20
   ```

2. Query the database to see if the notification was created:
   ```sql
   SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10;
   ```

## Creating Custom Test Messages

You can create custom test messages to test different scenarios:

1. **Empty results**: Test how the service handles messages with no matches
2. **Invalid format**: Test error handling with malformed messages
3. **Multiple matches**: Test processing of multiple documents

See the [NOTIFICATION-MESSAGE-SCHEMA.md](./NOTIFICATION-MESSAGE-SCHEMA.md) document for a complete schema reference.

## Common Issues and Troubleshooting

### Message Not Being Processed

If your test message isn't being processed:

1. Check that the notification worker is running
2. Verify the PubSub subscription exists and is correctly configured
3. Check the message format against the schema document

### Database Errors

If the message is processed but no notification is created:

1. Check database connectivity
2. Verify that the user_id and subscription_id in your test message exist in the database
3. Look for error logs related to database operations

### Invalid Message Format

If you see errors about invalid message format:

1. Compare your message structure to the schema document
2. Ensure all required fields are present
3. Check data types (especially UUID formats for user_id and subscription_id)

## Automated Testing

For CI/CD pipelines, you can automate the testing process:

```javascript
const { PubSub } = require('@google-cloud/pubsub');
const pubsub = new PubSub();

async function publishTestMessage() {
  const dataBuffer = Buffer.from(JSON.stringify(testMessage));
  const messageId = await pubsub.topic('processor-results').publish(dataBuffer);
  console.log(`Message ${messageId} published.`);
  return messageId;
}

publishTestMessage().catch(console.error);
``` 