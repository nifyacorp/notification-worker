#!/bin/bash

echo "Running notification RLS test..."
node src/test-notification.js

echo "Testing diagnostics endpoint..."
curl -X GET "http://localhost:8080/diagnostics/database?userId=8bf705b5-2423-4257-92bd-ab0df1ee3218"

echo "Testing notification creation endpoint..."
curl -X POST "http://localhost:8080/diagnostics/create-notification" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "8bf705b5-2423-4257-92bd-ab0df1ee3218",
    "subscriptionId": "00000000-0000-0000-0000-000000000000",
    "title": "Test from curl",
    "content": "Testing notification creation with RLS context"
  }'

echo "Done!" 