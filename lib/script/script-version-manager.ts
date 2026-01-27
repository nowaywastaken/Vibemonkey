/**
 * 脚本版本管理器
 * 支持每个脚本最多保存 3 个历史版本，实现版本对比与回滚
 */

export interface ScriptVersion {
  version: number;
  code: string;           // TypeScript 源码
  compiledCode?: string;  // 编译后的 JS
  createdAt: number;
  userRequest?: string;   // 用户的原始需求
  changeNote?: string;    // 变更说明
}

export interface VersionedScript {
  id: string;
  name: string;
  description: string;
  matchPattern: string;   // 作用的具体 URL 模式
  domain: string;         // 主域名
  currentVersion: number;
  versions: ScriptVersion[];  // 最多保留 3 个版本
  enabled: boolean;
  createdAt: number;
  lastModified: number;
}

const STORAGE_KEY = 'vibemonkey_versioned_scripts';
const MAX_VERSIONS = 3;

/**
 * 从 URL 提取主域名
 */
export function extractMainDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * 脚本版本管理器
 */
export class ScriptVersionManager {
  /**
   * 添加新脚本
   */
  async addScript(script: {
    name: string;
    description: string;
    matchPattern: string;
    domain: string;
    code: string;
    compiledCode?: string;
    userRequest?: string;
    changeNote?: string;
  }): Promise<VersionedScript> {
    const scripts = await this.getAllScripts();
    
    const newScript: VersionedScript = {
      id: `vscript_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name: script.name,
      description: script.description,
      matchPattern: script.matchPattern,
      domain: script.domain,
      currentVersion: 1,
      versions: [{
        version: 1,
        code: script.code,
        compiledCode: script.compiledCode,
        createdAt: Date.now(),
        userRequest: script.userRequest,
        changeNote: script.changeNote || '初始版本',
      }],
      enabled: true,
      createdAt: Date.now(),
      lastModified: Date.now(),
    };

    scripts.push(newScript);
    await this.saveAllScripts(scripts);
    
    return newScript;
  }

  /**
   * 更新脚本（创建新版本）
   */
  async updateScript(
    scriptId: string,
    update: {
      code: string;
      compiledCode?: string;
      userRequest?: string;
      changeNote?: string;
      name?: string;
      description?: string;
    }
  ): Promise<VersionedScript | null> {
    const scripts = await this.getAllScripts();
    const index = scripts.findIndex(s => s.id === scriptId);
    
    if (index === -1) {
      return null;
    }

    const script = scripts[index];
    const newVersion = script.currentVersion + 1;
    
    // 创建新版本
    const newVersionData: ScriptVersion = {
      version: newVersion,
      code: update.code,
      compiledCode: update.compiledCode,
      createdAt: Date.now(),
      userRequest: update.userRequest,
      changeNote: update.changeNote || `版本 ${newVersion}`,
    };

    // 添加新版本，保持最多 MAX_VERSIONS 个
    script.versions.unshift(newVersionData);
    if (script.versions.length > MAX_VERSIONS) {
      script.versions = script.versions.slice(0, MAX_VERSIONS);
    }

    // 更新元数据
    script.currentVersion = newVersion;
    script.lastModified = Date.now();
    if (update.name) script.name = update.name;
    if (update.description) script.description = update.description;

    scripts[index] = script;
    await this.saveAllScripts(scripts);

    return script;
  }

  /**
   * 获取指定版本的代码
   */
  async getScriptVersion(scriptId: string, version?: number): Promise<ScriptVersion | null> {
    const script = await this.getScript(scriptId);
    if (!script) return null;

    if (version === undefined) {
      // 返回最新版本
      return script.versions[0] || null;
    }

    return script.versions.find(v => v.version === version) || null;
  }

  /**
   * 回滚到指定版本
   */
  async rollbackToVersion(scriptId: string, version: number): Promise<VersionedScript | null> {
    const script = await this.getScript(scriptId);
    if (!script) return null;

    const targetVersion = script.versions.find(v => v.version === version);
    if (!targetVersion) return null;

    // 创建一个新版本，内容为回滚目标
    return this.updateScript(scriptId, {
      code: targetVersion.code,
      compiledCode: targetVersion.compiledCode,
      changeNote: `回滚至版本 ${version}`,
    });
  }

  /**
   * 获取单个脚本
   */
  async getScript(scriptId: string): Promise<VersionedScript | null> {
    const scripts = await this.getAllScripts();
    return scripts.find(s => s.id === scriptId) || null;
  }

  /**
   * 获取所有脚本
   */
  async getAllScripts(): Promise<VersionedScript[]> {
    const result = await browser.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as VersionedScript[]) || [];
  }

  /**
   * 根据主域名获取脚本
   */
  async getScriptsByDomain(domain: string): Promise<VersionedScript[]> {
    const scripts = await this.getAllScripts();
    return scripts.filter(s => s.domain === domain || domain.endsWith(`.${s.domain}`));
  }

  /**
   * 根据 URL 获取匹配的脚本
   */
  async getScriptsForUrl(url: string): Promise<VersionedScript[]> {
    const scripts = await this.getAllScripts();
    const activeScripts = scripts.filter(s => s.enabled);
    
    return activeScripts.filter(script => {
      return this.isMatch(script.matchPattern, url);
    });
  }

  /**
   * 获取同一主域名下的所有脚本（供 Agent 使用）
   * 包含脚本的历史版本信息
   */
  async getDomainScriptsForAgent(domain: string): Promise<{
    scriptId: string;
    name: string;
    description: string;
    matchPattern: string;
    enabled: boolean;
    currentCode: string;
    versions: {
      version: number;
      createdAt: number;
      changeNote?: string;
    }[];
  }[]> {
    const scripts = await this.getScriptsByDomain(domain);
    
    return scripts.map(script => ({
      scriptId: script.id,
      name: script.name,
      description: script.description,
      matchPattern: script.matchPattern,
      enabled: script.enabled,
      currentCode: script.versions[0]?.code || '',
      versions: script.versions.map(v => ({
        version: v.version,
        createdAt: v.createdAt,
        changeNote: v.changeNote,
      })),
    }));
  }

  /**
   * 切换脚本启用状态
   */
  async toggleScript(scriptId: string, enabled: boolean): Promise<VersionedScript | null> {
    const scripts = await this.getAllScripts();
    const index = scripts.findIndex(s => s.id === scriptId);
    
    if (index === -1) return null;

    scripts[index].enabled = enabled;
    scripts[index].lastModified = Date.now();
    
    await this.saveAllScripts(scripts);
    return scripts[index];
  }

  /**
   * 删除脚本
   */
  async deleteScript(scriptId: string): Promise<boolean> {
    const scripts = await this.getAllScripts();
    const newScripts = scripts.filter(s => s.id !== scriptId);
    
    if (newScripts.length === scripts.length) {
      return false;
    }

    await this.saveAllScripts(newScripts);
    return true;
  }

  /**
   * 简单的模式匹配
   */
  private isMatch(pattern: string, url: string): boolean {
    try {
      if (pattern === '<all_urls>') return true;

      const regexStr = '^' + pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*') + '$';
      
      const regex = new RegExp(regexStr);
      return regex.test(url);
    } catch {
      console.error('Pattern match error for pattern:', pattern);
      return false;
    }
  }

  /**
   * 保存所有脚本
   */
  private async saveAllScripts(scripts: VersionedScript[]): Promise<void> {
    await browser.storage.local.set({ [STORAGE_KEY]: scripts });
  }
}

/**
 * 创建脚本版本管理器实例
 */
export function createScriptVersionManager(): ScriptVersionManager {
  return new ScriptVersionManager();
}
