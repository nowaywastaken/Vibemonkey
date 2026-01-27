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

interface GetNetworkStatsRequest {
  type: 'GET_NETWORK_STATS';
}

type ContentMessage = AnalyzeDOMRequest | GetPageInfoRequest | GetNetworkStatsRequest;

// 网络监控器实例
let networkMonitor: ReturnType<typeof setupNetworkMonitor> | null = null;

export default defineContentScript({
  matches: ['<all_urls>'],
  
  main() {
    console.log('[VibeMokey] Content script loaded on:', window.location.href);

    // 设置错误捕获
    const cleanup = setupConsoleCapture((error: RuntimeError) => {
      // 将错误报告给 Background
      browser.runtime.sendMessage({
        type: 'REPORT_ERROR',
        payload: error,
      });
    });

    // 设置网络监控
    networkMonitor = setupNetworkMonitor((error: NetworkError) => {
      // 将网络错误报告给 Background
      browser.runtime.sendMessage({
        type: 'REPORT_ERROR',
        payload: {
          type: 'network_error',
          message: error.message,
          url: error.request.url,
          stack: `${error.type}: ${error.request.method} ${error.request.url}`,
          timestamp: new Date(),
        } as RuntimeError,
      });
    });

    // 监听来自 Background 的消息
    browser.runtime.onMessage.addListener((message: ContentMessage, sender, sendResponse) => {
      handleMessage(message).then(sendResponse);
      return true;
    });

    // 页面卸载时清理
    window.addEventListener('beforeunload', cleanup);
    
    // 初始化：请求并注入脚本
    injectMatchingScripts();
  },
});

/**
 * 请求并注入匹配的脚本
 */
async function injectMatchingScripts() {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_MATCHING_SCRIPTS',
      payload: { url: window.location.href },
    });

    if (response?.success && response.scripts) {
      console.log(`[VibeMokey] Found ${response.scripts.length} matching scripts`);
      
      for (const script of response.scripts) {
        injectScript(script.code);
      }
    }
  } catch (error) {
    console.error('[VibeMokey] Failed to inject scripts:', error);
  }
}

/**
 * 注入脚本到页面
 */
function injectScript(code: string) {
  try {
    const script = document.createElement('script');
    script.textContent = code;
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // 执行后移除标签
  } catch (error) {
    console.error('[VibeMokey] Script injection error:', error);
  }
}

/**
 * 处理消息
 */
async function handleMessage(message: ContentMessage): Promise<unknown> {
  switch (message.type) {
    case 'ANALYZE_DOM_REQUEST':
      return handleAnalyzeDOM(message.payload);
    
    case 'GET_PAGE_INFO':
      return handleGetPageInfo();
    
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
