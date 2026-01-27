/**
 * 自愈机制模块
 * 监控脚本运行时错误并自动修复
 */

export interface RuntimeError {
  type: 'console_error' | 'network_error' | 'selector_error' | 'timeout_error';
  message: string;
  stack?: string;
  selector?: string;
  url?: string;
  timestamp: Date;
}

export interface HealingAction {
  type: 'update_selector' | 'update_match' | 'optimize_performance' | 'retry';
  description: string;
  originalValue?: string;
  suggestedValue?: string;
}

export interface HealingResult {
  error: RuntimeError;
  actions: HealingAction[];
  success: boolean;
}

/**
 * 自愈系统
 */
export class SelfHealingSystem {
  private errorHistory: RuntimeError[] = [];
  private maxHistorySize = 100;

  /**
   * 记录错误
   */
  recordError(error: RuntimeError): void {
    this.errorHistory.push({
      ...error,
      timestamp: new Date(),
    });

    // 限制历史记录大小
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * 分析错误并提出修复建议
   */
  analyzeError(error: RuntimeError): HealingAction[] {
    const actions: HealingAction[] = [];

    switch (error.type) {
      case 'console_error':
        actions.push(...this.analyzeConsoleError(error));
        break;
      case 'network_error':
        actions.push(...this.analyzeNetworkError(error));
        break;
      case 'selector_error':
        actions.push(...this.analyzeSelectorError(error));
        break;
      case 'timeout_error':
        actions.push(...this.analyzeTimeoutError(error));
        break;
    }

    return actions;
  }

  /**
   * 分析控制台错误
   */
  private analyzeConsoleError(error: RuntimeError): HealingAction[] {
    const actions: HealingAction[] = [];
    const message = error.message.toLowerCase();

    // TypeError: Cannot read property 'xxx' of null/undefined
    if (message.includes('cannot read') && (message.includes('null') || message.includes('undefined'))) {
      if (error.selector) {
        actions.push({
          type: 'update_selector',
          description: '选择器可能已失效，建议更新选择器',
          originalValue: error.selector,
        });
      }
    }

    // 元素未找到
    if (message.includes('not found') || message.includes('failed to execute')) {
      actions.push({
        type: 'update_selector',
        description: 'DOM 结构可能已变更，需要重新分析页面',
      });
    }

    return actions;
  }

  /**
   * 分析网络错误
   */
  private analyzeNetworkError(error: RuntimeError): HealingAction[] {
    const actions: HealingAction[] = [];
    const message = error.message.toLowerCase();

    // CORS 错误
    if (message.includes('cors') || message.includes('cross-origin')) {
      actions.push({
        type: 'retry',
        description: '遇到 CORS 限制，建议使用 GM_xmlhttpRequest 或后台脚本代理',
      });
    }

    // 403/401 错误
    if (message.includes('403') || message.includes('401')) {
      actions.push({
        type: 'retry',
        description: '请求被拒绝，可能需要添加认证头或修改请求策略',
      });
    }

    return actions;
  }

  /**
   * 分析选择器错误
   */
  private analyzeSelectorError(error: RuntimeError): HealingAction[] {
    const actions: HealingAction[] = [];

    if (error.selector) {
      // 检查选择器是否过于具体
      if (error.selector.includes(':nth-child') || error.selector.includes(':nth-of-type')) {
        actions.push({
          type: 'update_selector',
          description: '选择器使用了位置相关的伪类，可能不稳定',
          originalValue: error.selector,
          suggestedValue: this.simplifySelector(error.selector),
        });
      }

      // 检查是否使用了动态类名
      if (/\.[a-zA-Z]+[-_][a-zA-Z0-9]{4,}/.test(error.selector)) {
        actions.push({
          type: 'update_selector',
          description: '选择器可能包含动态生成的类名，建议使用更稳定的属性',
          originalValue: error.selector,
        });
      }
    }

    return actions;
  }

  /**
   * 分析超时错误
   */
  private analyzeTimeoutError(error: RuntimeError): HealingAction[] {
    return [{
      type: 'optimize_performance',
      description: '元素等待超时，建议增加超时时间或优化等待策略',
    }];
  }

  /**
   * 简化选择器
   */
  private simplifySelector(selector: string): string {
    // 移除位置相关的伪类
    let simplified = selector
      .replace(/:nth-child\(\d+\)/g, '')
      .replace(/:nth-of-type\(\d+\)/g, '');

    // 移除过长的类名路径
    const parts = simplified.split(' > ');
    if (parts.length > 3) {
      simplified = parts.slice(-2).join(' ');
    }

    return simplified.trim();
  }

  /**
   * 获取错误历史
   */
  getErrorHistory(): RuntimeError[] {
    return [...this.errorHistory];
  }

  /**
   * 获取特定域名的错误统计
   */
  getErrorStats(domain?: string): Record<string, number> {
    const stats: Record<string, number> = {
      console_error: 0,
      network_error: 0,
      selector_error: 0,
      timeout_error: 0,
    };

    for (const error of this.errorHistory) {
      if (!domain || error.url?.includes(domain)) {
        stats[error.type]++;
      }
    }

    return stats;
  }

  /**
   * 清空错误历史
   */
  clearHistory(): void {
    this.errorHistory = [];
  }
}

/**
 * 控制台错误捕获器
 * 用于在 Content Script 中捕获运行时错误
 */
export function setupConsoleCapture(
  onError: (error: RuntimeError) => void
): () => void {
  const originalError = console.error;

  console.error = function (...args) {
    // 调用原始的 console.error
    originalError.apply(console, args);

    // 解析错误信息
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');

    onError({
      type: 'console_error',
      message,
      timestamp: new Date(),
      url: window.location.href,
    });
  };

  // 监听全局错误
  const errorHandler = (event: ErrorEvent) => {
    onError({
      type: 'console_error',
      message: event.message,
      stack: event.error?.stack,
      timestamp: new Date(),
      url: window.location.href,
    });
  };

  window.addEventListener('error', errorHandler);

  // 返回清理函数
  return () => {
    console.error = originalError;
    window.removeEventListener('error', errorHandler);
  };
}

/**
 * 创建自愈系统实例
 */
export function createSelfHealingSystem(): SelfHealingSystem {
  return new SelfHealingSystem();
}
