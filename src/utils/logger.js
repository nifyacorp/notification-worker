const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function formatMessage(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const dataString = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  return `${timestamp} ${level.toUpperCase()}: ${message}${dataString}`;
}

export const logger = {
  error: (message, data) => {
    if (currentLevel >= LOG_LEVELS.error) {
      console.error(formatMessage('error', message, data));
    }
  },
  warn: (message, data) => {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', message, data));
    }
  },
  info: (message, data) => {
    if (currentLevel >= LOG_LEVELS.info) {
      console.info(formatMessage('info', message, data));
    }
  },
  debug: (message, data) => {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.debug(formatMessage('debug', message, data));
    }
  }
};