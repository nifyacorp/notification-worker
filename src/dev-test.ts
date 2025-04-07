/**
 * @file Development test script
 * Provides mock data for local development and testing
 */

import { app } from './application/bootstrap';
import { logger } from './shared/logger/logger';
import { ProcessorType } from './domain/models/message';
import { MockNotificationRepository } from './infrastructure/repositories/mock-notification-repository';
import { MockPubSubService } from './infrastructure/messaging/mock-pubsub-service';

/**
 * Mock BOE message for testing
 */
const mockBoeMessage = {
  version: "1.0",
  processor_type: ProcessorType.BOE,
  timestamp: new Date().toISOString(),
  trace_id: "mock-trace-id-1",
  request: {
    subscription_id: "00000000-0000-0000-0000-000000000001",
    processing_id: "test-processing-1",
    user_id: "00000000-0000-0000-0000-000000000001",
    prompts: ["mock prompt 1"]
  },
  results: {
    query_date: new Date().toISOString(),
    matches: [
      {
        prompt: "mock prompt 1",
        documents: [
          {
            document_type: "boe_document",
            title: "Resolución de prueba",
            summary: "Este es un documento de prueba para el BOE",
            relevance_score: 0.95,
            links: {
              html: "https://www.boe.es/test",
              pdf: "https://www.boe.es/test.pdf"
            },
            publication_date: new Date().toISOString(),
            section: "test",
            bulletin_type: "BOE"
          }
        ]
      }
    ]
  },
  metadata: {
    processing_time_ms: 500,
    total_matches: 1,
    status: "success",
    error: null
  }
};

/**
 * Mock Real Estate message for testing
 */
const mockRealEstateMessage = {
  version: "1.0",
  processor_type: ProcessorType.REAL_ESTATE,
  timestamp: new Date().toISOString(),
  trace_id: "mock-trace-id-2",
  request: {
    subscription_id: "00000000-0000-0000-0000-000000000002",
    processing_id: "test-processing-2",
    user_id: "00000000-0000-0000-0000-000000000002",
    prompts: ["mock prompt 2"]
  },
  results: {
    query_date: new Date().toISOString(),
    matches: [
      {
        prompt: "mock prompt 2",
        documents: [
          {
            document_type: "real_estate_listing",
            title: "Piso en Madrid",
            summary: "Bonito piso en el centro de Madrid",
            relevance_score: 0.92,
            links: {
              html: "https://www.example.com/realestate/1"
            },
            price: 250000,
            location: {
              city: "Madrid",
              region: "Madrid"
            },
            property_type: "Piso",
            size_sqm: 85,
            rooms: 3
          }
        ]
      }
    ]
  },
  metadata: {
    processing_time_ms: 600,
    total_matches: 1,
    status: "success",
    error: null
  }
};

/**
 * Setup mock environment for testing
 * Sets environment variables and adds mock configurations
 */
function setupMockEnvironment() {
  // Set environment variables for testing
  process.env.NODE_ENV = 'development';
  process.env.LOG_LEVEL = 'debug';
  process.env.PORT = '8081';
  
  // Mock connection checking for DB
  app.mockDatabaseConnection = true;
  
  // Replace repositories with mock implementations
  app.setMockRepositories(
    new MockNotificationRepository(logger),
    new MockPubSubService(logger)
  );
  
  logger.info('Set up mock environment for testing');
}

/**
 * Send mock messages to the application
 */
async function sendMockMessages() {
  try {
    // Small delay to allow for initialization
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    logger.info('Sending mock BOE message');
    await app.processMockMessage(mockBoeMessage);
    
    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    logger.info('Sending mock Real Estate message');
    await app.processMockMessage(mockRealEstateMessage);
    
    logger.info('Mock messages sent successfully');
  } catch (error) {
    logger.error('Error sending mock messages', {
      error: (error as Error).message,
      stack: (error as Error).stack
    });
  }
}

/**
 * Start the service with mock data
 */
async function startTestService() {
  try {
    // Setup mock environment
    setupMockEnvironment();
    
    // Initialize application
    await app.initialize();
    
    // Start application
    await app.start();
    
    logger.info('Notification worker started in test mode');
    
    // Send mock messages
    sendMockMessages();
  } catch (error) {
    logger.error('Failed to start notification worker in test mode', {
      error: (error as Error).message,
      stack: (error as Error).stack
    });
    
    // Exit with error
    process.exit(1);
  }
}

// Start the test service
startTestService();