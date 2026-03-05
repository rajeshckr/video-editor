const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
};

const LOG_COLORS = {
  DEBUG: '\x1b[36m', // Cyan
  INFO: '\x1b[32m',  // Green
  WARN: '\x1b[33m',  // Yellow
  ERROR: '\x1b[31m', // Red
  RESET: '\x1b[0m'
};

class Logger {
  constructor(moduleName = 'App') {
    this.moduleName = moduleName;
    this.enableConsole = true;
    this.enableFile = false;
    this.logFile = null;
  }

  static getInstance(moduleName = 'App') {
    return new Logger(moduleName);
  }

  setFileLogging(filePath) {
    this.enableFile = true;
    this.logFile = filePath;
    // Create file if doesn't exist
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '');
    }
  }

  _formatTimestamp() {
    const now = new Date();
    return now.toISOString().replace('T', ' ').slice(0, -5);
  }

  _formatMessage(level, message, data = null) {
    const timestamp = this._formatTimestamp();
    const module = `[${this.moduleName}]`;
    const levelTag = `[${level}]`;
    
    let formatted = `${timestamp} ${levelTag} ${module} ${message}`;
    
    if (data) {
      if (typeof data === 'object') {
        formatted += `\n${JSON.stringify(data, null, 2)}`;
      } else {
        formatted += ` ${data}`;
      }
    }
    
    return formatted;
  }

  _writeToFile(formatted) {
    if (this.enableFile && this.logFile) {
      try {
        fs.appendFileSync(this.logFile, formatted + '\n');
      } catch (err) {
        console.error(`[Logger] Failed to write to log file:`, err.message);
      }
    }
  }

  _logToConsole(level, formatted) {
    if (!this.enableConsole) return;
    
    const color = LOG_COLORS[level] || '';
    const reset = LOG_COLORS.RESET;
    console.log(`${color}${formatted}${reset}`);
  }

  debug(message, data = null) {
    const formatted = this._formatMessage(LOG_LEVELS.DEBUG, message, data);
    this._logToConsole(LOG_LEVELS.DEBUG, formatted);
    this._writeToFile(formatted);
  }

  info(message, data = null) {
    const formatted = this._formatMessage(LOG_LEVELS.INFO, message, data);
    this._logToConsole(LOG_LEVELS.INFO, formatted);
    this._writeToFile(formatted);
  }

  warn(message, data = null) {
    const formatted = this._formatMessage(LOG_LEVELS.WARN, message, data);
    this._logToConsole(LOG_LEVELS.WARN, formatted);
    this._writeToFile(formatted);
  }

  error(message, errorOrData = null) {
    let data = errorOrData;
    
    // Handle Error objects specially
    if (errorOrData instanceof Error) {
      data = {
        name: errorOrData.name,
        message: errorOrData.message,
        stack: errorOrData.stack
      };
    }
    
    const formatted = this._formatMessage(LOG_LEVELS.ERROR, message, data);
    this._logToConsole(LOG_LEVELS.ERROR, formatted);
    this._writeToFile(formatted);
  }

  // Convenience method for detailed action logging
  action(action, status, details = null) {
    const message = `[ACTION] ${action} - ${status}`;
    const logFn = status.toUpperCase() === 'ERROR' ? this.error : this.info;
    logFn.call(this, message, details);
  }

  // Convenience method for API endpoint logging
  api(method, endpoint, status, details = null) {
    const statusStr = String(status);
    const message = `[API] ${method.toUpperCase()} ${endpoint} - ${statusStr}`;
    const logFn = statusStr.startsWith('4') || statusStr.startsWith('5') 
      ? this.error 
      : this.info;
    logFn.call(this, message, details);
  }

  // Timing helper
  time(label) {
    this._timers = this._timers || {};
    this._timers[label] = Date.now();
    this.debug(`⏱️  Timer started: ${label}`);
  }

  timeEnd(label) {
    if (!this._timers || !this._timers[label]) {
      this.warn(`Timer not found: ${label}`);
      return;
    }
    const duration = Date.now() - this._timers[label];
    delete this._timers[label];
    this.info(`⏱️  Timer ended: ${label} (${duration}ms)`);
    return duration;
  }
}

module.exports = Logger;
