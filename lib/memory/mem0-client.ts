/**
 * Mem0 记忆系统客户端
 * 支持云端 API 和本地存储两种模式
 */

export type MemoryType = 'user_preference' | 'website_knowledge' | 'script_version';

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  metadata: {
    domain?: string;
    scriptName?: string;
    version?: string;
    tags?: string[];
    [key: string]: unknown;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryFilter {
  type?: MemoryType;
  domain?: string;
  tags?: string[];
}

export interface MemoryHistory {
  oldContent: string;
  newContent: string;
  changedAt: Date;
}

export interface Mem0Config {
  apiKey?: string;
  useLocalStorage?: boolean;
}

const MEM0_API_URL = 'https://api.mem0.ai/v1';

/**
 * Mem0 记忆系统客户端
 */
export class Mem0Client {
  private apiKey?: string;
  private useLocalStorage: boolean;

  constructor(config: Mem0Config = {}) {
    this.apiKey = config.apiKey;
    this.useLocalStorage = config.useLocalStorage ?? !config.apiKey;
  }

  /**
   * 添加记忆
   */
  async add(content: string, type: MemoryType, metadata: Memory['metadata'] = {}): Promise<Memory> {
    if (this.useLocalStorage) {
      return this.addLocal(content, type, metadata);
    }
    return this.addCloud(content, type, metadata);
  }

  /**
   * 搜索记忆
   */
  async search(query: string, filter?: MemoryFilter): Promise<Memory[]> {
    if (this.useLocalStorage) {
      return this.searchLocal(query, filter);
    }
    return this.searchCloud(query, filter);
  }

  /**
   * 获取记忆历史
   */
  async history(memoryId: string): Promise<MemoryHistory[]> {
    if (this.useLocalStorage) {
      return this.historyLocal(memoryId);
    }
    return this.historyCloud(memoryId);
  }

  /**
   * 更新记忆
   */
  async update(id: string, content: string): Promise<Memory> {
    if (this.useLocalStorage) {
      return this.updateLocal(id, content);
    }
    return this.updateCloud(id, content);
  }

  /**
   * 删除记忆
   */
  async delete(id: string): Promise<void> {
    if (this.useLocalStorage) {
      return this.deleteLocal(id);
    }
    return this.deleteCloud(id);
  }

  // ========== 本地存储实现 ==========

  private async addLocal(content: string, type: MemoryType, metadata: Memory['metadata']): Promise<Memory> {
    const memories = await this.getAllLocal();
    
    const memory: Memory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type,
      content,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    memories.push(memory);
    await this.saveAllLocal(memories);

    return memory;
  }

  private async searchLocal(query: string, filter?: MemoryFilter): Promise<Memory[]> {
    const memories = await this.getAllLocal();
    const queryLower = query.toLowerCase();

    return memories.filter(m => {
      // 类型过滤
      if (filter?.type && m.type !== filter.type) return false;
      
      // 域名过滤
      if (filter?.domain && m.metadata.domain !== filter.domain) return false;
      
      // 标签过滤
      if (filter?.tags && filter.tags.length > 0) {
        const memTags = m.metadata.tags || [];
        if (!filter.tags.some(t => memTags.includes(t))) return false;
      }

      // 内容搜索（简单的关键词匹配）
      return m.content.toLowerCase().includes(queryLower) ||
             m.metadata.domain?.toLowerCase().includes(queryLower) ||
             m.metadata.scriptName?.toLowerCase().includes(queryLower);
    });
  }

  private async historyLocal(memoryId: string): Promise<MemoryHistory[]> {
    const historyKey = `mem0_history_${memoryId}`;
    const result = await browser.storage.local.get(historyKey) as Record<string, MemoryHistory[]>;
    return (result[historyKey] || []).map((h: MemoryHistory) => ({
      ...h,
      changedAt: new Date(h.changedAt),
    }));
  }

  private async updateLocal(id: string, content: string): Promise<Memory> {
    const memories = await this.getAllLocal();
    const index = memories.findIndex(m => m.id === id);
    
    if (index === -1) {
      throw new Error(`Memory not found: ${id}`);
    }

    const oldMemory = memories[index];
    
    // 保存历史
    const historyKey = `mem0_history_${id}`;
    const historyResult = await browser.storage.local.get(historyKey) as Record<string, MemoryHistory[]>;
    const history: MemoryHistory[] = historyResult[historyKey] || [];
    history.push({
      oldContent: oldMemory.content,
      newContent: content,
      changedAt: new Date(),
    });
    await browser.storage.local.set({ [historyKey]: history });

    // 更新记忆
    memories[index] = {
      ...oldMemory,
      content,
      updatedAt: new Date(),
    };
    await this.saveAllLocal(memories);

    return memories[index];
  }

  private async deleteLocal(id: string): Promise<void> {
    const memories = await this.getAllLocal();
    const filtered = memories.filter(m => m.id !== id);
    await this.saveAllLocal(filtered);
    
    // 删除历史
    const historyKey = `mem0_history_${id}`;
    await browser.storage.local.remove(historyKey);
  }

  private async getAllLocal(): Promise<Memory[]> {
    const result = await browser.storage.local.get('mem0_memories') as Record<string, Memory[]>;
    const memories = result.mem0_memories || [];
    return memories.map((m: Memory) => ({
      ...m,
      createdAt: new Date(m.createdAt),
      updatedAt: new Date(m.updatedAt),
    }));
  }

  private async saveAllLocal(memories: Memory[]): Promise<void> {
    await browser.storage.local.set({ mem0_memories: memories });
  }

  // ========== 云端 API 实现 ==========

  private async addCloud(content: string, type: MemoryType, metadata: Memory['metadata']): Promise<Memory> {
    const response = await fetch(`${MEM0_API_URL}/memories/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${this.apiKey}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content }],
        user_id: 'vibemonkey_user',
        metadata: { ...metadata, type },
      }),
    });

    if (!response.ok) {
      throw new Error(`Mem0 API error: ${response.status}`);
    }

    const data = await response.json();
    return this.parseCloudMemory(data);
  }

  private async searchCloud(query: string, filter?: MemoryFilter): Promise<Memory[]> {
    const response = await fetch(`${MEM0_API_URL}/memories/search/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        user_id: 'vibemonkey_user',
      }),
    });

    if (!response.ok) {
      throw new Error(`Mem0 API error: ${response.status}`);
    }

    const data = await response.json();
    let memories = data.map(this.parseCloudMemory);

    // 客户端过滤
    if (filter?.type) {
      memories = memories.filter((m: Memory) => m.type === filter.type);
    }
    if (filter?.domain) {
      memories = memories.filter((m: Memory) => m.metadata.domain === filter.domain);
    }

    return memories;
  }

  private async historyCloud(memoryId: string): Promise<MemoryHistory[]> {
    const response = await fetch(`${MEM0_API_URL}/memories/${memoryId}/history/`, {
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.map((h: { old_memory: string; new_memory: string; event: string; timestamp: string }) => ({
      oldContent: h.old_memory,
      newContent: h.new_memory,
      changedAt: new Date(h.timestamp),
    }));
  }

  private async updateCloud(id: string, content: string): Promise<Memory> {
    const response = await fetch(`${MEM0_API_URL}/memories/${id}/`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${this.apiKey}`,
      },
      body: JSON.stringify({ text: content }),
    });

    if (!response.ok) {
      throw new Error(`Mem0 API error: ${response.status}`);
    }

    const data = await response.json();
    return this.parseCloudMemory(data);
  }

  private async deleteCloud(id: string): Promise<void> {
    const response = await fetch(`${MEM0_API_URL}/memories/${id}/`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Mem0 API error: ${response.status}`);
    }
  }

  private parseCloudMemory(data: {
    id: string;
    memory: string;
    metadata?: Memory['metadata'];
    created_at?: string;
    updated_at?: string;
  }): Memory {
    return {
      id: data.id,
      type: (data.metadata?.type as MemoryType) || 'website_knowledge',
      content: data.memory,
      metadata: data.metadata || {},
      createdAt: new Date(data.created_at || Date.now()),
      updatedAt: new Date(data.updated_at || Date.now()),
    };
  }
}

/**
 * 获取 Mem0 API Key
 */
export async function getMem0ApiKey(): Promise<string | null> {
  const result = await browser.storage.local.get('mem0_api_key') as Record<string, string>;
  return result.mem0_api_key || null;
}

/**
 * 保存 Mem0 API Key
 */
export async function saveMem0ApiKey(apiKey: string): Promise<void> {
  await browser.storage.local.set({ mem0_api_key: apiKey });
}

/**
 * 创建 Mem0 客户端实例
 */
export async function createMem0Client(): Promise<Mem0Client> {
  const apiKey = await getMem0ApiKey();
  return new Mem0Client({ apiKey: apiKey || undefined });
}
