/**
 * Agent 工具定义
 * 定义 DeepSeek V3.2 可调用的 Function Calling 工具
 */

import { Tool } from './deepseek';

/**
 * 分析 DOM 结构工具
 */
export const analyzeDomTool: Tool = {
  type: 'function',
  function: {
    name: 'analyze_dom',
    description: '分析当前页面的 DOM 结构，提取交互元素和关键节点',
    parameters: {
      type: 'object',
      properties: {
        selectors: {
          type: 'string',
          description: '要分析的 CSS 选择器，用逗号分隔。如果为空，则分析整个页面',
        },
        extractText: {
          type: 'string',
          description: '是否提取文本内容',
          enum: ['true', 'false'],
        },
      },
      required: [],
    },
  },
};

/**
 * 搜索脚本仓库工具
 */
export const searchScriptsTool: Tool = {
  type: 'function',
  function: {
    name: 'search_scripts',
    description: '在 GreasyFork、Userscript.Zone 等仓库中搜索现有的油猴脚本',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: '要搜索的目标网站域名，如 github.com',
        },
        keywords: {
          type: 'string',
          description: '搜索关键词',
        },
      },
      required: ['domain'],
    },
  },
};

/**
 * 生成油猴脚本工具
 */
export const generateScriptTool: Tool = {
  type: 'function',
  function: {
    name: 'generate_script',
    description: '根据需求和分析结果生成油猴脚本',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '脚本名称',
        },
        description: {
          type: 'string',
          description: '脚本描述',
        },
        matchPatterns: {
          type: 'string',
          description: '匹配的 URL 模式，用逗号分隔',
        },
        code: {
          type: 'string',
          description: '脚本的 JavaScript 代码',
        },
      },
      required: ['name', 'description', 'matchPatterns', 'code'],
    },
  },
};

/**
 * 验证脚本语法工具
 */
export const validateScriptTool: Tool = {
  type: 'function',
  function: {
    name: 'validate_script',
    description: '验证生成的脚本语法是否正确',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要验证的 JavaScript 代码',
        },
      },
      required: ['code'],
    },
  },
};

/**
 * 保存记忆工具
 */
export const saveMemoryTool: Tool = {
  type: 'function',
  function: {
    name: 'save_memory',
    description: '保存重要信息到记忆系统，用于后续参考',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '记忆类型',
          enum: ['user_preference', 'website_knowledge', 'script_version'],
        },
        content: {
          type: 'string',
          description: '要保存的内容',
        },
        domain: {
          type: 'string',
          description: '关联的域名（可选）',
        },
      },
      required: ['type', 'content'],
    },
  },
};

/**
 * 搜索记忆工具
 */
export const searchMemoryTool: Tool = {
  type: 'function',
  function: {
    name: 'search_memory',
    description: '搜索记忆系统中的相关信息',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询',
        },
        type: {
          type: 'string',
          description: '记忆类型过滤',
          enum: ['user_preference', 'website_knowledge', 'script_version', 'all'],
        },
        domain: {
          type: 'string',
          description: '域名过滤（可选）',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * 获取所有可用工具
 */
export function getAllTools(): Tool[] {
  return [
    analyzeDomTool,
    searchScriptsTool,
    generateScriptTool,
    validateScriptTool,
    saveMemoryTool,
    searchMemoryTool,
  ];
}

/**
 * 工具名称到工具的映射
 */
export const toolsMap: Record<string, Tool> = {
  analyze_dom: analyzeDomTool,
  search_scripts: searchScriptsTool,
  generate_script: generateScriptTool,
  validate_script: validateScriptTool,
  save_memory: saveMemoryTool,
  search_memory: searchMemoryTool,
};
