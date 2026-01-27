/**
 * VibeMonkey Content Script
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
    weights?: Record<string, number>;
    topN?: number;
  };
}

interface FindElementsRequest {
  type: 'FIND_ELEMENTS';
  payload: {
    keywords: string[];
    weights?: Record<string, number>;
    topN?: number;
  };
}

interface InspectElementRequest {
  type: 'INSPECT_ELEMENT';
  payload: {
    selector: string;
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
  payload?: {
    urlPattern?: string;
  };
}

interface HighlightElementsRequest {
  type: 'HIGHLIGHT_ELEMENTS';
  payload: { type: string; selector: string }[];
}

interface ExecuteImmediatelyRequest {
  type: 'EXECUTE_IMMEDIATELY';
  payload: { code: string };
}

interface StopScriptRequest {
  type: 'STOP_SCRIPT_REQUEST';
  payload: { scriptId: string };
}

type ContentMessage = 
  | AnalyzeDOMRequest 
  | FindElementsRequest
  | InspectElementRequest
  | GetPageInfoRequest 
  | GetNetworkStatsRequest 
  | GetRecentErrorsRequest 
  | HighlightElementsRequest
  | ExecuteImmediatelyRequest
  | StopScriptRequest;

// 网络监控器实例
let networkMonitor: ReturnType<typeof setupNetworkMonitor> | null = null;
// 错误历史
const recentErrors: RuntimeError[] = [];

export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    console.log('[VibeMonkey] Content script loaded');

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

    // 运行匹配的脚本
    await runMatchedScripts();

    // 监听来自 Background 的消息
    browser.runtime.onMessage.addListener((message: ContentMessage, sender, sendResponse) => {
      handleMessage(message).then(sendResponse);
      return true;
    });
  },
});

/**
 * 运行匹配的脚本
 */
async function runMatchedScripts(): Promise<void> {
  try {
    const url = window.location.href;
    // 请求后台获取当前页面匹配的脚本代码
    const response = await browser.runtime.sendMessage({
      type: 'GET_MATCHING_SCRIPTS',
      payload: { url }
    });

    if (response?.success && response.scripts) {
      console.log(`[VibeMonkey] Found ${response.scripts.length} matching scripts`);
      
      for (const script of response.scripts) {
        try {
          console.log(`[VibeMonkey] Executing script: ${script.name}`);
          
          // 获取最新版本的代码
          // 注意：ScriptVersionManager 存储的是 VersionedScript
          const code = script.compiledCode || script.versions?.[0]?.compiledCode || script.code;
          
          if (!code) {
            console.warn(`[VibeMonkey] No code found for script: ${script.name}`);
            continue;
          }

          // 安全执行：使用 Function 构造函数或直接 eval（在沙箱受限的情况下）
          // 由于油猴脚本通常需要访问 window/document，这里直接执行
          // 在 MV3 中，如果使用了 CSP，可能需要特殊的处理
          const fn = new Function(code);
          fn();
          
        } catch (error) {
          console.error(`[VibeMonkey] Error executing script ${script.name}:`, error);
          // 报告运行时错误
          browser.runtime.sendMessage({
            type: 'REPORT_ERROR',
            payload: {
              type: 'console_error',
              message: `脚本 ${script.name} 执行失败: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date(),
              url: window.location.href
            }
          }).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error('[VibeMonkey] Failed to load/run scripts:', error);
  }
}

/**
 * 处理消息
 */
async function handleMessage(message: ContentMessage): Promise<unknown> {
  switch (message.type) {
    case 'ANALYZE_DOM_REQUEST':
      return handleAnalyzeDOM(message.payload);
    
    case 'FIND_ELEMENTS':
      return handleFindElements(message.payload);

    case 'INSPECT_ELEMENT':
      return handleInspectElement(message.payload);

    case 'GET_PAGE_INFO':
      return handleGetPageInfo();

    case 'HIGHLIGHT_ELEMENTS':
      return handleHighlightElements(message.payload);
    
    case 'GET_RECENT_ERRORS':
      return { success: true, errors: recentErrors };

    case 'GET_NETWORK_STATS':
      return { 
        success: true, 
        stats: networkMonitor?.getStats(message.payload?.urlPattern),
        failedRequests: networkMonitor?.getFailedRequests()
      };
    
    case 'EXECUTE_IMMEDIATELY':
      return handleExecuteImmediately(message.payload);

    case 'STOP_SCRIPT_REQUEST':
      return handleStopScript(message.payload);
    
    default:
      return { error: 'Unknown message type' };
  }
}

/**
 * 立即执行代码
 */
async function handleExecuteImmediately(payload: { code: string }) {
  try {
    const fn = new Function(payload.code);
    fn();
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * 停止脚本执行（简单模拟）
 */
async function handleStopScript(payload: { scriptId: string }) {
  // 实际上在浏览器中停止一个已经运行的脚本很难
  // 这里可以作为一个占位，或者如果脚本注册了清理函数则调用它
  console.log(`[VibeMonkey] Stop request for script: ${payload.scriptId}`);
  return { success: true, message: 'Stop signal received. Please refresh for full effect.' };
}

/**
 * 分析页面 DOM
 */
function handleAnalyzeDOM(payload: { keywords: string[]; weights?: Record<string, number>; topN?: number }): {
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
      weights: payload.weights,
      maxElements: payload.topN || 100,
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
    console.error('[VibeMonkey] DOM analysis error:', error);
    return {
      success: false,
      elements: [],
      markdown: '',
      stats: { totalElements: 0, prunedCount: 0, interactiveCount: 0 },
    };
  }
}

/**
 * 寻找元素（DTPP 核心逻辑）
 */
function handleFindElements(payload: { keywords: string[]; weights?: Record<string, number>; topN?: number }) {
  const result = handleAnalyzeDOM(payload);
  if (result.success) {
    return {
      success: true,
      candidates: result.elements.map(el => ({
        selector: el.selector,
        tag: el.tag,
        text: el.text,
        score: el.score,
        attributes: el.attributes
      }))
    };
  }
  return result;
}

/**
 * 检查特定元素
 */
function handleInspectElement(payload: { selector: string }) {
  try {
    const el = document.querySelector(payload.selector);
    if (!el) return { success: false, error: 'Element not found' };

    const styles = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    return {
      success: true,
      html: el.outerHTML.slice(0, 2000),
      computedStyles: {
        display: styles.display,
        visibility: styles.visibility,
        position: styles.position,
        zIndex: styles.zIndex,
        width: styles.width,
        height: styles.height,
        color: styles.color,
        backgroundColor: styles.backgroundColor
      },
      boundingRect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      },
      isVisible: rect.width > 0 && rect.height > 0 && styles.display !== 'none' && styles.visibility !== 'hidden'
    };
  } catch (error) {
    return { success: false, error: String(error) };
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
    console.error('[VibeMonkey] Get page info error:', error);
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
      console.error('[VibeMonkey] Highlight error:', e);
    }
  });
  return { success: true };
}
