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
 * 寻找元素工具（DTPP 阶段 2+3）
 */
export const findElementsTool: Tool = {
  type: 'function',
  function: {
    name: 'find_elements',
    description: '根据关键词和权重在页面中寻找最相关的元素。这是 DTPP 策略的核心。',
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词列表',
        },
        weights: {
          type: 'object',
          description: '关键词权重映射，如 {"login": 1.5, "submit": 1.0}',
        },
        topN: {
          type: 'number',
          description: '返回的前 N 个结果，默认 20',
        },
      },
      required: ['keywords'],
    },
  },
};

/**
 * 检查特定元素工具
 */
export const inspectElementTool: Tool = {
  type: 'function',
  function: {
    name: 'inspect_element',
    description: '获取特定元素的详细信息，包括 HTML、计算样式、位置和可见性',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS 选择器',
        },
      },
      required: ['selector'],
    },
  },
};

/**
 * 搜索社区脚本工具
 */
export const searchCommunityScriptsTool: Tool = {
  type: 'function',
  function: {
    name: 'search_community_scripts',
    description: '在 GreasyFork 等社区搜索现有的脚本',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '搜索关键词或域名',
        },
      },
      required: ['keyword'],
    },
  },
};

/**
 * 获取社区脚本详情工具
 */
export const getCommunityScriptDetailTool: Tool = {
  type: 'function',
  function: {
    name: 'get_community_script_detail',
    description: '获取社区脚本的完整代码',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '脚本详情页 URL 或代码 URL',
        },
      },
      required: ['url'],
    },
  },
};

/**
 * 获取脚本列表工具
 */
export const getScriptsTool: Tool = {
  type: 'function',
  function: {
    name: 'get_scripts',
    description: '获取已保存的脚本列表。可以按域名过滤。',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: '按域名过滤（可选）',
        },
      },
      required: [],
    },
  },
};

/**
 * 更新脚本工具
 */
export const updateScriptTool: Tool = {
  type: 'function',
  function: {
    name: 'update_script',
    description: '更新现有脚本的内容或元数据',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: '要更新的脚本 ID',
        },
        updates: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            code: { type: 'string', description: 'TypeScript 源码' },
            enabled: { type: 'boolean' },
            changeNote: { type: 'string', description: '本次修改的说明' },
          },
        },
      },
      required: ['scriptId', 'updates'],
    },
  },
};

/**
 * 删除脚本工具
 */
export const deleteScriptTool: Tool = {
  type: 'function',
  function: {
    name: 'delete_script',
    description: '彻底删除指定的脚本',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: '要删除的脚本 ID',
        },
      },
      required: ['scriptId'],
    },
  },
};

/**
 * 回滚脚本工具
 */
export const rollbackScriptTool: Tool = {
  type: 'function',
  function: {
    name: 'rollback_script',
    description: '将脚本回滚到指定的历史版本',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: '脚本 ID',
        },
        version: {
          type: 'number',
          description: '目标版本号',
        },
      },
      required: ['scriptId', 'version'],
    },
  },
};

/**
 * 请求确认工具
 */
export const requestConfirmationTool: Tool = {
  type: 'function',
  function: {
    name: 'request_confirmation',
    description: '向用户请求确认操作（如：是否要删除脚本？是否要启用某个有风险的脚本？）',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: '要询问用户的问题',
        },
        choices: {
          type: 'array',
          items: { type: 'string' },
          description: '可选的选项，默认为 ["确认", "取消"]',
        },
      },
      required: ['question'],
    },
  },
};

/**
 * 请求输入工具
 */
export const requestInputTool: Tool = {
  type: 'function',
  function: {
    name: 'request_input',
    description: '向用户请求文本输入（如：请输入你想要自动填写的表单内容）',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '提示语',
        },
        placeholder: {
          type: 'string',
          description: '输入框占位符',
        },
      },
      required: ['prompt'],
    },
  },
};

/**
 * 获取当前标签页工具
 */
export const getCurrentTabTool: Tool = {
  type: 'function',
  function: {
    name: 'get_current_tab',
    description: '获取当前活动标签页的 URL、标题和域名',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

/**
 * 获取存储数据工具
 */
export const getStorageTool: Tool = {
  type: 'function',
  function: {
    name: 'get_storage',
    description: '获取扩展存储中的数据',
    parameters: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: '要获取的键名列表',
        },
      },
      required: ['keys'],
    },
  },
};

/**
 * 设置存储数据工具
 */
export const setStorageTool: Tool = {
  type: 'function',
  function: {
    name: 'set_storage',
    description: '将数据保存到扩展存储中',
    parameters: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: '键值对数据',
        },
      },
      required: ['data'],
    },
  },
};

/**
 * 获取脚本演进记忆工具
 */
export const getScriptEvolutionTool: Tool = {
  type: 'function',
  function: {
    name: 'get_script_evolution',
    description: '获取脚本的演进记录，对比不同版本的修改原因和反馈。用于分析“脚本退化”问题。',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: '脚本 ID',
        },
      },
      required: ['scriptId'],
    },
  },
};

/**
 * 检测脚本冲突工具
 */
export const detectConflictsTool: Tool = {
  type: 'function',
  function: {
    name: 'detect_conflicts',
    description: '检测新脚本与现有脚本之间是否存在潜在的选择器或逻辑冲突',
    parameters: {
      type: 'object',
      properties: {
        matchUrls: {
          type: 'array',
          items: { type: 'string' },
          description: '新脚本的匹配 URL 列表',
        },
        code: {
          type: 'string',
          description: '新脚本的代码',
        },
      },
      required: ['matchUrls', 'code'],
    },
  },
};

/**
 * 获取 Token 用量工具
 */
export const getTokenUsageTool: Tool = {
  type: 'function',
  function: {
    name: 'get_token_usage',
    description: '获取当前 AI 模型使用的 Token 数量和剩余额度',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

/**
 * 导入社区脚本工具
 */
export const importCommunityScriptTool: Tool = {
  type: 'function',
  function: {
    name: 'import_community_script',
    description: '导入社区脚本并根据当前页面进行自动适配',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '脚本 URL',
        },
        autoAdapt: {
          type: 'boolean',
          description: '是否自动适配当前页面',
        },
      },
      required: ['url'],
    },
  },
};

/**
 * 更新记忆工具
 */
export const updateMemoryTool: Tool = {
  type: 'function',
  function: {
    name: 'update_memory',
    description: '更新记忆系统中的现有记录',
    parameters: {
      type: 'object',
      properties: {
        memoryId: {
          type: 'string',
          description: '记忆 ID',
        },
        content: {
          type: 'string',
          description: '新内容',
        },
      },
      required: ['memoryId', 'content'],
    },
  },
};

/**
 * 删除记忆工具
 */
export const deleteMemoryTool: Tool = {
  type: 'function',
  function: {
    name: 'delete_memory',
    description: '从记忆系统中删除特定记录',
    parameters: {
      type: 'object',
      properties: {
        memoryId: {
          type: 'string',
          description: '记忆 ID',
        },
      },
      required: ['memoryId'],
    },
  },
};

/**
 * 立即执行脚本工具
 */
export const executeScriptTool: Tool = {
  type: 'function',
  function: {
    name: 'execute_script',
    description: '在当前页面立即执行指定的脚本（无需刷新）',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: '脚本 ID',
        },
      },
      required: ['scriptId'],
    },
  },
};

/**
 * 停止脚本工具
 */
export const stopScriptTool: Tool = {
  type: 'function',
  function: {
    name: 'stop_script',
    description: '停止当前页面正在运行的脚本。注意：某些脚本可能无法完全停止，可能需要刷新页面。',
    parameters: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: '脚本 ID',
        },
      },
      required: ['scriptId'],
    },
  },
};

/**
 * 获取所有可用工具
 */
export function getAllTools(): Tool[] {
  return [
    analyzeDomTool,
    findElementsTool,
    inspectElementTool,
    searchScriptsTool,
    searchCommunityScriptsTool,
    getCommunityScriptDetailTool,
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
    getScriptsTool,
    updateScriptTool,
    deleteScriptTool,
    rollbackScriptTool,
    requestConfirmationTool,
    requestInputTool,
    getCurrentTabTool,
    getStorageTool,
    setStorageTool,
    getScriptEvolutionTool,
    detectConflictsTool,
    getTokenUsageTool,
    // 新增
    importCommunityScriptTool,
    updateMemoryTool,
    deleteMemoryTool,
    executeScriptTool,
    stopScriptTool,
  ];
}

/**
 * 工具名称到工具的映射
 */
export const toolsMap: Record<string, Tool> = {
  analyze_dom: analyzeDomTool,
  find_elements: findElementsTool,
  inspect_element: inspectElementTool,
  search_scripts: searchScriptsTool,
  search_community_scripts: searchCommunityScriptsTool,
  get_community_script_detail: getCommunityScriptDetailTool,
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
  get_scripts: getScriptsTool,
  update_script: updateScriptTool,
  delete_script: deleteScriptTool,
  rollback_script: rollbackScriptTool,
  request_confirmation: requestConfirmationTool,
  request_input: requestInputTool,
  get_current_tab: getCurrentTabTool,
  get_storage: getStorageTool,
  set_storage: setStorageTool,
  get_script_evolution: getScriptEvolutionTool,
  detect_conflicts: detectConflictsTool,
  get_token_usage: getTokenUsageTool,
  // 新增
  import_community_script: importCommunityScriptTool,
  update_memory: updateMemoryTool,
  delete_memory: deleteMemoryTool,
  execute_script: executeScriptTool,
  stop_script: stopScriptTool,
};

