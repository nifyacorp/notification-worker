#!/usr/bin/env node

/**
 * Script to run both old and new implementations in parallel
 * This is useful during the migration phase
 */

const { spawn } = require('child_process');
const path = require('path');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

// Configuration for parallel processes
const config = {
  oldImplementation: {
    name: 'Legacy',
    command: 'node',
    args: ['src/index.js'],
    color: colors.yellow,
    env: {
      ...process.env,
      PORT: '8080', // Original port
      NODE_ENV: 'development'
    }
  },
  newImplementation: {
    name: 'New DDD',
    command: 'npm',
    args: ['run', 'dev'],
    color: colors.green,
    env: {
      ...process.env,
      PORT: '8081', // New port
      NODE_ENV: 'development',
      SHADOW_MODE: 'true' // Run in shadow mode - don't send actual emails/notifications
    }
  }
};

// Helper function to prefix output with process name and timestamp
function prefixOutput(name, color) {
  return function(data) {
    const timestamp = new Date().toISOString();
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`${color}[${timestamp}][${name}]${colors.reset} ${line}`);
      }
    });
  };
}

// Start the old implementation
console.log(`${colors.bright}${colors.blue}Starting parallel execution...${colors.reset}`);
console.log(`${colors.yellow}Legacy implementation will run on port 8080${colors.reset}`);
console.log(`${colors.green}New implementation will run on port 8081${colors.reset}`);

// Start the old implementation
const oldProcess = spawn(
  config.oldImplementation.command,
  config.oldImplementation.args,
  {
    cwd: process.cwd(),
    env: config.oldImplementation.env,
    stdio: 'pipe'
  }
);

oldProcess.stdout.on('data', prefixOutput(config.oldImplementation.name, config.oldImplementation.color));
oldProcess.stderr.on('data', prefixOutput(config.oldImplementation.name, colors.red));

// Start the new implementation
const newProcess = spawn(
  config.newImplementation.command,
  config.newImplementation.args,
  {
    cwd: process.cwd(),
    env: config.newImplementation.env,
    stdio: 'pipe'
  }
);

newProcess.stdout.on('data', prefixOutput(config.newImplementation.name, config.newImplementation.color));
newProcess.stderr.on('data', prefixOutput(config.newImplementation.name, colors.red));

// Handle process exit
function handleExit() {
  console.log(`\n${colors.bright}${colors.blue}Shutting down all processes...${colors.reset}`);
  
  oldProcess.kill();
  newProcess.kill();
  
  // Give processes some time to shut down gracefully
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

// Handle terminal signals
process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

// Handle child process exit
oldProcess.on('exit', (code) => {
  console.log(`${colors.yellow}[${config.oldImplementation.name}] Process exited with code ${code}${colors.reset}`);
  // If one process exits, we'll exit everything
  if (code !== 0) {
    handleExit();
  }
});

newProcess.on('exit', (code) => {
  console.log(`${colors.green}[${config.newImplementation.name}] Process exited with code ${code}${colors.reset}`);
  // If one process exits, we'll exit everything
  if (code !== 0) {
    handleExit();
  }
});

console.log(`${colors.bright}${colors.blue}Both implementations are running. Press Ctrl+C to exit.${colors.reset}`);