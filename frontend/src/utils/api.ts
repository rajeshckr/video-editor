/**
 * API Utility - Centralized fetch wrapper with automatic logging
 * Combines request and response into a single descriptive log
 * Shows: endpoint, method, duration, status, with expandable payload/response
 */

import Logger from './logger';

const logger = Logger.getInstance('API');
// Use environment variable for API_BASE
const API_BASE = import.meta.env.V_API_BASE_URL ;


export function getApiBaseUrl(): string {
  return API_BASE;
} 

/**
 * Parse request body for logging
 * Returns parsed JSON or indication of binary data
 */
function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (!body) return null;
  
  // If it's already a string, try to parse as JSON
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  
  // FormData (file uploads) - don't log binary data
  if (body instanceof FormData) {
    return '[FormData - binary content]';
  }
  
  // Blob/ArrayBuffer - binary data
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    return '[Binary data]';
  }
  
  return '[Unknown body type]';
}

/**
 * Wrapped fetch with automatic DEBUG logging
 * Combines request and response into a single log for clarity
 * 
 * @param endpoint - API endpoint (e.g., '/api/project/save')
 * @param options - Standard fetch options
 * @returns Promise<Response>
 */
export async function apiFetch(endpoint: string, options?: RequestInit): Promise<Response> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const method = options?.method || 'GET';
  
  // Parse request payload if present
  const requestPayload = parseRequestBody(options?.body);
  
  try {
    const startTime = performance.now();
    const response = await fetch(url, options);
    const duration = Math.round(performance.now() - startTime);
    
    // Clone response to read body without consuming it
    const clonedResponse = response.clone();
    let responseBody: unknown = null;
    
    // Try to parse response based on content-type
    const contentType = clonedResponse.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      try {
        responseBody = await clonedResponse.json();
      } catch {
        responseBody = '[Could not parse JSON response]';
      }
    } else if (contentType?.includes('text')) {
      try {
        responseBody = await clonedResponse.text();
      } catch {
        responseBody = '[Could not read text response]';
      }
    } else {
      responseBody = `[${contentType || 'unknown'} - binary]`;
    }
    
    // Combine request + response into a single JSON object for logging
    if (response.ok) {
      const requestLog: Record<string, unknown> = {
        method,
        endpoint
      };
      if (requestPayload) requestLog.payload = requestPayload;
      
      const responseLog: Record<string, unknown> = {
        status: response.status,
        duration
      };
      if (responseBody) responseLog.body = responseBody;
      
      const logData = {
        request: requestLog,
        response: responseLog
      };
      
      logger.debug(`${method} ${endpoint} [${duration}ms]`, logData);
    } else {
      // For errors, use error level and show the error response
      const requestLog: Record<string, unknown> = {
        method,
        endpoint
      };
      if (requestPayload) requestLog.payload = requestPayload;
      
      const logData = {
        request: requestLog,
        response: {
          status: response.status,
          statusText: response.statusText,
          duration,
          error: responseBody
        }
      };
      
      logger.error(`${method} ${endpoint} [${duration}ms] - ${response.status}`, logData);
    }
    
    return response;
    
  } catch (error) {
    const requestLog: Record<string, unknown> = {
      method,
      endpoint
    };
    if (requestPayload) requestLog.payload = requestPayload;
    
    const logData = {
      request: requestLog,
      response: {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.name : 'Unknown'
      }
    };
    
    logger.error(`${method} ${endpoint} - Network Error`, logData);
    throw error;
  }
}

/**
 * Convenience methods for common HTTP verbs
 */
export const api = {
  get: (endpoint: string, options?: Omit<RequestInit, 'method'>) => 
    apiFetch(endpoint, { ...options, method: 'GET' }),
  
  post: (endpoint: string, body?: unknown, options?: Omit<RequestInit, 'method' | 'body'>) => 
    apiFetch(endpoint, {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: body ? JSON.stringify(body) : undefined
    }),
  
  put: (endpoint: string, body?: unknown, options?: Omit<RequestInit, 'method' | 'body'>) => 
    apiFetch(endpoint, {
      ...options,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: body ? JSON.stringify(body) : undefined
    }),
  
  delete: (endpoint: string, options?: Omit<RequestInit, 'method'>) => 
    apiFetch(endpoint, { ...options, method: 'DELETE' }),
  
  // For file uploads with FormData
  upload: (endpoint: string, formData: FormData, options?: Omit<RequestInit, 'method' | 'body'>) => 
    apiFetch(endpoint, {
      ...options,
      method: 'POST',
      body: formData
    }),
  
  /**
   * Upload file(s) with progress and logging using XMLHttpRequest
   * @param endpoint - API endpoint (relative or absolute)
   * @param formData - FormData containing file(s)
   * @param onProgress - Progress callback (percent: number)
   * @param options - Optional: headers, logger override
   * @returns Promise resolving to parsed response or rejecting with error
   */
  uploadWithProgress(
    endpoint: string,
    formData: FormData,
    onProgress?: (percent: number) => void,
    options?: { headers?: Record<string, string>; logger?: unknown }
  ): Promise<unknown> {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const loggerInstance = (options?.logger || logger) as LoggerType;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (options?.headers) {
        Object.entries(options.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      }

      const startTime = performance.now();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      });

      xhr.addEventListener('load', () => {
        const duration = Math.round(performance.now() - startTime);
        let responseBody = null;
        try {
          responseBody = JSON.parse(xhr.responseText);
        } catch {
          responseBody = xhr.responseText;
        }
        const logData = {
          request: {
            method: 'POST',
            endpoint,
            payload: '[FormData - binary content]'
          },
          response: {
            status: xhr.status,
            duration,
            body: responseBody
          }
        };
        if (xhr.status >= 200 && xhr.status < 300) {
          loggerInstance.debug(`POST ${endpoint} [${duration}ms]`, logData);
          resolve(responseBody);
        } else {
          loggerInstance.error(`POST ${endpoint} [${duration}ms] - ${xhr.status}`, logData);
          reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        const duration = Math.round(performance.now() - startTime);
        const logData = {
          request: {
            method: 'POST',
            endpoint,
            payload: '[FormData - binary content]'
          },
          response: {
            status: xhr.status,
            duration,
            error: xhr.statusText
          }
        };
        loggerInstance.error(`POST ${endpoint} [${duration}ms] - Network Error`, logData);
        reject(new Error('Network error during upload'));
      });

      xhr.addEventListener('abort', () => {
        loggerInstance.error(`POST ${endpoint} - Upload aborted`);
        reject(new Error('Upload aborted'));
      });

      xhr.send(formData);
    });
  }
};

// Export base URL for cases where full URL is needed
export { API_BASE };

// Add at the top or near logger definition:
interface LoggerType {
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}