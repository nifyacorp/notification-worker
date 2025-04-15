import { processMessage } from './src/services/parser.js';
import { logger } from './src/utils/logger.js';
import { database } from './src/services/database.js';
import { v4 as uuidv4 } from 'uuid';

// Test user ID and subscription ID - use test accounts
const TEST_USER_ID = '8bf705b5-2423-4257-92bd-ab0df1ee3218';
const TEST_SUBSCRIPTION_ID = '00000000-0000-0000-0000-000000000000';

// Create a test subscription processing record
async function createTestSubscriptionProcessing(subscriptionId) {
  try {
    const result = await database.query(
      `INSERT INTO subscription_processing 
        (subscription_id, status, next_run_at, last_run_at, metadata) 
       VALUES 
        ($1, $2, $3, $4, $5) 
       RETURNING id`,
      [
        subscriptionId,
        'processing',
        new Date(Date.now() + 86400000), // tomorrow
        new Date(),
        JSON.stringify({ test: true })
      ]
    );
    
    return result.rows[0]?.id;
  } catch (error) {
    logger.error('Failed to create test subscription processing record', {
      error: error.message,
      subscription_id: subscriptionId
    });
    throw error;
  }
}

// Verify if subscription processing record exists
async function checkSubscriptionProcessing(subscriptionId) {
  try {
    const result = await database.query(
      `SELECT id, status FROM subscription_processing WHERE subscription_id = $1`,
      [subscriptionId]
    );
    
    return {
      exists: result.rowCount > 0,
      records: result.rows
    };
  } catch (error) {
    logger.error('Failed to check subscription processing record', {
      error: error.message,
      subscription_id: subscriptionId
    });
    throw error;
  }
}

// Sample message with the new format
const testMessage = {
  "trace_id": "test-trace-id-" + uuidv4(),
  "request": {
    "texts": ["Subvenciones energías renovables", "Ayudas para pymes"],
    "subscription_id": TEST_SUBSCRIPTION_ID,
    "user_id": TEST_USER_ID
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
        "prompt": "Subvenciones energías renovables",
        "matches": [
          {
            "document_type": "RESOLUTION",
            "title": "Resolución de subvenciones para la instalación de energías renovables",
            "notification_title": "Nuevas subvenciones para energías renovables",
            "issuing_body": "Ministerio para la Transición Ecológica",
            "summary": "Se convocan subvenciones para la instalación de energías renovables con un presupuesto de 100 millones de euros.",
            "relevance_score": 85,
            "links": {
              "html": "https://www.boe.es/diario_boe/example.html",
              "pdf": "https://www.boe.es/diario_boe/example.pdf"
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
    "processing_time_ms": 2180,
    "total_items_processed": 50,
    "status": "success"
  }
};

async function runTest() {
  try {
    logger.info('Starting notification processing test with subscription cleanup');
    
    // Test database connection
    logger.info('Testing database connection');
    await database.testConnection();
    
    // Create test subscription processing record
    logger.info('Creating test subscription processing record');
    const processingId = await createTestSubscriptionProcessing(TEST_SUBSCRIPTION_ID);
    
    logger.info('Created test subscription processing record', { 
      processing_id: processingId,
      subscription_id: TEST_SUBSCRIPTION_ID
    });
    
    // Verify the record exists
    const beforeCheck = await checkSubscriptionProcessing(TEST_SUBSCRIPTION_ID);
    logger.info('Subscription processing record check before processing', beforeCheck);
    
    if (!beforeCheck.exists) {
      throw new Error('Test subscription processing record was not created');
    }
    
    // Process the test message
    logger.info('Processing test message', { 
      trace_id: testMessage.trace_id,
      user_id: testMessage.request.user_id,
      subscription_id: testMessage.request.subscription_id
    });
    
    const result = await processMessage(testMessage);
    
    logger.info('Test message processed successfully', { 
      notifications_created: result.created,
      errors: result.errors
    });
    
    // Verify the record was deleted
    const afterCheck = await checkSubscriptionProcessing(TEST_SUBSCRIPTION_ID);
    logger.info('Subscription processing record check after processing', afterCheck);
    
    if (afterCheck.exists) {
      logger.warn('Subscription processing record was not deleted as expected', {
        records: afterCheck.records
      });
    } else {
      logger.info('Subscription processing record was successfully deleted');
    }
    
    // Verify notifications were created
    if (result.created > 0) {
      logger.info(`Successfully created ${result.created} notifications`);
      
      // Verify we can read them back with proper RLS context
      const readResult = await database.withRLSContext(TEST_USER_ID, async (client) => {
        return client.query(
          'SELECT id, title, content, source, entity_type, data, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
          [TEST_USER_ID]
        );
      });
      
      if (readResult.rows.length > 0) {
        logger.info('Successfully read back notifications:', {
          count: readResult.rows.length,
          latest: readResult.rows.map(row => ({
            id: row.id,
            title: row.title,
            source: row.source,
            entity_type: row.entity_type,
            data_fields: Object.keys(row.data || {}),
            created_at: row.created_at
          }))
        });
      }
    } else {
      logger.warn('No notifications were created during the test');
    }
    
    logger.info('Test completed successfully');
  } catch (error) {
    logger.error('Test failed', {
      error: error.message,
      stack: error.stack
    });
  } finally {
    // Close the database connection
    await database.end();
  }
}

// Run the test
runTest().catch(error => {
  console.error('Unhandled error in test:', error);
  process.exit(1);
}); 