/**
 * 脚本仓库 API 集成
 * 搜索 GreasyFork、Userscript.Zone 等仓库中的现有脚本
 */

import { createUserscriptZoneClient, UserscriptZoneClient } from './userscript-zone';

export interface ScriptInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  url: string;
  installs: number;
  rating?: number;
  codeUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SearchResult {
  source: 'greasyfork' | 'userscript_zone' | 'openuserjs';
  scripts: ScriptInfo[];
  total: number;
}

/**
 * 脚本仓库客户端
 */
export class ScriptRepository {
  private userscriptZone = createUserscriptZoneClient();

  /**
   * 搜索 GreasyFork
   */
  async searchGreasyFork(query: string, page = 1): Promise<SearchResult> {
    try {
      const params = new URLSearchParams({
        q: query,
        page: page.toString(),
      });

      // GreasyFork 的搜索 API
      const response = await fetch(`https://greasyfork.org/scripts.json?${params}`);

      if (!response.ok) {
        return { source: 'greasyfork', scripts: [], total: 0 };
      }

      const data = await response.json();
      
      const scripts: ScriptInfo[] = data.map((item: {
        id: number;
        name: string;
        description: string;
        version: string;
        url: string;
        code_url: string;
        total_installs: number;
        good_ratings: number;
        ok_ratings: number;
        bad_ratings: number;
        daily_installs: number;
        users: { name: string }[];
        created_at: string;
        updated_at: string;
      }) => ({
        id: `gf_${item.id}`,
        name: item.name,
        description: item.description,
        version: item.version,
        author: item.users?.[0]?.name || 'Unknown',
        url: item.url,
        codeUrl: item.code_url,
        installs: item.total_installs,
        rating: item.good_ratings / (item.good_ratings + item.ok_ratings + item.bad_ratings + 1),
        createdAt: new Date(item.created_at),
        updatedAt: new Date(item.updated_at),
      }));

      return {
        source: 'greasyfork',
        scripts,
        total: scripts.length,
      };
    } catch (error) {
      console.error('GreasyFork search error:', error);
      return { source: 'greasyfork', scripts: [], total: 0 };
    }
  }

  /**
   * 按域名搜索 GreasyFork
   */
  async searchByDomain(domain: string): Promise<SearchResult> {
    try {
      // GreasyFork 支持按网站域名搜索
      const response = await fetch(`https://greasyfork.org/scripts/by-site/${encodeURIComponent(domain)}.json`);

      if (!response.ok) {
        return { source: 'greasyfork', scripts: [], total: 0 };
      }

      const data = await response.json();
      
      const scripts: ScriptInfo[] = data.map((item: {
        id: number;
        name: string;
        description: string;
        version: string;
        url: string;
        code_url: string;
        total_installs: number;
        users: { name: string }[];
      }) => ({
        id: `gf_${item.id}`,
        name: item.name,
        description: item.description,
        version: item.version,
        author: item.users?.[0]?.name || 'Unknown',
        url: item.url,
        codeUrl: item.code_url,
        installs: item.total_installs,
      }));

      return {
        source: 'greasyfork',
        scripts,
        total: scripts.length,
      };
    } catch (error) {
      console.error('GreasyFork domain search error:', error);
      return { source: 'greasyfork', scripts: [], total: 0 };
    }
  }

  /**
   * 获取脚本代码
   */
  async fetchScriptCode(codeUrl: string): Promise<string | null> {
    try {
      const response = await fetch(codeUrl);
      if (!response.ok) return null;
      return response.text();
    } catch (error) {
      console.error('Fetch script code error:', error);
      return null;
    }
  }

  /**
   * 搜索 Userscript.Zone
   */
  async searchUserscriptZone(query: string): Promise<SearchResult> {
     const result = await this.userscriptZone.search(query);
     return {
         source: 'userscript_zone',
         scripts: result.scripts.map(s => ({
             id: `uz_${s.id}`,
             name: s.name,
             description: s.description,
             version: s.version,
             author: s.author,
             url: s.url,
             installs: 0,
             createdAt: new Date(s.createdAt),
             updatedAt: new Date(s.updatedAt)
         })),
         total: result.total
     };
  }

  /**
   * 搜索所有仓库
   */
  async searchAll(query: string): Promise<SearchResult[]> {
    const results = await Promise.all([
      this.searchGreasyFork(query),
      this.searchUserscriptZone(query)
    ]);

    return results.filter(r => r.scripts.length > 0);
  }

  /**
   * 按域名搜索所有仓库
   */
  async searchAllByDomain(domain: string): Promise<SearchResult[]> {
    const results = await Promise.all([
      this.searchByDomain(domain),
    ]);

    return results.filter(r => r.scripts.length > 0);
  }
}

/**
 * 创建脚本仓库客户端实例
 */
export function createScriptRepository(): ScriptRepository {
  return new ScriptRepository();
}
