/**
 * DeepSeek V3.2 API 客户端封装
 * 通过 OpenRouter API 调用 DeepSeek V3.2 模型
 */

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatResponse {
  id: string;
  choices: {
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2';

export class DeepSeekClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: DeepSeekConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.model = config.model || DEFAULT_MODEL;
  }

  /**
   * 发送聊天请求
   */
  async chat(messages: Message[], tools?: Tool[]): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'chrome-extension://vibemonkey',
        'X-Title': 'VibeMokey',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * 带思考模式的聊天请求
   * 使用 DeepSeek 的 thinking mode 进行深度推理
   */
  async chatWithThinking(messages: Message[]): Promise<ChatResponse> {
    const systemWithThinking: Message = {
      role: 'system',
      content: `你是一个专业的油猴脚本开发助手。在回答之前，请先在 <thinking> 标签中进行深入思考和规划。
分析用户需求，考虑可能的实现方案，预判潜在问题，然后给出最优解。

注意事项：
1. 生成的脚本必须符合 Tampermonkey 规范
2. 使用稳定的 DOM 选择器
3. 考虑页面动态加载的情况
4. 确保脚本的安全性和性能`,
    };

    return this.chat([systemWithThinking, ...messages]);
  }

  /**
   * 执行 Agent 循环，自动处理工具调用
   */
  async runAgentLoop(
    messages: Message[],
    tools: Tool[],
    executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>,
    maxIterations = 10
  ): Promise<string> {
    let currentMessages = [...messages];
    
    for (let i = 0; i < maxIterations; i++) {
      const response = await this.chat(currentMessages, tools);
      const choice = response.choices[0];
      
      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        // 无工具调用，返回最终响应
        return choice.message.content || '';
      }

      // 添加助手消息
      currentMessages.push({
        role: 'assistant',
        content: choice.message.content || '',
      });

      // 处理工具调用
      for (const toolCall of choice.message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeToolCall(toolCall.function.name, args);
        
        currentMessages.push({
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id,
        });
      }
    }

    throw new Error('Agent loop exceeded maximum iterations');
  }
}

/**
 * 获取存储在扩展中的 API Key
 */
export async function getApiKey(): Promise<string | null> {
  const result = await browser.storage.local.get('openrouter_api_key') as Record<string, string>;
  return result.openrouter_api_key || null;
}

/**
 * 保存 API Key 到扩展存储
 */
export async function saveApiKey(apiKey: string): Promise<void> {
  await browser.storage.local.set({ openrouter_api_key: apiKey });
}

/**
 * 创建 DeepSeek 客户端实例
 */
export async function createDeepSeekClient(): Promise<DeepSeekClient | null> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return null;
  }
  return new DeepSeekClient({ apiKey });
}
