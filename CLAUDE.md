# NIFYA Notification Worker Guidelines

## Build Commands
- `npm start` - Run the service in production mode
- `npm run lint` - Check code for style issues with ESLint
- `npm run format` - Automatically format code with Prettier
- `npm test` - Run tests with Vitest
- Single Test: `npx vitest run <test-file-path>`
- Dev Test: `npx vitest <test-file-name> --watch`

## Code Style Guidelines
- **Type System**: Use Zod schemas for validation with explicit error handling
- **Imports**: External first, then internal grouped by functionality
- **Exports**: Use named exports for clarity (avoid default exports)
- **Naming**: camelCase for functions/variables, UPPER_CASE for constants
- **Error Handling**: Structured error objects with context for logging
- **Formatting**: 2-space indent, standard Prettier config
- **Logging**: Use structured logging with context object containing request IDs
- **Database**: Always set RLS context and use parameterized queries
- **Fallbacks**: Implement exponential backoff for external service retries

## Resilience Guidelines
- Handle database connection failures with automatic retries
- Validate all incoming messages before processing
- Include detailed context in error logs for troubleshooting
- Sanitize and validate user input before processing or storage
- Always release database clients after use with client.release()