#!/usr/bin/env node

/**
 * Migration script to help with transitioning to the new architecture
 * This script will:
 * 1. Install required dependencies for TypeScript
 * 2. Create the basic directory structure for the new architecture
 * 3. Provide guidance on how to proceed with the migration
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Define the new folder structure based on domain-driven design
const folders = [
  'src-new',
  'src-new/domain',
  'src-new/domain/entities',
  'src-new/domain/repositories',
  'src-new/domain/services',
  'src-new/domain/valueObjects',
  'src-new/domain/errors',
  'src-new/application',
  'src-new/application/dtos',
  'src-new/application/useCases',
  'src-new/application/services',
  'src-new/application/errors',
  'src-new/infrastructure',
  'src-new/infrastructure/config',
  'src-new/infrastructure/database',
  'src-new/infrastructure/messaging',
  'src-new/infrastructure/repositories',
  'src-new/infrastructure/logging',
  'src-new/interfaces',
  'src-new/interfaces/http',
  'src-new/interfaces/pubsub',
  'src-new/interfaces/processors',
  'tests',
  'tests/unit',
  'tests/integration',
];

// Required dev dependencies for TypeScript
const devDependencies = [
  '@types/express',
  '@types/node',
  '@types/node-fetch',
  '@types/pg',
  '@types/uuid',
  '@typescript-eslint/eslint-plugin',
  '@typescript-eslint/parser',
  'rimraf',
  'tsx',
  'typescript',
];

// Required production dependencies
const dependencies = [
  'express',
  'uuid',
  'winston',
];

console.log('Starting migration to new architecture...');

// Create directory structure
console.log('Creating directory structure...');
folders.forEach(folder => {
  const fullPath = path.join(process.cwd(), folder);
  if (!fs.existsSync(fullPath)) {
    console.log(`Creating ${folder}`);
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Install dependencies
console.log('Installing required dependencies...');
try {
  console.log('Installing dev dependencies...');
  execSync(`npm install --save-dev ${devDependencies.join(' ')}`, { stdio: 'inherit' });
  
  console.log('Installing production dependencies...');
  execSync(`npm install --save ${dependencies.join(' ')}`, { stdio: 'inherit' });
} catch (error) {
  console.error('Error installing dependencies:', error.message);
  console.log('Please install them manually using npm install.');
}

// Create a README file with migration guidance
const readmeContent = `# Migration to New Architecture

This project is being migrated to a new architecture based on domain-driven design principles.

## Directory Structure

The new architecture follows this structure:

- \`src-new/domain\`: Core business logic, entities, and interfaces
  - \`entities\`: Business objects (Notification, User, etc.)
  - \`repositories\`: Interfaces for data access
  - \`services\`: Business logic interfaces
  - \`valueObjects\`: Immutable domain objects
  - \`errors\`: Domain-specific error types

- \`src-new/application\`: Application use cases and DTOs
  - \`dtos\`: Data transfer objects
  - \`useCases\`: Application-specific business logic
  - \`services\`: Implementations of domain services
  - \`errors\`: Application-specific error types

- \`src-new/infrastructure\`: Technical implementations
  - \`config\`: Application configuration
  - \`database\`: Database connectivity
  - \`messaging\`: PubSub and messaging
  - \`repositories\`: Repository implementations
  - \`logging\`: Logging functionality

- \`src-new/interfaces\`: User interfaces and adapters
  - \`http\`: HTTP server and routes
  - \`pubsub\`: PubSub integration
  - \`processors\`: Message processors

## Migration Process

1. Build new TypeScript components in the \`src-new\` directory
2. Run the TypeScript code alongside the existing code
3. Test thoroughly to ensure feature parity
4. Switch to the new implementation
5. Remove the old code

## Running the New Implementation

- Development: \`npm run dev\`
- Build: \`npm run build\`
- Start: \`npm start\`

## Testing Strategy

- Unit tests in \`tests/unit\`
- Integration tests in \`tests/integration\`
- Run tests with \`npm test\`
`;

fs.writeFileSync(path.join(process.cwd(), 'MIGRATION-GUIDE.md'), readmeContent);

console.log('Migration script completed successfully!');
console.log('See MIGRATION-GUIDE.md for next steps in the migration process.');