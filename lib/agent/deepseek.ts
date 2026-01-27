/**
 * DeepSeek V3.2 API 客户端封装
 * 通过 OpenRouter API 调用 DeepSeek V3.2 模型
 */

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface ToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolProperty;
  properties?: Record<string, ToolProperty>;
  required?: string[];
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolProperty>;
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

export interface ChatStreamEvent {
  id: string;
  choices: {
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }[];
}

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
        'X-Title': 'VibeMonkey',
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
   * 流式聊天请求
   */
  async *chatStream(messages: Message[], tools?: Tool[]): AsyncGenerator<ChatStreamEvent> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
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
        'X-Title': 'VibeMonkey',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.includes('[DONE]')) return;

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              yield data;
            } catch (e) {
              console.warn('Failed to parse SSE message:', line);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
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
      // 这里的实现目前还是非流式的，后续可以升级为流式
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

  /**
   * 执行流式 Agent 循环
   */
  async *runStreamingAgentLoop(
    messages: Message[],
    tools: Tool[],
    executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>,
    maxIterations = 10
  ): AsyncGenerator<{ type: 'token' | 'tool_call' | 'tool_result' | 'error'; content: string }> {
    let currentMessages = [...messages];
    
    for (let i = 0; i < maxIterations; i++) {
      const responseStream = this.chatStream(currentMessages, tools);
      let assistantContent = '';
      let toolCalls: ToolCall[] = [];

      for await (const event of responseStream) {
        const delta = event.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          assistantContent += delta.content;
          yield { type: 'token', content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
               toolCalls.push(tc);
            } else if (toolCalls.length > 0) {
               // Append to last tool call arguments
               const last = toolCalls[toolCalls.length - 1];
               last.function.arguments += tc.function.arguments || '';
            }
          }
        }
      }

      // 添加助手消息到上下文
      currentMessages.push({
        role: 'assistant',
        content: assistantContent,
        // 如果有 tool_calls，通常需要在消息中包含它们，但 OpenRouter/DeepSeek 的格式可能略有不同
        // 这里简化处理，如果最终没有 content 只有 tool_calls，我们也记录下来
      });

      if (toolCalls.length === 0) {
        // 无工具调用，循环结束
        return;
      }

      // 处理所有的工具调用
      for (const toolCall of toolCalls) {
        yield { type: 'tool_call', content: `调用工具: ${toolCall.function.name}` };
        
        let result = '';
        try {
          const args = JSON.parse(toolCall.function.arguments);
          result = await executeToolCall(toolCall.function.name, args);
        } catch (e) {
          result = JSON.stringify({ error: `Tool execution failed: ${e}` });
        }
        
        yield { type: 'tool_result', content: result };
        
        currentMessages.push({
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id,
        });
      }
      
      // 继续下一轮循环，LLM 会基于工具结果继续生成
    }

    yield { type: 'error', content: 'Agent loop exceeded maximum iterations' };
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
