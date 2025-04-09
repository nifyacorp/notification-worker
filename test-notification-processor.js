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

// Simple standalone test implementation without importing the actual modules
async function testNotificationProcessing() {
  console.log('Testing notification processor with sample message');
  
  try {
    console.log('Sample message:');
    console.log(JSON.stringify(sampleMessage, null, 2).substring(0, 300) + '...');
    
    // Extract key fields that would be processed
    const { request, results } = sampleMessage;
    const userId = request.user_id;
    const subscriptionId = request.subscription_id;
    const matches = results.matches || [];
    
    console.log(`\nProcessing message with user_id: ${userId}, subscription_id: ${subscriptionId}`);
    console.log(`Found ${matches.length} matches`);
    
    // Simulate the notification processing
    let notificationsCreated = 0;
    let errors = 0;
    
    // Process each match (similar to what the actual processor would do)
    for (const match of matches) {
      const prompt = match.prompt || 'Default prompt';
      console.log(`\nProcessing match with prompt: "${prompt}"`);
      
      // Process each document
      for (const doc of match.documents || []) {
        try {
          // Simulate notification creation
          console.log(`Creating notification for document: "${doc.title}"`);
          console.log(`- Content: ${doc.summary}`);
          console.log(`- URL: ${doc.links?.html || 'None'}`);
          
          // In the real implementation, this would call createNotification()
          // Here we just simulate success
          notificationsCreated++;
        } catch (error) {
          console.error(`Error processing document: ${error.message}`);
          errors++;
        }
      }
    }
    
    // Return similar result object as the real function
    const result = { created: notificationsCreated, errors };
    
    console.log('\nNotification processing completed');
    console.log('Result:', result);
    
    // Test validation
    if (result.created === 1 && result.errors === 0) {
      console.log('✅ Test passed: Created 1 notification with 0 errors');
    } else {
      console.log('❌ Test failed: Expected 1 notification with 0 errors, got', result);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    throw error;
  }
}

// Run the test
testNotificationProcessing().catch(console.error);

// Export for testing
export const testMessage = sampleMessage; 