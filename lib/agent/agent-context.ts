/**
 * Agent 上下文构建器
 * 负责收集并构建 Agent 所需的完整上下文信息
 */

import { ScriptVersionManager, extractMainDomain } from '@/lib/script/script-version-manager';

/**
 * 脚本信息（供 Agent 使用）
 */
export interface ScriptInfo {
  scriptId: string;
  name: string;
  description: string;
  matchPattern: string;  // 具体作用网址
  enabled: boolean;
  currentCode: string;   // 现役 TypeScript
  versions: {            // 历史版本摘要
    version: number;
    createdAt: number;
    changeNote?: string;
  }[];
}

/**
 * 完整的 Agent 上下文
 */
export interface AgentContext {
  // 当前访问的具体网址
  currentUrl: string;
  currentDomain: string;
  currentPath: string;
  currentQuery: string;
  
  // 同一主域名下的所有脚本
  domainScripts: ScriptInfo[];
  
  // 按激活状态分组
  activeScripts: ScriptInfo[];
  inactiveScripts: ScriptInfo[];
  
  // 页面信息（可选）
  pageInfo?: {
    title: string;
    markdown: string;
  };
  
  // 记忆上下文（可选）
  memoryContext?: string;
}

/**
 * Agent 上下文构建器
 */
export class AgentContextBuilder {
  private scriptManager: ScriptVersionManager;

  constructor(scriptManager: ScriptVersionManager) {
    this.scriptManager = scriptManager;
  }

  /**
   * 构建完整的 Agent 上下文
   */
  async buildContext(
    currentUrl: string,
    pageInfo?: { title: string; markdown: string },
    memoryContext?: string
  ): Promise<AgentContext> {
    const urlObj = new URL(currentUrl);
    const domain = extractMainDomain(currentUrl);
    
    // 获取同域名下的所有脚本
    const domainScripts = await this.scriptManager.getDomainScriptsForAgent(domain);
    
    // 按激活状态分组
    const activeScripts = domainScripts.filter(s => s.enabled);
    const inactiveScripts = domainScripts.filter(s => !s.enabled);

    return {
      currentUrl,
      currentDomain: domain,
      currentPath: urlObj.pathname,
      currentQuery: urlObj.search,
      domainScripts,
      activeScripts,
      inactiveScripts,
      pageInfo,
      memoryContext,
    };
  }

  /**
   * 将上下文格式化为系统提示的一部分
   */
  formatContextForPrompt(context: AgentContext): string {
    const lines: string[] = [];
    
    // 当前 URL 信息
    lines.push('## 当前页面信息');
    lines.push(`- **完整 URL**: ${context.currentUrl}`);
    lines.push(`- **主域名**: ${context.currentDomain}`);
    lines.push(`- **路径**: ${context.currentPath}`);
    if (context.currentQuery) {
      lines.push(`- **查询参数**: ${context.currentQuery}`);
    }
    lines.push('');

    // 同域名脚本
    if (context.domainScripts.length > 0) {
      lines.push('## 当前域名下的脚本');
      lines.push('');
      
      // 激活的脚本
      if (context.activeScripts.length > 0) {
        lines.push('### 激活中的脚本');
        for (const script of context.activeScripts) {
          lines.push(`#### ${script.name}`);
          lines.push(`- **ID**: ${script.scriptId}`);
          lines.push(`- **作用地址**: ${script.matchPattern}`);
          lines.push(`- **描述**: ${script.description}`);
          lines.push(`- **版本历史**: ${script.versions.map(v => `v${v.version}`).join(', ')}`);
          lines.push('');
          lines.push('**当前代码**:');
          lines.push('```typescript');
          lines.push(script.currentCode);
          lines.push('```');
          lines.push('');
        }
      }
      
      // 未激活的脚本
      if (context.inactiveScripts.length > 0) {
        lines.push('### 未激活的脚本');
        for (const script of context.inactiveScripts) {
          lines.push(`- **${script.name}** (ID: ${script.scriptId})`);
          lines.push(`  - 作用地址: ${script.matchPattern}`);
          lines.push(`  - 描述: ${script.description}`);
        }
        lines.push('');
      }
    } else {
      lines.push('## 当前域名下的脚本');
      lines.push('目前没有为此域名创建任何脚本。');
      lines.push('');
    }

    // 页面信息
    if (context.pageInfo) {
      lines.push('## 页面内容摘要');
      lines.push(`**标题**: ${context.pageInfo.title}`);
      lines.push('');
      if (context.pageInfo.markdown) {
        lines.push('**页面结构**:');
        lines.push(context.pageInfo.markdown.slice(0, 3000)); // 限制长度
        lines.push('');
      }
    }

    // 记忆上下文
    if (context.memoryContext) {
      lines.push('## 相关记忆');
      lines.push(context.memoryContext);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 生成简洁的脚本列表（供 Popup 使用）
   */
  async getScriptListForPopup(currentUrl: string): Promise<{
    domain: string;
    activeScripts: {
      id: string;
      name: string;
      matchPattern: string;
      description: string;
    }[];
    inactiveScripts: {
      id: string;
      name: string;
      matchPattern: string;
      description: string;
    }[];
    otherDomainScripts: {
      id: string;
      name: string;
      domain: string;
      matchPattern: string;
    }[];
  }> {
    const domain = extractMainDomain(currentUrl);
    const allScripts = await this.scriptManager.getAllScripts();
    
    // 当前域名的脚本
    const domainScripts = allScripts.filter(
      s => s.domain === domain || domain.endsWith(`.${s.domain}`)
    );
    
    // 其他域名的脚本
    const otherScripts = allScripts.filter(
      s => s.domain !== domain && !domain.endsWith(`.${s.domain}`)
    );

    return {
      domain,
      activeScripts: domainScripts
        .filter(s => s.enabled)
        .map(s => ({
          id: s.id,
          name: s.name,
          matchPattern: s.matchPattern,
          description: s.description,
        })),
      inactiveScripts: domainScripts
        .filter(s => !s.enabled)
        .map(s => ({
          id: s.id,
          name: s.name,
          matchPattern: s.matchPattern,
          description: s.description,
        })),
      otherDomainScripts: otherScripts.map(s => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        matchPattern: s.matchPattern,
      })),
    };
  }
}

/**
 * 创建 Agent 上下文构建器
 */
export function createAgentContextBuilder(scriptManager: ScriptVersionManager): AgentContextBuilder {
  return new AgentContextBuilder(scriptManager);
}
