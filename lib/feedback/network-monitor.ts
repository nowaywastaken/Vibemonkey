/**
 * 网络请求监控模块
 * 监控页面中的网络请求，检测异常和失败
 */

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  initiator?: string;
  duration?: number;
  error?: string;
  timestamp: Date;
}

export interface NetworkStats {
  total: number;
  successful: number;
  failed: number;
  pending: number;
  avgDuration: number;
}

export type NetworkErrorType = 'timeout' | 'blocked' | 'aborted' | 'network_error' | 'http_error';

export interface NetworkError {
  type: NetworkErrorType;
  request: NetworkRequest;
  message: string;
}

/**
 * 网络请求监控器
 */
export class NetworkMonitor {
  private requests: Map<string, NetworkRequest> = new Map();
  private errors: NetworkError[] = [];
  private onErrorCallback?: (error: NetworkError) => void;
  private maxRequests = 200;

  constructor(onError?: (error: NetworkError) => void) {
    this.onErrorCallback = onError;
  }

  /**
   * 记录请求开始
   */
  recordRequestStart(id: string, url: string, method: string, initiator?: string): void {
    const request: NetworkRequest = {
      id,
      url,
      method,
      initiator,
      timestamp: new Date(),
    };

    this.requests.set(id, request);
    this.cleanup();
  }

  /**
   * 记录请求完成
   */
  recordRequestComplete(id: string, status: number, statusText: string): void {
    const request = this.requests.get(id);
    if (request) {
      request.status = status;
      request.statusText = statusText;
      request.duration = Date.now() - request.timestamp.getTime();

      // 检查是否为错误状态
      if (status >= 400) {
        this.reportError({
          type: 'http_error',
          request,
          message: `HTTP ${status}: ${statusText}`,
        });
      }
    }
  }

  /**
   * 记录请求失败
   */
  recordRequestFailed(id: string, errorType: NetworkErrorType, message: string): void {
    const request = this.requests.get(id);
    if (request) {
      request.error = message;
      request.duration = Date.now() - request.timestamp.getTime();

      this.reportError({
        type: errorType,
        request,
        message,
      });
    }
  }

  /**
   * 报告错误
   */
  private reportError(error: NetworkError): void {
    this.errors.push(error);
    
    // 限制错误记录数量
    if (this.errors.length > 100) {
      this.errors.shift();
    }

    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): NetworkStats {
    let total = 0;
    let successful = 0;
    let failed = 0;
    let pending = 0;
    let totalDuration = 0;
    let durationCount = 0;

    this.requests.forEach(request => {
      total++;
      
      if (request.error) {
        failed++;
      } else if (request.status) {
        if (request.status >= 200 && request.status < 400) {
          successful++;
        } else {
          failed++;
        }
      } else {
        pending++;
      }

      if (request.duration) {
        totalDuration += request.duration;
        durationCount++;
      }
    });

    return {
      total,
      successful,
      failed,
      pending,
      avgDuration: durationCount > 0 ? totalDuration / durationCount : 0,
    };
  }

  /**
   * 获取最近的错误
   */
  getRecentErrors(limit = 10): NetworkError[] {
    return this.errors.slice(-limit);
  }

  /**
   * 获取失败的请求
   */
  getFailedRequests(): NetworkRequest[] {
    return Array.from(this.requests.values()).filter(
      r => r.error || (r.status && r.status >= 400)
    );
  }

  /**
   * 检查特定域名的请求状态
   */
  checkDomainHealth(domain: string): {
    total: number;
    failed: number;
    successRate: number;
  } {
    const domainRequests = Array.from(this.requests.values()).filter(
      r => r.url.includes(domain)
    );

    const failed = domainRequests.filter(
      r => r.error || (r.status && r.status >= 400)
    ).length;

    return {
      total: domainRequests.length,
      failed,
      successRate: domainRequests.length > 0 
        ? (domainRequests.length - failed) / domainRequests.length 
        : 1,
    };
  }

  /**
   * 清理旧请求
   */
  private cleanup(): void {
    if (this.requests.size > this.maxRequests) {
      const sorted = Array.from(this.requests.entries())
        .sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
      
      const toRemove = sorted.slice(0, this.requests.size - this.maxRequests);
      toRemove.forEach(([id]) => this.requests.delete(id));
    }
  }

  /**
   * 重置监控器
   */
  reset(): void {
    this.requests.clear();
    this.errors = [];
  }
}

/**
 * 创建 fetch 拦截器
 */
export function createFetchInterceptor(monitor: NetworkMonitor): void {
  const originalFetch = window.fetch;
  
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method || 'GET';
    const id = `fetch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    monitor.recordRequestStart(id, url, method);

    try {
      const response = await originalFetch(input, init);
      monitor.recordRequestComplete(id, response.status, response.statusText);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      let errorType: NetworkErrorType = 'network_error';
      if (message.includes('timeout')) {
        errorType = 'timeout';
      } else if (message.includes('abort')) {
        errorType = 'aborted';
      } else if (message.includes('block')) {
        errorType = 'blocked';
      }

      monitor.recordRequestFailed(id, errorType, message);
      throw error;
    }
  };
}

/**
 * 创建 XHR 拦截器
 */
export function createXHRInterceptor(monitor: NetworkMonitor): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    (this as XMLHttpRequest & { _monitorData: { id: string; url: string; method: string } })._monitorData = {
      id: `xhr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      url: url.toString(),
      method,
    };
    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null): void {
    const data = (this as XMLHttpRequest & { _monitorData?: { id: string; url: string; method: string } })._monitorData;
    
    if (data) {
      monitor.recordRequestStart(data.id, data.url, data.method);

      this.addEventListener('load', () => {
        monitor.recordRequestComplete(data.id, this.status, this.statusText);
      });

      this.addEventListener('error', () => {
        monitor.recordRequestFailed(data.id, 'network_error', 'XHR request failed');
      });

      this.addEventListener('timeout', () => {
        monitor.recordRequestFailed(data.id, 'timeout', 'XHR request timeout');
      });

      this.addEventListener('abort', () => {
        monitor.recordRequestFailed(data.id, 'aborted', 'XHR request aborted');
      });
    }

    return originalSend.call(this, body);
  };
}

/**
 * 创建网络监控器实例并设置拦截器
 */
export function setupNetworkMonitor(
  onError?: (error: NetworkError) => void
): NetworkMonitor {
  const monitor = new NetworkMonitor(onError);
  createFetchInterceptor(monitor);
  createXHRInterceptor(monitor);
  return monitor;
}
