import { createNotificationsFromMessage } from './src/services/notification-processor.js';

// Sample notification message (matches the format sent by the subscription worker)
const sampleMessage = {
  version: "1.0",
  processor_type: "boe",
  timestamp: new Date().toISOString(),
  trace_id: `test-trace-${Date.now()}`,
  request: {
    subscription_id: "test-subscription-id",
    processing_id: `test-processing-${Date.now()}`,
    user_id: "test-user-id",
    prompts: ["Example prompt"]
  },
  results: {
    query_date: new Date().toISOString().split('T')[0],
    matches: [
      {
        prompt: "Example prompt",
        documents: [
          {
            document_type: "boe_document",
            title: "Test Document Title",
            notification_title: "Test Notification Title",
            summary: "This is a test summary for the notification",
            relevance_score: 0.9,
            links: {
              html: "https://example.com/document1",
              pdf: "https://example.com/document1.pdf"
            },
            publication_date: new Date().toISOString(),
            section: "Section A",
            bulletin_type: "BOE"
          }
        ]
      }
    ]
  },
  metadata: {
    processing_time_ms: 250,
    total_matches: 1,
    status: "success",
    error: null
  }
};

// Mock the dependencies to avoid actual database operations during testing
jest.mock('./src/services/notification.js', () => ({
  createNotification: jest.fn().mockResolvedValue({
    id: 'mock-notification-id',
    created_at: new Date().toISOString()
  })
}));

jest.mock('./src/utils/logger.js', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// You can choose to run this script directly or as part of a test suite
async function runTest() {
  console.log('Testing notification processor with sample message');
  
  try {
    const result = await createNotificationsFromMessage(sampleMessage);
    
    console.log('Notification processor test completed successfully');
    console.log('Result:', result);
    
    // In a real test, you would make assertions here
    if (result.created === 1 && result.errors === 0) {
      console.log('✅ Test passed: Created 1 notification with 0 errors');
    } else {
      console.log('❌ Test failed: Expected 1 notification with 0 errors, got', result);
    }
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
runTest().catch(console.error);

// For Jest test exports (if using Jest)
export const testMessage = sampleMessage; 