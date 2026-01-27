/**
 * 历史记录管理
 * 管理生成的脚本历史
 */

export interface ScriptHistoryItem {
  id: string;
  name: string;
  description: string;
  url: string;
  domain: string;
  script: string;
  userRequest: string;
  createdAt: Date;
  tags?: string[];
}

export interface HistoryFilter {
  domain?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

const HISTORY_STORAGE_KEY = 'vibemonkey_script_history';
const MAX_HISTORY_ITEMS = 100;

/**
 * 历史记录管理器
 */
export class HistoryManager {
  /**
   * 添加历史记录
   */
  async add(item: Omit<ScriptHistoryItem, 'id' | 'createdAt'>): Promise<ScriptHistoryItem> {
    const history = await this.getAll();
    
    const newItem: ScriptHistoryItem = {
      ...item,
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date(),
    };

    // 添加到开头
    history.unshift(newItem);

    // 限制数量
    if (history.length > MAX_HISTORY_ITEMS) {
      history.splice(MAX_HISTORY_ITEMS);
    }

    await this.saveAll(history);
    return newItem;
  }

  /**
   * 获取所有历史记录
   */
  async getAll(): Promise<ScriptHistoryItem[]> {
    const result = await browser.storage.local.get(HISTORY_STORAGE_KEY) as Record<string, ScriptHistoryItem[]>;
    const history = result[HISTORY_STORAGE_KEY] || [];
    return history.map(item => ({
      ...item,
      createdAt: new Date(item.createdAt),
    }));
  }

  /**
   * 搜索历史记录
   */
  async search(filter: HistoryFilter = {}): Promise<ScriptHistoryItem[]> {
    let history = await this.getAll();

    // 域名过滤
    if (filter.domain) {
      history = history.filter(item => item.domain === filter.domain);
    }

    // 搜索过滤
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      history = history.filter(item =>
        item.name.toLowerCase().includes(searchLower) ||
        item.description.toLowerCase().includes(searchLower) ||
        item.userRequest.toLowerCase().includes(searchLower)
      );
    }

    // 分页
    const offset = filter.offset || 0;
    const limit = filter.limit || 20;
    history = history.slice(offset, offset + limit);

    return history;
  }

  /**
   * 获取单个历史记录
   */
  async get(id: string): Promise<ScriptHistoryItem | null> {
    const history = await this.getAll();
    return history.find(item => item.id === id) || null;
  }

  /**
   * 删除历史记录
   */
  async delete(id: string): Promise<void> {
    const history = await this.getAll();
    const filtered = history.filter(item => item.id !== id);
    await this.saveAll(filtered);
  }

  /**
   * 清空所有历史记录
   */
  async clear(): Promise<void> {
    await browser.storage.local.remove(HISTORY_STORAGE_KEY);
  }

  /**
   * 获取域名统计
   */
  async getDomainStats(): Promise<Record<string, number>> {
    const history = await this.getAll();
    const stats: Record<string, number> = {};
    
    for (const item of history) {
      stats[item.domain] = (stats[item.domain] || 0) + 1;
    }

    return stats;
  }

  /**
   * 保存所有历史记录
   */
  private async saveAll(history: ScriptHistoryItem[]): Promise<void> {
    await browser.storage.local.set({ [HISTORY_STORAGE_KEY]: history });
  }
}

/**
 * 创建历史记录管理器实例
 */
export function createHistoryManager(): HistoryManager {
  return new HistoryManager();
}
