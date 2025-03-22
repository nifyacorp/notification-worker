# NIFYA Notification Worker Guidelines

## Build Commands
- `npm start` - Run the service in production mode
- `npm lint` - Check code for style issues with ESLint
- `npm format` - Automatically format code with Prettier
- `npm test` - Run tests with Vitest
- Single Test: `npx vitest run <test-file-path>`

## Code Style Guidelines
- **Imports**: External imports first, followed by internal imports grouped by functionality
- **Exports**: Use named exports for clarity (avoid default exports)
- **Naming**: camelCase for functions/variables, UPPER_CASE for constants
- **Error Handling**: Use structured error objects with context data for logging
- **Validation**: Use Zod schemas for data validation with explicit error handling
- **Formatting**: Standard prettier config (spaces, line length follows codebase)
- **Logging**: Use structured logging with context object containing request identifiers
- **Comments**: Document complex functions with JSDoc annotations
- **Database**: Always set RLS context and use parameterized queries
- **Fallbacks**: Provide fallback/retry mechanisms for critical operations

## Resilience Guidelines
- Handle database connection failures with automatic retries
- Validate all incoming messages before processing
- Include detailed context in error logs for troubleshooting
- Implement exponential backoff for external service retries