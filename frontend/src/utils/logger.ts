/**
 * Frontend Logger Utility
 * Provides structured logging with levels: DEBUG, INFO, WARN, ERROR
 * All logs include module name, timestamp, and optional data
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
} as const;

type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];

const LOG_COLORS: Record<LogLevel, string> = {
  DEBUG: '#888888',  // Gray
  INFO: '#22c55e',   // Green
  WARN: '#eab308',   // Yellow
  ERROR: '#ef4444'   // Red
};

interface LoggerConfig {
  enableConsole: boolean;
  enableLocalStorage: boolean;
  maxLocalStorageLogs: number;
  moduleName: string;
}

class Logger {
  private moduleName: string;
  private enableConsole: boolean;
  private enableLocalStorage: boolean;
  private maxLocalStorageLogs: number;
  private timers: Map<string, number> = new Map();

  constructor(config: Partial<LoggerConfig> = {}) {
    this.moduleName = config.moduleName || 'App';
    this.enableConsole = config.enableConsole !== false;
    this.enableLocalStorage = config.enableLocalStorage !== false;  // Default to TRUE
    this.maxLocalStorageLogs = config.maxLocalStorageLogs || 500;
  }

  static getInstance(moduleName: string = 'App'): Logger {
    return new Logger({ moduleName });
  }

  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString().replace('T', ' ').slice(0, -5);
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = this.formatTimestamp();
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

  private logToConsole(level: LogLevel, formatted: string): void {
    if (!this.enableConsole) return;

    const color = LOG_COLORS[level];
    const bgColor = level === 'ERROR' ? '#1e293b' : level === 'DEBUG' ? '#0f172a' : '#f8f8f8';
    const style = `color: ${color}; font-weight: bold; background-color: ${bgColor}; padding: 2px 6px; border-radius: 3px;`;

    // Full formatted message with groups for better readability
    const timestamp = this.formatTimestamp();
    const headerStyle = `${style} margin-right: 8px;`;
    
    const logParts = formatted.split('\n');
    const messageWithoutData = logParts[0];
    const dataLines = logParts.slice(1);

    console.log(
      `%c${timestamp}%c${level.padEnd(6)}%c${this.moduleName}`,
      'color: #888888; font-size: 11px;',
      headerStyle,
      'color: #6366f1; font-weight: bold;'
    );
    
    console.log('%c' + messageWithoutData, `color: ${color}; font-size: 13px; font-weight: 500;`);
    
    if (dataLines.length > 0) {
      const dataStr = dataLines.join('\n');
      try {
        // Try to parse and pretty-print JSON
        const jsonData = JSON.parse(dataStr);
        console.table(jsonData);
      } catch {
        // If not JSON, just log as grouped info
        console.log('%cData:', 'color: #666; font-weight: bold;', dataStr);
      }
    }
  }

  private saveToLocalStorage(formatted: string): void {
    if (!this.enableLocalStorage) return;

    try {
      const logsKey = '__app_logs__';
      let logs = [];

      try {
        const existing = localStorage.getItem(logsKey);
        if (existing) {
          logs = JSON.parse(existing);
        }
      } catch {
        logs = [];
      }

      logs.push({
        timestamp: new Date().toISOString(),
        message: formatted
      });

      // Remove logs older than 1 hour
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      logs = logs.filter((log: { timestamp: string; message: string }) => {
        try {
          const logTime = new Date(log.timestamp).getTime();
          return logTime > oneHourAgo;
        } catch {
          return true; // Keep logs with invalid timestamps just in case
        }
      });

      // Keep only the last N logs
      if (logs.length > this.maxLocalStorageLogs) {
        logs = logs.slice(-this.maxLocalStorageLogs);
      }

      localStorage.setItem(logsKey, JSON.stringify(logs));
    } catch {
      // Silent fail - localStorage might be full
    }
  }

  debug(message: string, data?: unknown): void {
    const formatted = this.formatMessage('DEBUG', message, data);
    this.logToConsole('DEBUG', formatted);
    this.saveToLocalStorage(formatted);
  }

  info(message: string, data?: unknown): void {
    const formatted = this.formatMessage('INFO', message, data);
    this.logToConsole('INFO', formatted);
    this.saveToLocalStorage(formatted);
  }

  warn(message: string, data?: unknown): void {
    const formatted = this.formatMessage('WARN', message, data);
    this.logToConsole('WARN', formatted);
    this.saveToLocalStorage(formatted);
  }

  error(message: string, errorOrData?: Error | unknown): void {
    let data = errorOrData;

    // Handle Error objects specially
    if (errorOrData instanceof Error) {
      data = {
        name: errorOrData.name,
        message: errorOrData.message,
        stack: errorOrData.stack
      };
    }

    const formatted = this.formatMessage('ERROR', message, data);
    this.logToConsole('ERROR', formatted);
    this.saveToLocalStorage(formatted);
  }

  /**
   * Log user actions with consistent format
   * @example logger.action('Create Track', 'SUCCESS', { trackId: '123', type: 'video' })
   */
  action(action: string, status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'ERROR', details?: unknown): void {
    const message = `[USER ACTION] ${action} - ${status}`;
    const level = status === 'ERROR' || status === 'FAILED' ? 'ERROR' : 'INFO';
    const formatFn = level === 'ERROR' ? this.error : this.info;
    formatFn.call(this, message, details);
  }

  /**
   * Log API calls
   * @example logger.api('POST', '/api/caption', 200, { captions: 5 })
   */
  api(method: string, endpoint: string, status: number, details?: unknown): void {
    const message = `[API] ${method.toUpperCase()} ${endpoint} - ${status}`;
    const level = status >= 400 ? 'ERROR' : 'INFO';
    const formatFn = level === 'ERROR' ? this.error : this.info;
    formatFn.call(this, message, details);
  }

  /**
   * Log component lifecycle events
   * @example logger.component('Timeline', 'mount')
   */
  component(componentName: string, event: string, details?: unknown): void {
    const message = `[COMPONENT] ${componentName} - ${event}`;
    this.debug(message, details);
  }

  /**
   * Log store updates
   * @example logger.store('editorStore', 'addClip', { clipId: '123' })
   */
  store(storeName: string, action: string, details?: unknown): void {
    const message = `[STORE] ${storeName} - ${action}`;
    this.debug(message, details);
  }

  /**
   * Performance timing
   */
  time(label: string): void {
    this.timers.set(label, Date.now());
    this.debug(`⏱️  Timer started: ${label}`);
  }

  timeEnd(label: string): number {
    const startTime = this.timers.get(label);
    if (!startTime) {
      this.warn(`Timer not found: ${label}`);
      return 0;
    }
    const duration = Date.now() - startTime;
    this.timers.delete(label);
    this.info(`⏱️  Timer ended: ${label} (${duration}ms)`);
    return duration;
  }

  /**
   * Get all logs from localStorage (automatically excludes logs older than 1 hour)
   */
  getLogs(): Array<{ timestamp: string; message: string }> {
    try {
      const logsJson = localStorage.getItem('__app_logs__');
      if (!logsJson) return [];
      
      const parsedLogs: Array<{ timestamp: string; message: string }> = JSON.parse(logsJson);
      
      // Remove logs older than 1 hour
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      const recentLogs = parsedLogs.filter((log: { timestamp: string; message: string }) => {
        try {
          const logTime = new Date(log.timestamp).getTime();
          return logTime > oneHourAgo;
        } catch {
          return true;
        }
      });
      
      return recentLogs;
    } catch {
      return [];
    }
  }

  /**
   * Clear all localStorage logs (manually cleared, otherwise auto-cleaned after 1 hour)
   */
  clearLogs(): void {
    try {
      localStorage.removeItem('__app_logs__');
      this.info('Logs cleared');
    } catch {
      this.warn('Failed to clear logs');
    }
  }

  /**
   * Print all stored logs to console (only shows last 1 hour of logs)
   */
  printAllLogs(): void {
    const logs = this.getLogs();
    console.group('%c📋 ALL STORED LOGS (Last 1 Hour)', 'color: #06b6d4; font-size: 16px; font-weight: bold;');
    console.log('%cℹ️  Logs older than 1 hour are automatically removed from storage', 'color: #888; font-size: 11px; font-style: italic;');
    if (logs.length === 0) {
      console.log('%cNo logs found', 'color: #999;');
    } else {
      logs.forEach((log, i) => {
        console.log(`%c[${i + 1}/${logs.length}] ${log.timestamp}`, 'color: #888; font-size: 11px;');
        console.log(log.message);
      });
    }
    console.groupEnd();
    console.log(`%c✅ Total logs: ${logs.length}`, 'color: #22c55e; font-weight: bold;');
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): void {
    const logs = this.getLogs();
    const content = JSON.stringify(logs, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Global debug utilities
export const setupGlobalDebugTools = (): void => {
  const debugLogger = Logger.getInstance('GlobalDebug');
  
  const debugTools: Record<string, unknown> = {
    // View all stored logs
    view: () => debugLogger.printAllLogs(),
    // Export logs
    export: () => debugLogger.exportLogs(),
    // Get raw logs
    get: () => debugLogger.getLogs(),
    // Clear logs
    clear: () => debugLogger.clearLogs(),
    // Create new logger
    create: (name: string) => Logger.getInstance(name),
    // Help text
    help: () => {
      console.log('%c📊 LOG DEBUG UTILITIES', 'color: #06b6d4; font-size: 14px; font-weight: bold;');
      console.log('%c__logs.view()%c   - Print all stored logs to console', 'color: #22c55e; font-weight: bold;', 'color: #666;');
      console.log('%c__logs.export()%c - Download logs as JSON file', 'color: #22c55e; font-weight: bold;', 'color: #666;');
      console.log('%c__logs.get()%c    - Get all logs as array', 'color: #22c55e; font-weight: bold;', 'color: #666;');
      console.log('%c__logs.clear()%c  - Clear all stored logs', 'color: #22c55e; font-weight: bold;', 'color: #666;');
      console.log('%c__logs.create(name)%c - Create new logger instance', 'color: #22c55e; font-weight: bold;', 'color: #666;');
    }
  };
  
  (window as unknown as Record<string, unknown>).__logs = debugTools;
  console.log('%c✨ Video Editor Debug Tools Ready', 'color: #06b6d4; font-size: 14px; font-weight: bold;');
  console.log('%cType: %c__logs.help()%c to see available commands', 'color: #666;', 'color: #22c55e; font-weight: bold;', 'color: #666;');
};

export default Logger;
