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
 * 获取脚本历史版本工具
 */
export const getScriptHistoryTool: Tool = {
  type: 'function',
  function: {
    name: 'get_script_history',
    description: '获取指定脚本的历史版本代码。可用于对比不同版本的代码或回滚到之前的版本。',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: '脚本 ID',
        },
        version: {
          type: 'number',
          description: '要获取的版本号。如果不指定，返回所有可用版本的摘要。',
        },
      },
      required: ['scriptId'],
    },
  },
};

/**
 * 向用户说话工具
 */
export const speakToUserTool: Tool = {
  type: 'function',
  function: {
    name: 'speak_to_user',
    description: '向用户发送简明扼要的消息（不超过50字）。用于告知用户当前状态、请求确认或解释操作。',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '要对用户说的话，必须简洁（不超过50字）',
        },
        type: {
          type: 'string',
          enum: ['info', 'success', 'warning', 'error', 'question'],
          description: '消息类型：info=信息, success=成功, warning=警告, error=错误, question=询问',
        },
      },
      required: ['message'],
    },
  },
};

/**
 * 编译并验证 TypeScript 代码工具
 */
export const compileAndValidateTool: Tool = {
  type: 'function',
  function: {
    name: 'compile_and_validate',
    description: '使用 Sucrase 将 TypeScript 编译为 JavaScript 并进行基本语法检查。这是交付脚本前的最后一道防线。',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要编译验证的 TypeScript 代码',
        },
      },
      required: ['code'],
    },
  },
};

/**
 * 监控控制台错误工具
 */
export const monitorConsoleErrorsTool: Tool = {
  type: 'function',
  function: {
    name: 'monitor_console_errors',
    description: '捕获页面在脚本运行期间产生的实时错误日志。用于脚本执行失败后的自我诊断。',
    parameters: {
      type: 'object',
      properties: {
        duration_ms: {
          type: 'number',
          description: '监控持续时间（毫秒），默认 5000',
        },
      },
      required: [],
    },
  },
};

/**
 * 获取网络请求日志工具
 */
export const fetchNetworkLogsTool: Tool = {
  type: 'function',
  function: {
    name: 'fetch_network_logs',
    description: '获取特定 XHR/Fetch 请求的响应结构。用于处理动态加载数据或 API 劫持时。',
    parameters: {
      type: 'object',
      properties: {
        url_pattern: {
          type: 'string',
          description: 'URL 模式匹配，如 "*.api.v1" 或 "api/users"',
        },
      },
      required: ['url_pattern'],
    },
  },
};

/**
 * 切换脚本启用状态工具
 */
export const toggleScriptTool: Tool = {
  type: 'function',
  function: {
    name: 'toggle_script',
    description: '启用或禁用指定的脚本。用于帮助用户激活被遗忘的脚本或临时禁用冲突脚本。',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: '脚本 ID',
        },
        enabled: {
          type: 'boolean',
          description: 'true=启用, false=禁用',
        },
      },
      required: ['scriptId', 'enabled'],
    },
  },
};

/**
 * 测试脚本工具 (Shadow Execution)
 */
export const testScriptTool: Tool = {
  type: 'function',
  function: {
    name: 'test_script',
    description: '在沙箱中安全地测试脚本，捕获其副作用并在页面上通过高亮展示（影子执行）。用于验证脚本是否选中了正确的元素。',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要测试的 JavaScript 代码',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 5000',
        },
      },
      required: ['code'],
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
    getScriptHistoryTool,
    speakToUserTool,
    compileAndValidateTool,
    monitorConsoleErrorsTool,
    fetchNetworkLogsTool,
    toggleScriptTool,
    testScriptTool,
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
  get_script_history: getScriptHistoryTool,
  speak_to_user: speakToUserTool,
  compile_and_validate: compileAndValidateTool,
  monitor_console_errors: monitorConsoleErrorsTool,
  fetch_network_logs: fetchNetworkLogsTool,
  toggle_script: toggleScriptTool,
  test_script: testScriptTool,
};

