// Test script for diagnostics endpoints
import http from 'http';

// Configuration
const config = {
  host: 'localhost',
  port: process.env.PORT || 8080,
  userId: process.env.TEST_USER_ID || '8bf705b5-2423-4257-92bd-ab0df1ee3218',
  endpoints: {
    health: '/health',
    databaseDiagnostics: '/diagnostics/database',
    createNotification: '/diagnostics/create-notification'
  }
};

// Utility to make HTTP requests
async function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`Response Status: ${res.statusCode}`);
        console.log(`Content-Type: ${res.headers['content-type']}`);
        
        try {
          // Try to parse as JSON
          if (res.headers['content-type']?.includes('application/json')) {
            const parsedData = JSON.parse(data);
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              data: parsedData
            });
          } else {
            console.log('Raw response data:');
            console.log(data.substring(0, 200) + (data.length > 200 ? '...' : ''));
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              rawData: data
            });
          }
        } catch (error) {
          console.error('Error parsing response:', error.message);
          console.log('Raw response data:');
          console.log(data.substring(0, 200) + (data.length > 200 ? '...' : ''));
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            rawData: data,
            parseError: error.message
          });
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Request error:', error.message);
      reject(error);
    });
    
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    
    req.end();
  });
}

// Test functions
async function testHealthEndpoint() {
  console.log('\n===== Testing Health Endpoint =====');
  
  const options = {
    host: config.host,
    port: config.port,
    path: config.endpoints.health,
    method: 'GET'
  };
  
  try {
    const response = await makeRequest(options);
    console.log('Health check successful:', response.statusCode);
    console.log('Service status:', response.data.status);
    return true;
  } catch (error) {
    console.error('Health check failed:', error.message);
    return false;
  }
}

async function testDatabaseDiagnostics() {
  console.log('\n===== Testing Database Diagnostics Endpoint =====');
  
  const options = {
    host: config.host,
    port: config.port,
    path: `${config.endpoints.databaseDiagnostics}?userId=${config.userId}`,
    method: 'GET'
  };
  
  try {
    const response = await makeRequest(options);
    
    if (response.statusCode === 200) {
      console.log('Database diagnostics successful');
      
      if (response.data) {
        // Check if we have diagnostic data
        console.log('Database connection status:', 
          response.data.database?.isConnected ? 'Connected' : 'Not connected');
        
        // Check RLS settings
        console.log('RLS enabled:', response.data.diagnostics?.rls_enabled);
        console.log('Current user ID setting:', response.data.diagnostics?.app_user_id_setting);
        
        // Check notification test
        if (response.data.diagnostics?.test_notification) {
          console.log('Test notification:', 
            response.data.diagnostics.test_notification.success ? 'Created successfully' : 'Failed');
        }
      }
    } else {
      console.error('Database diagnostics failed with status:', response.statusCode);
    }
    
    return response.statusCode === 200;
  } catch (error) {
    console.error('Database diagnostics failed:', error.message);
    return false;
  }
}

async function testCreateNotification() {
  console.log('\n===== Testing Create Notification Endpoint =====');
  
  const options = {
    host: config.host,
    port: config.port,
    path: config.endpoints.createNotification,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  const postData = {
    userId: config.userId,
    subscriptionId: '00000000-0000-0000-0000-000000000000', // Test subscription ID
    title: 'Test Notification',
    content: 'This is a test notification from the diagnostics test script'
  };
  
  try {
    const response = await makeRequest(options, postData);
    
    if (response.statusCode === 200 || response.statusCode === 201) {
      console.log('Create notification successful');
      if (response.data) {
        console.log('Notification ID:', response.data.notification_id);
      }
    } else {
      console.error('Create notification failed with status:', response.statusCode);
      if (response.data?.error) {
        console.error('Error:', response.data.error);
        console.error('Message:', response.data.message);
      }
    }
    
    return response.statusCode === 200 || response.statusCode === 201;
  } catch (error) {
    console.error('Create notification failed:', error.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('Starting diagnostic tests...');
  console.log(`Server: ${config.host}:${config.port}`);
  console.log(`Test User ID: ${config.userId}`);
  
  const healthResult = await testHealthEndpoint();
  const diagnosticsResult = await testDatabaseDiagnostics();
  const createResult = await testCreateNotification();
  
  console.log('\n===== Test Results =====');
  console.log('Health Endpoint:', healthResult ? 'PASSED' : 'FAILED');
  console.log('Database Diagnostics:', diagnosticsResult ? 'PASSED' : 'FAILED');
  console.log('Create Notification:', createResult ? 'PASSED' : 'FAILED');
  
  process.exit(healthResult && diagnosticsResult && createResult ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('Test execution error:', error);
  process.exit(1);
}); 