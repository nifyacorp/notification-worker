# Notification Worker Update Notes

## Recent Changes

1. Added debug logging to diagnose issue with the `/diagnostics/database` endpoint returning HTML instead of JSON:
   - Added request path and headers logging to track incoming requests
   - Added response logging to confirm we're sending JSON
   - Fixed potential path matching issues

2. Database diagnostic improvements:
   - Better error logging for diagnostic queries
   - Added logging of response data before sending

## Deployment Instructions

The local environment doesn't have the `gcloud` CLI available, so to deploy these changes:

1. Push the changes to the GitHub repository
2. Use Google Cloud Console to manually trigger a build or configure Cloud Build triggers
3. Deploy the new container image to Cloud Run

## Testing Instructions

After deployment, test the endpoints:

1. Health endpoint:
   ```
   curl https://notification-worker-415554190254.us-central1.run.app/health
   ```

2. Database diagnostics endpoint:
   ```
   curl "https://notification-worker-415554190254.us-central1.run.app/diagnostics/database?userId=8bf705b5-2423-4257-92bd-ab0df1ee3218"
   ```

3. Check application logs in Cloud Logging to see:
   - If the request is hitting the correct endpoint handler
   - If any errors are occurring during request processing
   - If JSON response is being properly constructed

## SQL Syntax Error in Backend

For the SQL syntax error in the backend diagnostics endpoint, review the query parameters handling:

1. Check the database queries in `backend/src/interfaces/http/routes/diagnostics.routes.js`
2. Ensure all parameters are properly escaped and formatted
3. Look for any issues with parameter handling in the `query` function

The error `syntax error at or near "$1"` typically indicates a problem with parameter substitution in prepared statements. 