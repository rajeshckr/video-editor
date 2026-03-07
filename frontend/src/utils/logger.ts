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
  INFO: 'var(--in-point)',   // Green
  WARN: '#eab308',   // Yellow
  ERROR: 'var(--playhead)'   // Red
};

interface LoggerConfig {
  enableConsole: boolean;
  moduleName: string;
}

class Logger {
  private moduleName: string;
  private enableConsole: boolean;
  private timers: Map<string, number> = new Map();

  constructor(config: Partial<LoggerConfig> = {}) {
    this.moduleName = config.moduleName || 'App';
    this.enableConsole = config.enableConsole !== false;
  }

  static getInstance(moduleName: string = 'App'): Logger {
    return new Logger({ moduleName });
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const module = `[${this.moduleName}]`;
    const levelTag = `[${level}]`;

    let formatted = `${levelTag} ${module} ${message}`;

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
    
    const logParts = formatted.split('\n');
    const messageWithoutData = logParts[0];
    const dataLines = logParts.slice(1);

    // Simple log with color styling but no font information text
    console.log(
      `%c${messageWithoutData}`,
      `color: ${color}; font-weight: bold;`
    );
    
    // Log expandable data if present
    if (dataLines.length > 0) {
      const dataStr = dataLines.join('\n');
      try {
        const jsonData = JSON.parse(dataStr);
        console.log(jsonData);
      } catch {
        console.log(dataStr);
      }
    }
  }

  debug(message: string, data?: unknown): void {
    const formatted = this.formatMessage('DEBUG', message, data);
    this.logToConsole('DEBUG', formatted);
  }

  info(message: string, data?: unknown): void {
    const formatted = this.formatMessage('INFO', message, data);
    this.logToConsole('INFO', formatted);
  }

  warn(message: string, data?: unknown): void {
    const formatted = this.formatMessage('WARN', message, data);
    this.logToConsole('WARN', formatted);
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

}

export default Logger;
