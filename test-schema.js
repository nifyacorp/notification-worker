/**
 * Test script to verify that the shared schema can be imported correctly
 */
import { validateBoeParserMessage, createDefaultBoeParserMessage } from './src/utils/schemas/pubsubMessages.js';

console.log('Testing schema imports...');

// Test imports are working
console.log('validateBoeParserMessage imported:', typeof validateBoeParserMessage === 'function');
console.log('createDefaultBoeParserMessage imported:', typeof createDefaultBoeParserMessage === 'function');

// Create a test message
const testMessage = createDefaultBoeParserMessage();
console.log('Default message created:', testMessage);

// Test validation
try {
  validateBoeParserMessage(testMessage);
  console.log('Schema validation successful!');
} catch (error) {
  console.error('Schema validation failed:', error.message);
  process.exit(1);
}

// Test that we can import parser.js (simulating the actual app import)
console.log('\nTesting parser.js import...');
try {
  // Use dynamic import to test the parser module
  import('./src/services/parser.js').then(parser => {
    console.log('Parser module imported successfully!');
    console.log('Parser functions available:', Object.keys(parser));
    console.log('All imports passed, schema is ready for deployment.');
  }).catch(error => {
    console.error('Error importing parser.js:', error.message);
    process.exit(1);
  });
} catch (error) {
  console.error('Error attempting to import parser.js:', error.message);
  process.exit(1);
}

console.log('Schema test completed successfully.'); 