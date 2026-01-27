/**
 * VibeMokey Options Page Main Script
 */
import './style.css';

// 设置项接口
interface Settings {
  openrouterKey: string;
  mem0Key: string;
  defaultTarget: string;
  autoAudit: boolean;
  saveHistory: boolean;
  useMemory: boolean;
  pruneDepth: number;
  maxElements: number;
  theme: string;
  language: string;
}

// DOM 元素
const elements = {
  openrouterKey: document.getElementById('openrouter-key') as HTMLInputElement,
  mem0Key: document.getElementById('mem0-key') as HTMLInputElement,
  defaultTarget: document.getElementById('default-target') as HTMLSelectElement,
  autoAudit: document.getElementById('auto-audit') as HTMLInputElement,
  saveHistory: document.getElementById('save-history') as HTMLInputElement,
  useMemory: document.getElementById('use-memory') as HTMLInputElement,
  pruneDepth: document.getElementById('prune-depth') as HTMLSelectElement,
  maxElements: document.getElementById('max-elements') as HTMLInputElement,
  theme: document.getElementById('theme') as HTMLSelectElement,
  language: document.getElementById('language') as HTMLSelectElement,
  exportData: document.getElementById('export-data') as HTMLButtonElement,
  importData: document.getElementById('import-data') as HTMLButtonElement,
  clearHistory: document.getElementById('clear-history') as HTMLButtonElement,
  clearMemory: document.getElementById('clear-memory') as HTMLButtonElement,
  saveSettings: document.getElementById('save-settings') as HTMLButtonElement,
  saveStatus: document.getElementById('save-status') as HTMLSpanElement,
};

// 初始化
async function init(): Promise<void> {
  // 1. 优先绑定事件
  bindEvents();
  
  // 2. 加载设置
  try {
    await loadSettings();
  } catch (error) {
    console.error('Initialization error:', error);
    if (elements.saveStatus) {
      elements.saveStatus.textContent = '✗ 加载设置失败';
      elements.saveStatus.style.color = 'var(--error)';
    }
  }
}

// 加载设置
async function loadSettings(): Promise<void> {
  try {
    const result = await browser.storage.local.get([
      'openrouter_api_key',
      'mem0_api_key',
      'settings',
    ]) as Record<string, unknown>;

    // API Keys
    if (result.openrouter_api_key) {
      elements.openrouterKey.value = '••••••••••••••••';
    }
    if (result.mem0_api_key) {
      elements.mem0Key.value = '••••••••••••••••';
    }

    // 其他设置
    const settings = (result.settings || {}) as Partial<Settings>;
    
    if (settings.defaultTarget) {
      elements.defaultTarget.value = settings.defaultTarget;
    }
    if (settings.autoAudit !== undefined) {
      elements.autoAudit.checked = settings.autoAudit;
    }
    if (settings.saveHistory !== undefined) {
      elements.saveHistory.checked = settings.saveHistory;
    }
    if (settings.useMemory !== undefined) {
      elements.useMemory.checked = settings.useMemory;
    }
    if (settings.pruneDepth) {
      elements.pruneDepth.value = settings.pruneDepth.toString();
    }
    if (settings.maxElements) {
      elements.maxElements.value = settings.maxElements.toString();
    }
    if (settings.theme) {
      elements.theme.value = settings.theme;
    }
    if (settings.language) {
      elements.language.value = settings.language;
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// 保存设置
async function saveSettings(): Promise<void> {
  try {
    const saveData: Record<string, unknown> = {};

    // API Keys (只在非占位符时保存)
    if (elements.openrouterKey.value && !elements.openrouterKey.value.includes('•')) {
      saveData.openrouter_api_key = elements.openrouterKey.value;
    }
    if (elements.mem0Key.value && !elements.mem0Key.value.includes('•')) {
      saveData.mem0_api_key = elements.mem0Key.value;
    }

    // 其他设置
    saveData.settings = {
      defaultTarget: elements.defaultTarget.value,
      autoAudit: elements.autoAudit.checked,
      saveHistory: elements.saveHistory.checked,
      useMemory: elements.useMemory.checked,
      pruneDepth: parseInt(elements.pruneDepth.value),
      maxElements: parseInt(elements.maxElements.value),
      theme: elements.theme.value,
      language: elements.language.value,
    };

    await browser.storage.local.set(saveData);
    
    // 显示保存成功
    elements.saveStatus.textContent = '✓ 设置已保存';
    setTimeout(() => {
      elements.saveStatus.textContent = '';
    }, 3000);
  } catch (error) {
    console.error('Failed to save settings:', error);
    elements.saveStatus.textContent = '✗ 保存失败';
    elements.saveStatus.style.color = 'var(--error)';
  }
}

// 导出数据
async function exportData(): Promise<void> {
  try {
    const data = await browser.storage.local.get(null);
    
    // 删除敏感信息
    delete (data as Record<string, unknown>).openrouter_api_key;
    delete (data as Record<string, unknown>).mem0_api_key;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibemonkey-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to export data:', error);
    alert('导出失败');
  }
}

// 导入数据
async function importData(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      await browser.storage.local.set(data);
      await loadSettings();
      
      alert('导入成功');
    } catch (error) {
      console.error('Failed to import data:', error);
      alert('导入失败：无效的文件格式');
    }
  };

  input.click();
}

// 清空历史
async function clearHistory(): Promise<void> {
  if (!confirm('确定要清空所有历史记录吗？此操作不可撤销。')) {
    return;
  }

  try {
    await browser.storage.local.remove('vibemonkey_script_history');
    alert('历史记录已清空');
  } catch (error) {
    console.error('Failed to clear history:', error);
    alert('清空失败');
  }
}

// 清空记忆
async function clearMemory(): Promise<void> {
  if (!confirm('确定要清空所有记忆数据吗？此操作不可撤销。')) {
    return;
  }

  try {
    // 清空所有以 mem0_ 开头的存储
    const allData = await browser.storage.local.get(null) as Record<string, unknown>;
    const keysToRemove = Object.keys(allData).filter(
      key => key.startsWith('mem0_')
    );
    
    if (keysToRemove.length > 0) {
      await browser.storage.local.remove(keysToRemove);
    }
    
    alert('记忆数据已清空');
  } catch (error) {
    console.error('Failed to clear memory:', error);
    alert('清空失败');
  }
}

// 绑定事件
function bindEvents(): void {
  elements.saveSettings.addEventListener('click', saveSettings);
  elements.exportData.addEventListener('click', exportData);
  elements.importData.addEventListener('click', importData);
  elements.clearHistory.addEventListener('click', clearHistory);
  elements.clearMemory.addEventListener('click', clearMemory);
}

// 启动
init();
