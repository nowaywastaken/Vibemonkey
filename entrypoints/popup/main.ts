/**
 * VibeMokey Popup Main Script
 * 重构版：支持脚本列表、Agent 状态、流式更新
 */
import './style.css';

// 类型定义
interface ScriptInfo {
  id: string;
  name: string;
  matchPattern: string;
  description: string;
}

interface OtherDomainScript {
  id: string;
  name: string;
  domain: string;
  matchPattern: string;
}

interface ScriptListResponse {
  success: boolean;
  domain: string;
  activeScripts: ScriptInfo[];
  inactiveScripts: ScriptInfo[];
  otherDomainScripts: OtherDomainScript[];
}

type AgentStatus = 'idle' | 'thinking' | 'writing' | 'tool_calling' | 'error';

// DOM 元素
const elements = {
  // Header
  extensionToggle: document.getElementById('extension-toggle') as HTMLInputElement,
  settingsBtn: document.getElementById('settings-btn') as HTMLButtonElement,
  
  // Domain & Scripts
  currentDomain: document.getElementById('current-domain') as HTMLSpanElement,
  activeScripts: document.getElementById('active-scripts') as HTMLDivElement,
  inactiveScripts: document.getElementById('inactive-scripts') as HTMLDivElement,
  
  // Chat
  userRequest: document.getElementById('user-request') as HTMLTextAreaElement,
  sendBtn: document.getElementById('send-btn') as HTMLButtonElement,
  
  // Agent Status
  statusIndicator: document.getElementById('status-indicator') as HTMLSpanElement,
  statusText: document.getElementById('status-text') as HTMLSpanElement,
  agentMessage: document.getElementById('agent-message') as HTMLDivElement,
  agentMessageText: document.getElementById('agent-message-text') as HTMLSpanElement,
  
  // Result
  resultSection: document.getElementById('result-section') as HTMLDivElement,
  auditScore: document.getElementById('audit-score') as HTMLSpanElement,
  copyBtn: document.getElementById('copy-btn') as HTMLButtonElement,
  scriptOutput: document.getElementById('script-output') as HTMLPreElement,
  
  // Footer
  modelName: document.getElementById('model-name') as HTMLSpanElement,
  tokenUsage: document.getElementById('token-usage') as HTMLSpanElement,
  
  // Other Scripts
  toggleOtherScripts: document.getElementById('toggle-other-scripts') as HTMLButtonElement,
  otherScriptsCount: document.getElementById('other-scripts-count') as HTMLSpanElement,
  otherScripts: document.getElementById('other-scripts') as HTMLDivElement,
  
  // Settings Modal
  settingsModal: document.getElementById('settings-modal') as HTMLDivElement,
  closeSettings: document.getElementById('close-settings') as HTMLButtonElement,
  openrouterKey: document.getElementById('openrouter-key') as HTMLInputElement,
  mem0Key: document.getElementById('mem0-key') as HTMLInputElement,
  saveSettings: document.getElementById('save-settings') as HTMLButtonElement,
  
  // Loading
  loading: document.getElementById('loading') as HTMLDivElement,
  loadingText: document.getElementById('loading-text') as HTMLSpanElement,
};

// 状态
let currentUrl = '';
let currentDomain = '';
let streamPort: any = null; // Port 类型

// 初始化
async function init(): Promise<void> {
  connectPort();
  await updateCurrentTab();
  await checkApiStatus();
  await loadScriptList();
  // 不再需要轮询，通过 Port 接收状态更新
  bindEvents();
}

// 建立长连接
function connectPort(): void {
  streamPort = browser.runtime.connect({ name: 'vibemonkey-stream' });
  
  streamPort.onMessage.addListener((message: any) => {
    switch (message.type) {
      case 'AGENT_STATUS_UPDATE':
        updateStatus(message.payload.status, getStatusLabel(message.payload.status));
        if (message.payload.message) {
          showAgentMessage(message.payload.message);
        }
        break;
        
      case 'SCRIPT_GENERATION_START':
        showLoading('正在生成...');
        elements.resultSection.classList.remove('hidden');
        elements.scriptOutput.textContent = '';
        break;
        
      case 'SCRIPT_GENERATION_CHUNK':
        elements.scriptOutput.textContent += message.payload;
        // 自动滚动到底部
        elements.scriptOutput.scrollTop = elements.scriptOutput.scrollHeight;
        break;
        
      case 'SCRIPT_GENERATION_COMPLETE':
        hideLoading();
        const { success, script, auditScore, error } = message.payload;
        if (success) {
          elements.scriptOutput.textContent = script;
          if (auditScore !== undefined) {
            const score = auditScore;
            elements.auditScore.textContent = `${score}/100`;
            elements.auditScore.className = `audit-score ${score >= 80 ? 'good' : score >= 60 ? 'medium' : 'bad'}`;
          }
          // 刷新脚本列表
          loadScriptList();
        } else {
          showAgentMessage(error || '生成完成，但发生错误');
        }
        break;
        
      case 'SCRIPT_GENERATION_ERROR':
        hideLoading();
        showAgentMessage(message.payload || '生成失败');
        break;
    }
  });

  streamPort.onDisconnect.addListener(() => {
    console.log('Stream port disconnected, reconnecting...');
    setTimeout(connectPort, 1000);
  });
}

// ... (updateCurrentTab, checkApiStatus, loadScriptList, renderScriptList remain same)

// 处理发送
async function handleSend(): Promise<void> {
  const request = elements.userRequest.value.trim();
  if (!request) return;
  
  // 检查是否是拒绝的请求类型
  if (isRejectedRequest(request)) {
    showAgentMessage('抱歉，我专注于脚本自动化增强，暂不支持内容总结功能。');
    return;
  }
  
  showLoading('正在处理...');
  
  try {
    // 获取页面信息
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    let pageInfo;
    
    if (tab?.id) {
      try {
        const pageResponse = await browser.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
        if (pageResponse?.success) {
          pageInfo = pageResponse.info;
        }
      } catch {
        // Content script 可能未加载
      }
    }
    
    // 清空上次结果
    elements.scriptOutput.textContent = '';
    elements.resultSection.classList.add('hidden');
    elements.auditScore.textContent = '';
    
    // 通过 Port 发送流式生成请求
    if (streamPort) {
      streamPort.postMessage({
        type: 'GENERATE_SCRIPT_STREAM',
        payload: {
          userRequest: request,
          currentUrl,
          pageInfo: pageInfo ? {
            title: pageInfo.title,
            domain: currentDomain,
            markdown: pageInfo.markdown,
          } : undefined,
        },
      });
      
      // 清空输入
      elements.userRequest.value = '';
    } else {
      showAgentMessage('连接断开，请刷新重试');
      connectPort(); // 尝试重连
    }
    
  } catch (error) {
    hideLoading();
    console.error('Generate script error:', error);
    showAgentMessage('生成失败，请检查网络连接');
  }
}

// 更新当前标签页信息
async function updateCurrentTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    currentUrl = tab.url;
    try {
      const urlObj = new URL(tab.url);
      currentDomain = urlObj.hostname;
      elements.currentDomain.textContent = currentDomain;
    } catch {
      elements.currentDomain.textContent = '-';
    }
  }
}

// 检查 API 状态
async function checkApiStatus(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_STATUS' });
    if (response?.apiConfigured) {
      updateStatus('idle', '已连接');
    } else {
      updateStatus('error', '请配置 API Key');
    }
  } catch (error) {
    console.error('Check API status error:', error);
    updateStatus('error', '连接失败');
  }
}

// 加载脚本列表
async function loadScriptList(): Promise<void> {
  if (!currentUrl) return;
  
  try {
    const response: ScriptListResponse = await browser.runtime.sendMessage({
      type: 'GET_SCRIPT_LIST',
      payload: { url: currentUrl },
    });
    
    if (response?.success) {
      renderScriptList(response);
    }
  } catch (error) {
    console.error('Load script list error:', error);
  }
}

// 渲染脚本列表
function renderScriptList(data: ScriptListResponse): void {
  // 激活的脚本
  if (data.activeScripts.length > 0) {
    elements.activeScripts.innerHTML = data.activeScripts.map(script => `
      <div class="script-item active" data-id="${script.id}">
        <span class="script-status-icon">✅</span>
        <div class="script-info">
          <div class="script-name">${escapeHtml(script.name)}</div>
          <div class="script-match">${escapeHtml(script.matchPattern)}</div>
        </div>
        <label class="toggle-switch script-toggle">
          <input type="checkbox" checked data-script-id="${script.id}" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    `).join('');
  } else {
    elements.activeScripts.innerHTML = '<div class="empty-state">无激活脚本</div>';
  }
  
  // 未激活的脚本
  if (data.inactiveScripts.length > 0) {
    elements.inactiveScripts.innerHTML = data.inactiveScripts.map(script => `
      <div class="script-item inactive" data-id="${script.id}">
        <span class="script-status-icon">⏸️</span>
        <div class="script-info">
          <div class="script-name">${escapeHtml(script.name)}</div>
          <div class="script-match">${escapeHtml(script.matchPattern)}</div>
        </div>
        <label class="toggle-switch script-toggle">
          <input type="checkbox" data-script-id="${script.id}" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    `).join('');
  } else {
    elements.inactiveScripts.innerHTML = '';
  }
  
  // 其他域名脚本
  elements.otherScriptsCount.textContent = String(data.otherDomainScripts.length);
  if (data.otherDomainScripts.length > 0) {
    elements.otherScripts.innerHTML = data.otherDomainScripts.map(script => `
      <div class="other-script-item" data-id="${script.id}">
        <div>
          <span class="other-script-name">${escapeHtml(script.name)}</span>
          <div class="other-script-domain">${escapeHtml(script.domain)}</div>
        </div>
      </div>
    `).join('');
  }
  
  // 绑定脚本切换事件
  bindScriptToggleEvents();
}

// 绑定脚本切换事件
function bindScriptToggleEvents(): void {
  const toggles = document.querySelectorAll('.script-toggle input');
  toggles.forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const scriptId = input.dataset.scriptId;
      if (!scriptId) return;
      
      try {
        await browser.runtime.sendMessage({
          type: 'TOGGLE_SCRIPT',
          payload: { scriptId, enabled: input.checked },
        });
        // 重新加载列表
        await loadScriptList();
      } catch (error) {
        console.error('Toggle script error:', error);
      }
    });
  });
}

// 轮询 Agent 状态
async function pollAgentStatus(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_AGENT_STATUS' });
    if (response) {
      updateStatus(response.status, getStatusLabel(response.status));
      if (response.message) {
        showAgentMessage(response.message);
      }
    }
  } catch (error) {
    // 忽略错误
  }
  
  // 每 2 秒轮询一次
  setTimeout(pollAgentStatus, 2000);
}

// 获取状态标签
function getStatusLabel(status: AgentStatus): string {
  switch (status) {
    case 'idle': return '空闲';
    case 'thinking': return '正在思考...';
    case 'writing': return '正在编写脚本...';
    case 'tool_calling': return '正在调用工具...';
    case 'error': return '发生错误';
    default: return '未知状态';
  }
}

// 更新状态显示
function updateStatus(status: AgentStatus, text: string): void {
  elements.statusIndicator.className = `status-dot ${status}`;
  elements.statusText.textContent = text;
}

// 显示 Agent 消息
function showAgentMessage(message: string): void {
  if (message) {
    elements.agentMessage.classList.remove('hidden');
    elements.agentMessageText.textContent = message;
  } else {
    elements.agentMessage.classList.add('hidden');
  }
}

// 绑定事件
function bindEvents(): void {
  // 发送按钮
  elements.sendBtn.addEventListener('click', handleSend);
  
  // 回车发送
  elements.userRequest.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  
  // 复制按钮
  elements.copyBtn.addEventListener('click', handleCopy);
  
  // 设置按钮
  elements.settingsBtn.addEventListener('click', () => {
    elements.settingsModal.classList.remove('hidden');
    loadApiKeys();
  });
  
  // 关闭设置
  elements.closeSettings.addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
  });
  
  // 保存设置
  elements.saveSettings.addEventListener('click', handleSaveSettings);
  
  // 其他脚本折叠
  elements.toggleOtherScripts.addEventListener('click', () => {
    const section = elements.toggleOtherScripts.parentElement;
    section?.classList.toggle('collapsed');
    elements.otherScripts.classList.toggle('hidden');
  });
}



// 检查是否是拒绝的请求类型
function isRejectedRequest(request: string): boolean {
  const rejectedPatterns = [
    /总结.*内容/,
    /摘要/,
    /概括.*页面/,
    /summarize/i,
    /summary/i,
  ];
  
  return rejectedPatterns.some(pattern => pattern.test(request));
}

// 处理复制
async function handleCopy(): Promise<void> {
  const script = elements.scriptOutput.textContent;
  if (!script) return;
  
  try {
    await navigator.clipboard.writeText(script);
    const originalText = elements.copyBtn.textContent;
    elements.copyBtn.textContent = '✓';
    setTimeout(() => {
      elements.copyBtn.textContent = originalText;
    }, 1500);
  } catch (error) {
    console.error('Copy error:', error);
  }
}

// 加载 API Keys
async function loadApiKeys(): Promise<void> {
  try {
    const result = await browser.storage.local.get(['openrouter_api_key', 'mem0_api_key']) as { openrouter_api_key?: string; mem0_api_key?: string };
    if (result.openrouter_api_key) {
      elements.openrouterKey.value = result.openrouter_api_key;
    }
    if (result.mem0_api_key) {
      elements.mem0Key.value = result.mem0_api_key;
    }
  } catch (error) {
    console.error('Load API keys error:', error);
  }
}

// 保存设置
async function handleSaveSettings(): Promise<void> {
  const openrouterKey = elements.openrouterKey.value.trim();
  const mem0Key = elements.mem0Key.value.trim();
  
  try {
    await browser.runtime.sendMessage({
      type: 'SAVE_API_KEY',
      payload: {
        openrouter: openrouterKey || undefined,
        mem0: mem0Key || undefined,
      },
    });
    
    elements.settingsModal.classList.add('hidden');
    await checkApiStatus();
  } catch (error) {
    console.error('Save settings error:', error);
  }
}

// 显示加载
function showLoading(text: string): void {
  elements.loadingText.textContent = text;
  elements.loading.classList.remove('hidden');
}

// 隐藏加载
function hideLoading(): void {
  elements.loading.classList.add('hidden');
}

// 转义 HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 启动
init();
