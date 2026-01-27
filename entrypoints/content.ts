/**
 * VibeMokey Content Script
 * 负责 DOM 分析、语义提取和运行时错误捕获
 */

import { DOMPruner, PrunedElement } from '@/lib/dom/pruner';
import { prunedElementsToMarkdown, htmlToMarkdown } from '@/lib/dom/markdown-converter';
import { setupConsoleCapture, RuntimeError } from '@/lib/feedback/self-healing';
import { setupNetworkMonitor, NetworkError } from '@/lib/feedback/network-monitor';

// 消息类型
interface AnalyzeDOMRequest {
  type: 'ANALYZE_DOM_REQUEST';
  payload: {
    keywords: string[];
  };
}

interface GetPageInfoRequest {
  type: 'GET_PAGE_INFO';
}

interface GetRecentErrorsRequest {

  type: 'GET_RECENT_ERRORS';
}

interface GetNetworkStatsRequest {
  type: 'GET_NETWORK_STATS';
}

interface HighlightElementsRequest {
  type: 'HIGHLIGHT_ELEMENTS';
  payload: { type: string; selector: string }[];
}

type ContentMessage = 
  | AnalyzeDOMRequest 
  | GetPageInfoRequest 
  | GetNetworkStatsRequest 
  | GetRecentErrorsRequest 
  | HighlightElementsRequest;

// 网络监控器实例
let networkMonitor: ReturnType<typeof setupNetworkMonitor> | null = null;
// 错误历史
const recentErrors: RuntimeError[] = [];

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('[VibeMokey] Content script loaded');

    // 初始化网络监控
    networkMonitor = setupNetworkMonitor();

    // 初始化错误捕获
    setupConsoleCapture((error) => {
      recentErrors.push(error);
      if (recentErrors.length > 50) recentErrors.shift();
      
      // 报告给后台
      browser.runtime.sendMessage({
        type: 'REPORT_ERROR',
        payload: error
      }).catch(() => {});
    });

    // 监听来自 Background 的消息
    browser.runtime.onMessage.addListener((message: ContentMessage, sender, sendResponse) => {
      handleMessage(message).then(sendResponse);
      return true;
    });
  },
});

/**
 * 处理消息
 */
async function handleMessage(message: ContentMessage): Promise<unknown> {
  switch (message.type) {
    case 'ANALYZE_DOM_REQUEST':
      return handleAnalyzeDOM(message.payload);
    
    case 'GET_PAGE_INFO':
      return handleGetPageInfo();

    case 'HIGHLIGHT_ELEMENTS':
      return handleHighlightElements(message.payload);
    
    case 'GET_RECENT_ERRORS':
      return { success: true, errors: recentErrors };

    case 'GET_NETWORK_STATS':
      return { 
        success: true, 
        stats: networkMonitor?.getStats(),
        failedRequests: networkMonitor?.getFailedRequests()
      };
    
    default:
      return { error: 'Unknown message type' };
  }
}

/**
 * 分析页面 DOM
 */
function handleAnalyzeDOM(payload: { keywords: string[] }): {
  success: boolean;
  elements: PrunedElement[];
  markdown: string;
  stats: {
    totalElements: number;
    prunedCount: number;
    interactiveCount: number;
  };
} {
  try {
    const pruner = new DOMPruner({
      keywords: payload.keywords,
      maxElements: 100,
    });

    // 执行 DOM 剪枝
    const prunedElements = pruner.prune(document);

    // 统计信息
    const totalElements = document.querySelectorAll('*').length;
    const interactiveCount = prunedElements.filter(
      el => ['button', 'a', 'input', 'select', 'textarea'].includes(el.tag)
    ).length;

    // 转换为 Markdown
    const markdown = prunedElementsToMarkdown(prunedElements);

    return {
      success: true,
      elements: prunedElements,
      markdown,
      stats: {
        totalElements,
        prunedCount: prunedElements.length,
        interactiveCount,
      },
    };
  } catch (error) {
    console.error('[VibeMokey] DOM analysis error:', error);
    return {
      success: false,
      elements: [],
      markdown: '',
      stats: { totalElements: 0, prunedCount: 0, interactiveCount: 0 },
    };
  }
}

/**
 * 获取页面基本信息
 */
function handleGetPageInfo(): {
  success: boolean;
  info: {
    url: string;
    title: string;
    domain: string;
    markdown: string;
  };
} {
  try {
    const url = window.location.href;
    const title = document.title;
    const domain = window.location.hostname;
    
    // 简单的页面结构提取
    const markdown = htmlToMarkdown(document);

    return {
      success: true,
      info: {
        url,
        title,
        domain,
        markdown: markdown.slice(0, 10000), // 限制大小
      },
    };
  } catch (error) {
    console.error('[VibeMokey] Get page info error:', error);
    return {
      success: false,
      info: {
        url: window.location.href,
        title: document.title || '',
        domain: window.location.hostname,
        markdown: '',
      },
    };
  }
}

/**
 * 高亮元素 (Shadow Execution Feedback)
 */
function handleHighlightElements(effects: { type: string; selector: string }[]): { success: boolean } {
  effects.forEach(effect => {
    if (!effect.selector) return;
    try {
      const elements = document.querySelectorAll(effect.selector);
      elements.forEach(el => {
        const htmlEl = el as HTMLElement;
        const originalOutline = htmlEl.style.outline;
        const originalTransition = htmlEl.style.transition;
        
        htmlEl.style.outline = '3px solid rgba(255, 0, 0, 0.7)';
        htmlEl.style.transition = 'outline 0.3s ease';
        
        // 添加标签
        const label = document.createElement('div');
        label.textContent = `AI: ${effect.type}`;
        label.style.position = 'absolute';
        label.style.background = 'rgba(255, 0, 0, 0.9)';
        label.style.color = 'white';
        label.style.fontSize = '12px';
        label.style.padding = '4px 8px';
        label.style.borderRadius = '4px';
        label.style.zIndex = '2147483647';
        label.style.pointerEvents = 'none';
        label.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        
        const rect = htmlEl.getBoundingClientRect();
        label.style.top = `${window.scrollY + rect.top - 30}px`;
        label.style.left = `${window.scrollX + rect.left}px`;
        document.body.appendChild(label);

        // 3秒后移除
        setTimeout(() => {
          htmlEl.style.outline = originalOutline;
          htmlEl.style.transition = originalTransition;
          label.remove();
        }, 3000);
      });
    } catch (e) {
      console.error('[VibeMokey] Highlight error:', e);
    }
  });
  return { success: true };
}
