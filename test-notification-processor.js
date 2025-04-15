import { createNotificationsFromMessage } from './src/services/notification-processor.js';
import { logger } from './src/utils/logger.js';
import { database } from './src/services/database.js';

// Test user ID - use a test account
const TEST_USER_ID = '8bf705b5-2423-4257-92bd-ab0df1ee3218';
const TEST_SUBSCRIPTION_ID = '00000000-0000-0000-0000-000000000000';

// Sample message in the new format
const testMessage = {
  "trace_id": "test-trace-id-" + Date.now(),
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
      },
      {
        "prompt": "Ayudas para pymes",
        "matches": [
          {
            "document_type": "ORDER",
            "title": "Orden por la que se establecen ayudas para la digitalización de pymes",
            "notification_title": "Ayudas para digitalización de pequeñas empresas",
            "issuing_body": "Ministerio de Industria, Comercio y Turismo",
            "summary": "Se establecen las bases reguladoras para la concesión de ayudas para la digitalización de pequeñas y medianas empresas.",
            "relevance_score": 78,
            "links": {
              "html": "https://www.boe.es/diario_boe/example2.html",
              "pdf": "https://www.boe.es/diario_boe/example2.pdf"
            }
          }
        ],
        "metadata": {
          "processing_time_ms": 980,
          "model_used": "gemini-2.0-flash-lite",
          "token_usage": {
            "input_tokens": 10500,
            "output_tokens": 420,
            "total_tokens": 10920
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
    logger.info('Starting notification processor test with new message format');
    
    // Test database connection
    logger.info('Testing database connection');
    await database.testConnection();
    
    // Process the test message
    logger.info('Processing test message', { 
      trace_id: testMessage.trace_id,
      user_id: testMessage.request.user_id,
      subscription_id: testMessage.request.subscription_id
    });
    
    const result = await createNotificationsFromMessage(testMessage);
    
    logger.info('Test message processed successfully', { 
      notifications_created: result.created,
      errors: result.errors
    });
    
    // Verify notifications were created
    if (result.created > 0) {
      logger.info(`Successfully created ${result.created} notifications`);
      
      // Verify we can read them back with proper RLS context
      const readResult = await database.withRLSContext(TEST_USER_ID, async (client) => {
        return client.query(
          'SELECT id, title, content, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
          [TEST_USER_ID]
        );
      });
      
      if (readResult.rows.length > 0) {
        logger.info('Successfully read back notifications:', {
          count: readResult.rows.length,
          latest: readResult.rows.map(row => ({
            id: row.id,
            title: row.title,
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