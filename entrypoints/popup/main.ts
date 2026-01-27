/**
 * VibeMokey Popup Main Script
 */
import './style.css';

// History item interface
interface HistoryItem {
  id: string;
  name: string;
  description: string;
  url: string;
  domain: string;
  script: string;
  userRequest: string;
  createdAt: Date;
}

// DOM 元素
const elements = {
  statusIndicator: document.getElementById('status-indicator') as HTMLSpanElement,
  statusText: document.getElementById('status-text') as HTMLSpanElement,
  currentUrl: document.getElementById('current-url') as HTMLSpanElement,
  userRequest: document.getElementById('user-request') as HTMLTextAreaElement,
  analyzeBtn: document.getElementById('analyze-btn') as HTMLButtonElement,
  generateBtn: document.getElementById('generate-btn') as HTMLButtonElement,
  resultSection: document.getElementById('result-section') as HTMLDivElement,
  scriptOutput: document.getElementById('script-output') as HTMLPreElement,
  auditScore: document.getElementById('audit-score') as HTMLSpanElement,
  copyBtn: document.getElementById('copy-btn') as HTMLButtonElement,
  loading: document.getElementById('loading') as HTMLDivElement,
  loadingText: document.getElementById('loading-text') as HTMLSpanElement,
  settingsBtn: document.getElementById('settings-btn') as HTMLButtonElement,
  settingsModal: document.getElementById('settings-modal') as HTMLDivElement,
  closeSettings: document.getElementById('close-settings') as HTMLButtonElement,
  openrouterKey: document.getElementById('openrouter-key') as HTMLInputElement,
  mem0Key: document.getElementById('mem0-key') as HTMLInputElement,
  saveSettings: document.getElementById('save-settings') as HTMLButtonElement,
  // Tab elements
  mainContent: document.querySelector('.main-content') as HTMLElement,
  historyPanel: document.getElementById('history-panel') as HTMLDivElement,
  historyList: document.getElementById('history-list') as HTMLDivElement,
};

// Current tab state
let currentTab: 'generate' | 'history' = 'generate';

// 初始化
async function init(): Promise<void> {
  // 获取当前标签页信息
  await updateCurrentTab();
  
  // 检查 API 状态
  await checkApiStatus();
  
  // 加载保存的 API Keys
  await loadApiKeys();
  
  // 绑定事件
  bindEvents();
}

// 更新当前标签页
async function updateCurrentTab(): Promise<void> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const url = new URL(tab.url);
      elements.currentUrl.textContent = url.hostname + url.pathname.slice(0, 30);
      elements.currentUrl.title = tab.url;
    }
  } catch (error) {
    console.error('Failed to get current tab:', error);
  }
}

// 检查 API 状态
async function checkApiStatus(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_STATUS' }) as {
      apiConfigured: boolean;
      mem0Configured: boolean;
    };
    
    if (response.apiConfigured) {
      elements.statusIndicator.classList.remove('offline');
      elements.statusIndicator.classList.add('online');
      elements.statusText.textContent = '已连接';
    } else {
      elements.statusIndicator.classList.remove('online');
      elements.statusIndicator.classList.add('offline');
      elements.statusText.textContent = '未配置 API Key';
    }
  } catch (error) {
    console.error('Failed to check API status:', error);
  }
}

// 加载 API Keys
async function loadApiKeys(): Promise<void> {
  try {
    const result = await browser.storage.local.get(['openrouter_api_key', 'mem0_api_key']) as Record<string, string>;
    if (result.openrouter_api_key) {
      elements.openrouterKey.value = '••••••••••••••••';
    }
    if (result.mem0_api_key) {
      elements.mem0Key.value = '••••••••••••••••';
    }
  } catch (error) {
    console.error('Failed to load API keys:', error);
  }
}

// 绑定事件
function bindEvents(): void {
  // 分析页面
  elements.analyzeBtn.addEventListener('click', handleAnalyze);
  
  // 生成脚本
  elements.generateBtn.addEventListener('click', handleGenerate);
  
  // 复制脚本
  elements.copyBtn.addEventListener('click', handleCopy);
  
  // 设置弹窗
  elements.settingsBtn.addEventListener('click', () => {
    elements.settingsModal.classList.remove('hidden');
  });
  
  elements.closeSettings.addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
  });
  
  // 保存设置
  elements.saveSettings.addEventListener('click', handleSaveSettings);
  
  // 点击模态框外部关闭
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      elements.settingsModal.classList.add('hidden');
    }
  });

  // Tab navigation
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab as 'generate' | 'history';
      switchTab(tab);
    });
  });
}

// Switch between tabs
function switchTab(tab: 'generate' | 'history'): void {
  currentTab = tab;
  
  // Update tab button states
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
  });
  
  // Show/hide panels
  if (tab === 'generate') {
    elements.mainContent.classList.remove('hidden');
    elements.historyPanel.classList.add('hidden');
  } else {
    elements.mainContent.classList.add('hidden');
    elements.historyPanel.classList.remove('hidden');
    loadHistory();
  }
}

// Load history
async function loadHistory(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_HISTORY',
      payload: { limit: 20 },
    }) as { success: boolean; history: HistoryItem[] };
    
    if (response.success && response.history.length > 0) {
      elements.historyList.innerHTML = response.history.map(item => `
        <div class="history-item" data-id="${item.id}">
          <div class="history-item-header">
            <span class="history-item-name">${escapeHtml(item.name)}</span>
            <span class="history-item-date">${formatDate(new Date(item.createdAt))}</span>
          </div>
          <div class="history-item-domain">${escapeHtml(item.domain)}</div>
          <div class="history-item-description">${escapeHtml(item.userRequest)}</div>
          <div class="history-item-actions">
            <button class="icon-btn copy-history-btn" data-script="${encodeURIComponent(item.script)}" title="复制">📋</button>
            <button class="icon-btn delete-history-btn" data-id="${item.id}" title="删除">🗑️</button>
          </div>
        </div>
      `).join('');
      
      // Bind history item events
      elements.historyList.querySelectorAll('.copy-history-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const script = decodeURIComponent((btn as HTMLElement).dataset.script || '');
          await navigator.clipboard.writeText(script);
          (btn as HTMLElement).textContent = '✓';
          setTimeout(() => { (btn as HTMLElement).textContent = '📋'; }, 1500);
        });
      });
      
      elements.historyList.querySelectorAll('.delete-history-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.id;
          if (id) {
            await browser.runtime.sendMessage({ type: 'DELETE_HISTORY', payload: { id } });
            loadHistory();
          }
        });
      });
    } else {
      elements.historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
    }
  } catch (error) {
    console.error('Failed to load history:', error);
    elements.historyList.innerHTML = '<div class="history-empty">加载失败</div>';
  }
}

// Helper functions
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
  
  return date.toLocaleDateString('zh-CN');
}

// 显示加载状态
function showLoading(text: string): void {
  elements.loading.classList.remove('hidden');
  elements.loadingText.textContent = text;
  elements.analyzeBtn.disabled = true;
  elements.generateBtn.disabled = true;
}

// 隐藏加载状态
function hideLoading(): void {
  elements.loading.classList.add('hidden');
  elements.analyzeBtn.disabled = false;
  elements.generateBtn.disabled = false;
}

// 处理分析页面
async function handleAnalyze(): Promise<void> {
  showLoading('正在分析页面...');
  
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab');
    }
    
    const result = await browser.runtime.sendMessage({
      type: 'ANALYZE_DOM',
      payload: { tabId: tab.id, keywords: [] },
    }) as { success: boolean; markdown?: string; stats?: { prunedCount: number; interactiveCount: number } };
    
    if (result.success) {
      elements.resultSection.classList.remove('hidden');
      elements.scriptOutput.textContent = 
        `分析完成！\n\n` +
        `交互元素: ${result.stats?.interactiveCount || 0}\n` +
        `关键节点: ${result.stats?.prunedCount || 0}\n\n` +
        (result.markdown?.slice(0, 1000) || '');
    } else {
      alert('页面分析失败');
    }
  } catch (error) {
    console.error('Analyze error:', error);
    alert('页面分析失败: ' + (error instanceof Error ? error.message : 'Unknown error'));
  } finally {
    hideLoading();
  }
}

// 处理生成脚本
async function handleGenerate(): Promise<void> {
  const userRequest = elements.userRequest.value.trim();
  if (!userRequest) {
    alert('请输入你的需求');
    return;
  }
  
  showLoading('正在生成脚本...');
  
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      throw new Error('No active tab');
    }
    
    // 先获取页面信息
    let pageInfo = undefined;
    if (tab.id) {
      try {
        pageInfo = await browser.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' }) as {
          success: boolean;
          info: { title: string; domain: string; markdown: string };
        };
        if (pageInfo.success) {
          pageInfo = pageInfo.info;
        }
      } catch {
        // Content script 可能未加载
      }
    }
    
    const result = await browser.runtime.sendMessage({
      type: 'GENERATE_SCRIPT',
      payload: {
        userRequest,
        currentUrl: tab.url,
        pageInfo,
      },
    }) as { success: boolean; script?: string; auditScore?: number; error?: string };
    
    if (result.success && result.script) {
      elements.resultSection.classList.remove('hidden');
      elements.scriptOutput.textContent = result.script;
      
      // Display audit score
      if (result.auditScore !== undefined) {
        elements.auditScore.textContent = `${result.auditScore}分`;
        elements.auditScore.className = 'audit-score';
        if (result.auditScore >= 80) {
          elements.auditScore.classList.add('good');
        } else if (result.auditScore >= 50) {
          elements.auditScore.classList.add('medium');
        } else {
          elements.auditScore.classList.add('bad');
        }
      }
    } else {
      alert('脚本生成失败: ' + (result.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Generate error:', error);
    alert('脚本生成失败: ' + (error instanceof Error ? error.message : 'Unknown error'));
  } finally {
    hideLoading();
  }
}

// 处理复制
async function handleCopy(): Promise<void> {
  const script = elements.scriptOutput.textContent;
  if (script) {
    try {
      await navigator.clipboard.writeText(script);
      elements.copyBtn.textContent = '✓';
      setTimeout(() => {
        elements.copyBtn.textContent = '📋';
      }, 2000);
    } catch (error) {
      console.error('Copy error:', error);
    }
  }
}

// 处理保存设置
async function handleSaveSettings(): Promise<void> {
  const openrouterKey = elements.openrouterKey.value;
  const mem0Key = elements.mem0Key.value;
  
  // 只有不是占位符时才保存
  const payload: { openrouter?: string; mem0?: string } = {};
  if (openrouterKey && !openrouterKey.includes('•')) {
    payload.openrouter = openrouterKey;
  }
  if (mem0Key && !mem0Key.includes('•')) {
    payload.mem0 = mem0Key;
  }
  
  if (Object.keys(payload).length > 0) {
    try {
      await browser.runtime.sendMessage({
        type: 'SAVE_API_KEY',
        payload,
      });
      
      await checkApiStatus();
      elements.settingsModal.classList.add('hidden');
    } catch (error) {
      console.error('Save settings error:', error);
      alert('保存失败');
    }
  } else {
    elements.settingsModal.classList.add('hidden');
  }
}

// 启动
init();
