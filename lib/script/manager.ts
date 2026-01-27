/**
 * 脚本管理器
 * 管理已启用/激活的脚本，处理存储和检索
 */

export interface ActiveScript {
  id: string;
  name: string;
  description: string;
  code: string;
  matches: string[];
  enabled: boolean;
  createdAt: number;
  lastModified: number;
}

const STORAGE_KEY = 'vibemonkey_active_scripts';

export class ScriptManager {
  /**
   * 添加新脚本
   */
  async addScript(script: Omit<ActiveScript, 'id' | 'createdAt' | 'lastModified' | 'enabled'>): Promise<ActiveScript> {
    const scripts = await this.getAllScripts();
    
    // 生成 ID
    const newScript: ActiveScript = {
      ...script,
      id: `script_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      enabled: true,
      createdAt: Date.now(),
      lastModified: Date.now(),
    };

    scripts.push(newScript);
    await this.saveAllScripts(scripts);
    
    return newScript;
  }

  /**
   * 更新脚本
   */
  async updateScript(id: string, updates: Partial<Omit<ActiveScript, 'id' | 'createdAt'>>): Promise<ActiveScript | null> {
    const scripts = await this.getAllScripts();
    const index = scripts.findIndex(s => s.id === id);
    
    if (index === -1) {
      return null;
    }

    const updatedScript = {
      ...scripts[index],
      ...updates,
      lastModified: Date.now(),
    };

    scripts[index] = updatedScript;
    await this.saveAllScripts(scripts);

    return updatedScript;
  }

  /**
   * 删除脚本
   */
  async deleteScript(id: string): Promise<boolean> {
    const scripts = await this.getAllScripts();
    const newScripts = scripts.filter(s => s.id !== id);
    
    if (newScripts.length === scripts.length) {
      return false;
    }

    await this.saveAllScripts(newScripts);
    return true;
  }

  /**
   * 获取所有脚本
   */
  async getAllScripts(): Promise<ActiveScript[]> {
    const result = await browser.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as ActiveScript[]) || [];
  }

  /**
   * 根据 URL 获取匹配的脚本
   * @param url 目标 URL
   */
  async getScriptsForUrl(url: string): Promise<ActiveScript[]> {
    const scripts = await this.getAllScripts();
    const activeScripts = scripts.filter(s => s.enabled);
    
    return activeScripts.filter(script => {
      // 检查是否匹配
      return script.matches.some(pattern => this.isMatch(pattern, url));
    });
  }

  /**
   * 简单的模式匹配
   * 支持 * 通配符
   */
  private isMatch(pattern: string, url: string): boolean {
    // 转换 pattern 为 regex
    // 简单实现：将 * 替换为 .*，并转义其他特殊字符
    try {
      // 处理 <all_urls>
      if (pattern === '<all_urls>') return true;

      const regexStr = '^' + pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 转义正则特殊字符，除了 *
        .replace(/\*/g, '.*') + '$'; // 将 * 替换为 .*
      
      const regex = new RegExp(regexStr);
      return regex.test(url);
    } catch (e) {
      console.error('Pattern match error:', e);
      return false;
    }
  }

  /**
   * 保存所有脚本到 storage
   */
  private async saveAllScripts(scripts: ActiveScript[]): Promise<void> {
    await browser.storage.local.set({ [STORAGE_KEY]: scripts });
  }
}

/**
 * 创建脚本管理器实例
 */
export function createScriptManager(): ScriptManager {
  return new ScriptManager();
}
