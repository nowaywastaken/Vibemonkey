/**
 * Userscript.Zone API 集成
 * 搜索用户脚本的另一个仓库
 */

export interface UserscriptZoneScript {
  id: number;
  name: string;
  description: string;
  author: string;
  url: string;
  includes: string[];
  matches: string[];
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserscriptZoneSearchResult {
  success: boolean;
  scripts: UserscriptZoneScript[];
  total: number;
}

const USERSCRIPT_ZONE_API = 'https://www.userscript.zone/api';

/**
 * Userscript.Zone 客户端
 */
export class UserscriptZoneClient {
  /**
   * 搜索脚本
   */
  async search(query: string, limit = 10): Promise<UserscriptZoneSearchResult> {
    try {
      // Userscript.Zone 实际上使用 GreasyFork 的数据，这里模拟一个兼容的搜索
      const encodedQuery = encodeURIComponent(query);
      const url = `https://greasyfork.org/scripts.json?q=${encodedQuery}&per_page=${limit}`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return { success: false, scripts: [], total: 0 };
      }

      const data = await response.json() as Array<{
        id: number;
        name: string;
        description: string;
        url: string;
        code_url: string;
        version: string;
        users: number;
        created_at: string;
        updated_at: string;
      }>;

      const scripts: UserscriptZoneScript[] = data.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        author: 'Unknown',
        url: item.url,
        includes: [],
        matches: [],
        version: item.version || '1.0',
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));

      return {
        success: true,
        scripts,
        total: scripts.length,
      };
    } catch (error) {
      console.error('[VibeMokey] Userscript.Zone search error:', error);
      return { success: false, scripts: [], total: 0 };
    }
  }

  /**
   * 按域名搜索脚本
   */
  async searchByDomain(domain: string, limit = 10): Promise<UserscriptZoneSearchResult> {
    return this.search(`site:${domain}`, limit);
  }

  /**
   * 获取热门脚本
   */
  async getPopular(limit = 10): Promise<UserscriptZoneSearchResult> {
    try {
      const url = `https://greasyfork.org/scripts.json?per_page=${limit}`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return { success: false, scripts: [], total: 0 };
      }

      const data = await response.json() as Array<{
        id: number;
        name: string;
        description: string;
        url: string;
        version: string;
        users: number;
        created_at: string;
        updated_at: string;
      }>;

      const scripts: UserscriptZoneScript[] = data.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        author: 'Unknown',
        url: item.url,
        includes: [],
        matches: [],
        version: item.version || '1.0',
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));

      return {
        success: true,
        scripts,
        total: scripts.length,
      };
    } catch (error) {
      console.error('[VibeMokey] Userscript.Zone popular error:', error);
      return { success: false, scripts: [], total: 0 };
    }
  }
}

/**
 * 创建 Userscript.Zone 客户端实例
 */
export function createUserscriptZoneClient(): UserscriptZoneClient {
  return new UserscriptZoneClient();
}
