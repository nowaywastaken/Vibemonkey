/**
 * VibeMokey Background Service Worker
 * Agent 核心逻辑：协调 DOM 分析、脚本生成、记忆管理
 */

import { createDeepSeekClient, DeepSeekClient } from '@/lib/agent/deepseek';
import { getAllTools } from '@/lib/agent/tools';
import { createMem0Client, Mem0Client } from '@/lib/memory/mem0-client';
import { createScriptRepository, ScriptRepository } from '@/lib/script/repository';
import { generateFullScript, urlToMatchPattern, ScriptMetadata } from '@/lib/script/generator';
import { createSelfHealingSystem, SelfHealingSystem, RuntimeError } from '@/lib/feedback/self-healing';
import { createHistoryManager, HistoryManager, ScriptHistoryItem, HistoryFilter } from '@/lib/script/history';
import { createCodeAuditor, CodeAuditor, AuditResult, formatAuditResult } from '@/lib/script/auditor';
import { initializeCompiler, compileTypeScript, validateTypeScript, CompileResult } from '@/lib/compiler/typescript-compiler';
import { createScriptManager, ScriptManager } from '@/lib/script/manager';
import { createScriptVersionManager, ScriptVersionManager, extractMainDomain } from '@/lib/script/script-version-manager';
import { createAgentContextBuilder, AgentContextBuilder, AgentContext } from '@/lib/agent/agent-context';
import { startKeepAlive, stopKeepAlive, setupKeepAliveListener, triggerHeartbeat } from '@/lib/keepalive';

// 全局状态
let deepseekClient: DeepSeekClient | null = null;
let mem0Client: Mem0Client | null = null;
let scriptRepository: ScriptRepository | null = null;
let healingSystem: SelfHealingSystem | null = null;
let historyManager: HistoryManager | null = null;
let codeAuditor: CodeAuditor | null = null;
let scriptManager: ScriptManager | null = null;
let scriptVersionManager: ScriptVersionManager | null = null;
let agentContextBuilder: AgentContextBuilder | null = null;

// Agent 状态存储键
const AGENT_STATUS_KEY = 'vibemonkey_agent_status';

type AgentStatus = 'idle' | 'thinking' | 'writing' | 'tool_calling' | 'error';
// 不再使用内存变量，改为从存储中获取
async function getAgentStatusState(): Promise<{ status: AgentStatus; message: string }> {
  try {
    const storage = browser.storage.session || browser.storage.local;
    const result = await storage.get(AGENT_STATUS_KEY);
    const state = result[AGENT_STATUS_KEY] as { status: AgentStatus; message: string } | undefined;
    if (state && typeof state.status === 'string') {
      return state;
    }
  } catch (e) {
    console.error('Failed to get agent status from storage:', e);
  }
  return { status: 'idle', message: '' };
}

// 消息类型定义
interface GenerateScriptMessage {
  type: 'GENERATE_SCRIPT';
  payload: {
    userRequest: string;
    currentUrl: string;
    pageInfo?: {
      title: string;
      domain: string;
      markdown?: string;
    };
  };
}

interface AnalyzeDOMMessage {
  type: 'ANALYZE_DOM';
  payload: {
    tabId: number;
    keywords?: string[];
  };
}

interface ReportErrorMessage {
  type: 'REPORT_ERROR';
  payload: RuntimeError;
}

interface GetStatusMessage {
  type: 'GET_STATUS';
  payload: {
    apiConfigured: boolean;
    mem0Configured: boolean;
  };
}

interface SaveApiKeyMessage {
  type: 'SAVE_API_KEY';
  payload: {
    openrouter?: string;
    mem0?: string;
  };
}

interface GetHistoryMessage {
  type: 'GET_HISTORY';
  payload?: HistoryFilter;
}

interface DeleteHistoryMessage {
  type: 'DELETE_HISTORY';
  payload: { id: string };
}

interface AuditScriptMessage {
  type: 'AUDIT_SCRIPT';
  payload: { code: string };
}

interface CompileTypeScriptMessage {
  type: 'COMPILE_TYPESCRIPT';
  payload: { code: string; minify?: boolean };
}

interface ValidateTypeScriptMessage {
  type: 'VALIDATE_TYPESCRIPT';
  payload: { code: string };
}

interface GetMatchingScriptsMessage {
  type: 'GET_MATCHING_SCRIPTS';
  payload: { url: string };
}

// 新增消息类型
interface GetScriptListMessage {
  type: 'GET_SCRIPT_LIST';
  payload: { url: string };
}

interface ToggleScriptMessage {
  type: 'TOGGLE_SCRIPT';
  payload: { scriptId: string; enabled: boolean };
}

interface GetScriptHistoryMessage {
  type: 'GET_SCRIPT_HISTORY';
  payload: { scriptId: string; version?: number };
}

interface GetAgentStatusMessage {
  type: 'GET_AGENT_STATUS';
}

interface ExecuteSandboxCodeMessage {
  type: 'EXECUTE_SANDBOX_CODE';
  payload: { code: string; context?: any };
}

type ExtensionMessage = 
  | GenerateScriptMessage 
  | AnalyzeDOMMessage 
  | ReportErrorMessage 
  | GetStatusMessage
  | SaveApiKeyMessage
  | GetHistoryMessage
  | DeleteHistoryMessage
  | AuditScriptMessage
  | CompileTypeScriptMessage
  | ValidateTypeScriptMessage
  | GetMatchingScriptsMessage
  | GetScriptListMessage
  | ToggleScriptMessage
  | GetScriptHistoryMessage
  | GetAgentStatusMessage
  | ExecuteSandboxCodeMessage;

export default defineBackground(() => {
  console.log('[VibeMokey] Background service worker started');

  // 初始化客户端
  initializeClients();
  
  // 启动保活
  setupKeepAliveListener();
  startKeepAlive();

  // 消息监听器
  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true; // 表示异步响应
  });

  // 监听长连接
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'vibemonkey-stream') {
      console.log('[VibeMokey] Stream port connected');
      activePorts.add(port);
      
      // 获取并发送当前状态
      getAgentStatusState().then(state => {
        port.postMessage({
          type: 'AGENT_STATUS_UPDATE',
          payload: { status: state.status, message: state.message },
        });
      });

      port.onDisconnect.addListener(() => {
        console.log('[VibeMokey] Stream port disconnected');
        activePorts.delete(port);
      });

      // 处理来自 Popup 的流式生成请求
      port.onMessage.addListener(async (message) => {
        if (message.type === 'GENERATE_SCRIPT_STREAM') {
          await handleGenerateScriptStream(message.payload);
        }
      });
    }
  });
});

/**
 * 初始化 Offscreen 文档
 */
async function setupOffscreenDocument(path: string) {
  try {
    // @ts-ignore - chrome.offscreen might not be in types
    if (await chrome.offscreen.hasDocument()) return;
    
    // @ts-ignore
    await chrome.offscreen.createDocument({
      url: path,
      // @ts-ignore
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run QuickJS sandbox for script analysis',
    });
    console.log('[VibeMokey] Offscreen document created');
  } catch (e) {
    console.error('[VibeMokey] Failed to create offscreen document:', e);
  }
}

/**
 * 初始化各种客户端
 */
// 活跃的连接端口
const activePorts = new Set<any>();



/**
 * 广播消息给所有活跃端口
 */
function broadcastMessage(message: any) {
  // Communication Patch (MV3): Heartbeat Reset
  triggerHeartbeat();
  
  activePorts.forEach(port => {
    try {
      port.postMessage(message);
    } catch (e) {
      activePorts.delete(port);
    }
  });
}

/**
 * 更新 Agent 状态（支持流式广播）
 */
/**
 * 更新 Agent 状态（支持持久化和流式广播）
 */
async function updateAgentStatus(status: AgentStatus, message?: string): Promise<void> {
  const currentState = await getAgentStatusState();
  const nextMessage = message !== undefined ? message : currentState.message;
  
  const payload = { status, message: nextMessage };
  
  // 持久化到存储 (Session 优先)
  const storage = browser.storage.session || browser.storage.local;
  await storage.set({ [AGENT_STATUS_KEY]: payload });
  
  // 广播状态变化给 Popup (Port)
  broadcastMessage({
    type: 'AGENT_STATUS_UPDATE',
    payload,
  });

  // 同时也发送给传统的 onMessage 监听器
  browser.runtime.sendMessage({
    type: 'AGENT_STATUS_UPDATE',
    payload,
  }).catch(() => {});
}

async function initializeClients(): Promise<void> {
  try {
    deepseekClient = await createDeepSeekClient();
    mem0Client = await createMem0Client();
    scriptRepository = createScriptRepository();
    healingSystem = createSelfHealingSystem();
    historyManager = createHistoryManager();
    codeAuditor = createCodeAuditor();
    scriptManager = createScriptManager();
    scriptVersionManager = createScriptVersionManager();
    agentContextBuilder = createAgentContextBuilder(scriptVersionManager);

    // 初始化 Offscreen (使用 chrome.runtime.getURL 获取正确路径)
    // WXT 构建后 entrypoints/offscreen/index.html 通常对应 offscreen.html
    // 但为了保险，我们使用 entrypoints/offscreen/index.html 并依赖 WXT 的处理
    // 或者尝试直接使用 offscreen.html
    await setupOffscreenDocument('entrypoints/offscreen/index.html');

    console.log('[VibeMokey] Clients initialized (including version manager)');
  } catch (error) {
    console.error('[VibeMokey] Failed to initialize clients:', error);
  }
}

/**
 * 处理消息
 */
async function handleMessage(
  message: ExtensionMessage,
  _sender: unknown
): Promise<unknown> {
  switch (message.type) {
    case 'GENERATE_SCRIPT':
      return handleGenerateScript(message.payload);
    
    case 'ANALYZE_DOM':
      return handleAnalyzeDOM(message.payload);
    
    case 'REPORT_ERROR':
      return handleReportError(message.payload);
    
    case 'GET_STATUS':
      return handleGetStatus();
    
    case 'SAVE_API_KEY':
      return handleSaveApiKey(message.payload);
    
    case 'GET_HISTORY':
      return handleGetHistory(message.payload);
    
    case 'DELETE_HISTORY':
      return handleDeleteHistory(message.payload.id);
    
    case 'AUDIT_SCRIPT':
      return handleAuditScript(message.payload.code);
    
    case 'COMPILE_TYPESCRIPT':
      return handleCompileTypeScript(message.payload);
    
    case 'VALIDATE_TYPESCRIPT':
      return handleValidateTypeScript(message.payload.code);

    case 'GET_MATCHING_SCRIPTS':
      return handleGetMatchingScripts(message.payload.url);
    
    case 'GET_SCRIPT_LIST':
      return handleGetScriptList(message.payload.url);
    
    case 'TOGGLE_SCRIPT':
      return handleToggleScript(message.payload);
    
    case 'GET_SCRIPT_HISTORY':
      return handleGetScriptHistory(message.payload);
    
    case 'GET_AGENT_STATUS':
      return getAgentStatusState();

    case 'EXECUTE_SANDBOX_CODE':
      return handleSandboxExecute(message.payload);
    
    default:
      return { error: 'Unknown message type' };
  }
}

/**
 * 处理脚本生成请求
 */
async function handleGenerateScript(payload: GenerateScriptMessage['payload']): Promise<{
  success: boolean;
  script?: string;
  metadata?: ScriptMetadata;
  auditScore?: number;
  error?: string;
}> {
  if (!deepseekClient) {
    return { success: false, error: '请先配置 OpenRouter API Key' };
  }

  try {
    updateAgentStatus('thinking', '正在分析需求...');
    
    const { userRequest, currentUrl, pageInfo } = payload;
    const domain = pageInfo?.domain || new URL(currentUrl).hostname;

    // 1. 构建完整的 Agent 上下文
    let agentContext: AgentContext | null = null;
    if (agentContextBuilder) {
      // 获取记忆上下文
      let memoryContext = '';
      if (mem0Client) {
        const memories = await mem0Client.search(domain, { domain });
        if (memories.length > 0) {
          memoryContext = memories.map(m => `- ${m.content}`).join('\n');
        }
      }

      agentContext = await agentContextBuilder.buildContext(
        currentUrl,
        pageInfo ? { title: pageInfo.title, markdown: pageInfo.markdown || '' } : undefined,
        memoryContext
      );
      console.log('[VibeMokey] Agent context built:', {
        domain: agentContext.currentDomain,
        activeScripts: agentContext.activeScripts.length,
        inactiveScripts: agentContext.inactiveScripts.length,
      });
    }

    // 2. 构建增强的系统提示（包含完整上下文）
    const systemPrompt = buildEnhancedSystemPrompt(agentContext);
    const userPrompt = buildUserPrompt(userRequest, currentUrl, pageInfo);

    updateAgentStatus('writing', '正在生成脚本...');

    // 3. 调用 DeepSeek 生成脚本
    const response = await deepseekClient.chatWithThinking([
      { role: 'user', content: systemPrompt + '\n\n' + userPrompt },
    ]);

    const content = response.choices[0]?.message.content || '';
    
    // 4. 解析生成的脚本（支持 TypeScript 和 JavaScript）
    const scriptMatch = content.match(/```(?:typescript|javascript|ts|js)?\n([\s\S]*?)```/);
    if (!scriptMatch) {
      updateAgentStatus('error', '未能生成有效脚本');
      return { success: false, error: '未能生成有效脚本' };
    }

    const scriptCode = scriptMatch[1].trim();

    // 5. 生成完整的 Tampermonkey 脚本
    const metadata: ScriptMetadata = {
      name: extractScriptName(content) || `VibeMokey - ${domain}`,
      description: userRequest.slice(0, 100),
      match: [urlToMatchPattern(currentUrl)],
      grant: ['none'],
    };

    const generated = generateFullScript(metadata, scriptCode);

    // 6. 代码审计
    let auditResult: AuditResult | undefined;
    if (codeAuditor) {
      auditResult = codeAuditor.audit(generated.fullScript);
      console.log('[VibeMokey] Audit score:', auditResult.score);
    }

    // 7. 保存到记忆
    if (mem0Client) {
      await mem0Client.add(
        `为 ${domain} 生成了脚本：${metadata.name}。用户需求：${userRequest}`,
        'script_version',
        { domain, scriptName: metadata.name }
      );
    }

    // 8. 保存到历史记录
    if (historyManager) {
      await historyManager.add({
        name: metadata.name,
        description: userRequest,
        url: currentUrl,
        domain,
        script: generated.fullScript,
        userRequest,
      });
    }

    // 9. 保存到版本化脚本管理器（优先使用新的版本管理器）
    if (scriptVersionManager) {
      await scriptVersionManager.addScript({
        name: metadata.name,
        description: metadata.description,
        matchPattern: urlToMatchPattern(currentUrl),
        domain,
        code: scriptCode,  // 保存原始 TypeScript
        compiledCode: generated.fullScript,  // 保存编译后的完整脚本
        userRequest,
      });
      console.log('[VibeMokey] Script saved to version manager');
    } else if (scriptManager) {
      // 回退到旧的脚本管理器
      await scriptManager.addScript({
        name: metadata.name,
        description: metadata.description,
        code: generated.fullScript,
        matches: metadata.match,
      });
      console.log('[VibeMokey] Script activated and saved (legacy)');
    }

    updateAgentStatus('idle', `已成功生成脚本：${metadata.name}`);

    return {
      success: true,
      script: generated.fullScript,
      metadata,
      auditScore: auditResult?.score,
    };
  } catch (error) {
    console.error('[VibeMokey] Generate script error:', error);
    updateAgentStatus('error', error instanceof Error ? error.message : '生成失败');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 构建增强的系统提示（包含完整 Agent 上下文）
 */
function buildEnhancedSystemPrompt(context: AgentContext | null): string {
  let prompt = `你是 VibeMokey，一个专业的油猴脚本生成助手。你的任务是根据用户需求生成高质量的 TypeScript 脚本。

生成规则：
1. 使用稳定的 CSS 选择器（优先使用 ID、data-* 属性）
2. 使用 MutationObserver 处理动态加载的内容
3. 添加必要的错误处理
4. 代码简洁高效，添加适当注释
5. 不要使用 eval() 或其他不安全的函数

重要提示：
- 如果用户说"这里没效果"或"旧脚本效果不佳"，请参考下方的现有脚本和历史版本
- 如果发现未激活的脚本可以满足需求，建议用户激活该脚本
- 注意避免与现有脚本的功能冲突`;

  if (context) {
    prompt += '\n\n' + agentContextBuilder?.formatContextForPrompt(context);
  }

  return prompt;
}

/**
 * 处理流式脚本生成请求
 */
async function handleGenerateScriptStream(payload: GenerateScriptMessage['payload']): Promise<void> {
  if (!deepseekClient) {
    updateAgentStatus('error', '请先配置 OpenRouter API Key');
    return;
  }

  try {
    updateAgentStatus('thinking', '正在初始化 Agent...');
    
    const { userRequest, currentUrl, pageInfo } = payload;
    const domain = pageInfo?.domain || new URL(currentUrl).hostname;

    // 1. 构建初始上下文
    let agentContext: AgentContext | null = null;
    if (agentContextBuilder) {
      let memoryContext = '';
      if (mem0Client) {
        const memories = await mem0Client.search(domain, { domain });
        if (memories.length > 0) {
          memoryContext = memories.map(m => `- ${m.content}`).join('\n');
        }
      }

      agentContext = await agentContextBuilder.buildContext(
        currentUrl,
        pageInfo ? { title: pageInfo.title, markdown: pageInfo.markdown || '' } : undefined,
        memoryContext
      );
    }

    // 2. 构建系统和用户提示
    const systemPrompt = buildEnhancedSystemPrompt(agentContext);
    const userPrompt = buildUserPrompt(userRequest, currentUrl, pageInfo);

    startKeepAlive();
    broadcastMessage({ type: 'SCRIPT_GENERATION_START' });

    let fullAssistantContent = '';
    
    // 3. 运行 Agent 循环
    const agentLoop = deepseekClient.runStreamingAgentLoop(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      getAllTools(),
      executeTool
    );

    for await (const event of agentLoop) {
      switch (event.type) {
        case 'token':
          fullAssistantContent += event.content;
          broadcastMessage({
            type: 'SCRIPT_GENERATION_CHUNK',
            payload: event.content
          });
          break;
        
        case 'tool_call':
          updateAgentStatus('tool_calling', event.content);
          break;
        
        case 'tool_result':
          // 可以在这里把工具结果也发给 UI，但通常保持 UI 简洁
          console.log('[Agent Tool Result]', event.content);
          updateAgentStatus('thinking', '正在处理工具返回结果...');
          break;
        
        case 'error':
          updateAgentStatus('error', event.content);
          break;
      }
    }
    
    stopKeepAlive();
    
    // 4. 解析生成的脚本
    const scriptMatch = fullAssistantContent.match(/```(?:typescript|javascript|ts|js)?\n([\s\S]*?)```/);
    if (!scriptMatch) {
      updateAgentStatus('error', '未能生成有效脚本');
      return;
    }

    const scriptCode = scriptMatch[1].trim();

    // 5. 生成、审计并保存 (保持原有逻辑)
    const metadata: ScriptMetadata = {
      name: extractScriptName(fullAssistantContent) || `VibeMokey - ${domain}`,
      description: userRequest.slice(0, 100),
      match: [urlToMatchPattern(currentUrl)],
      grant: ['none'],
    };

    const generated = generateFullScript(metadata, scriptCode);
    
    if (mem0Client) {
      await mem0Client.add(
        `为 ${domain} 生成了脚本：${metadata.name}。用户需求：${userRequest}`,
        'script_version',
        { domain, scriptName: metadata.name }
      );
    }

    if (scriptVersionManager) {
      await scriptVersionManager.addScript({
        name: metadata.name,
        description: metadata.description,
        matchPattern: urlToMatchPattern(currentUrl),
        domain,
        code: scriptCode,
        compiledCode: generated.fullScript,
        userRequest,
      });
    }

    updateAgentStatus('idle', `已成功生成脚本：${metadata.name}`);

    broadcastMessage({
      type: 'SCRIPT_GENERATION_COMPLETE',
      payload: {
        success: true,
        script: generated.fullScript,
        metadata
      }
    });

  } catch (error) {
    stopKeepAlive();
    console.error('[VibeMokey] Agent loop error:', error);
    updateAgentStatus('error', error instanceof Error ? error.message : '生成失败');
    broadcastMessage({
      type: 'SCRIPT_GENERATION_ERROR',
      payload: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * 构建系统提示
 */
function buildSystemPrompt(existingScripts: { name: string; description: string }[], memoryContext: string): string {
  let prompt = `你是 VibeMokey，一个专业的油猴脚本生成助手。你的任务是根据用户需求生成高质量的 Tampermonkey 兼容脚本。

生成规则：
1. 使用稳定的 CSS 选择器（优先使用 ID、data-* 属性）
2. 使用 MutationObserver 处理动态加载的内容
3. 添加必要的错误处理
4. 代码简洁高效，添加适当注释
5. 不要使用 eval() 或其他不安全的函数`;

  if (existingScripts.length > 0) {
    prompt += `\n\n现有相关脚本参考：\n`;
    existingScripts.slice(0, 3).forEach(s => {
      prompt += `- ${s.name}: ${s.description}\n`;
    });
  }

  if (memoryContext) {
    prompt += `\n\n相关记忆：\n${memoryContext}`;
  }

  return prompt;
}

/**
 * 构建用户提示
 */
function buildUserPrompt(
  userRequest: string,
  currentUrl: string,
  pageInfo?: { title: string; markdown?: string }
): string {
  let prompt = `用户需求：${userRequest}\n\n当前页面：${currentUrl}`;
  
  if (pageInfo?.title) {
    prompt += `\n页面标题：${pageInfo.title}`;
  }

  if (pageInfo?.markdown) {
    prompt += `\n\n页面结构：\n${pageInfo.markdown.slice(0, 5000)}`;
  }

  prompt += `\n\n请生成一个完整的脚本来满足上述需求。只输出 JavaScript 代码，用 \`\`\`javascript 包裹。`;

  return prompt;
}

/**
 * 从响应中提取脚本名称
 */
function extractScriptName(content: string): string | null {
  const nameMatch = content.match(/脚本名称[：:]?\s*(.+)/);
  if (nameMatch) return nameMatch[1].trim();
  
  const headerMatch = content.match(/#{1,3}\s*(.+)/);
  if (headerMatch) return headerMatch[1].trim();
  
  return null;
}

/**
 * 处理 DOM 分析请求
 */
async function handleAnalyzeDOM(payload: AnalyzeDOMMessage['payload']): Promise<unknown> {
  try {
    // 向 Content Script 发送分析请求
    const result = await browser.tabs.sendMessage(payload.tabId, {
      type: 'ANALYZE_DOM_REQUEST',
      payload: { keywords: payload.keywords || [] },
    });
    return result;
  } catch (error) {
    console.error('[VibeMokey] Analyze DOM error:', error);
    return { error: 'DOM 分析失败' };
  }
}

/**
 * 处理错误报告
 */
function handleReportError(error: RuntimeError): { success: boolean } {
  if (healingSystem) {
    healingSystem.recordError(error);
    const actions = healingSystem.analyzeError(error);
    console.log('[VibeMokey] Healing actions:', actions);
  }
  return { success: true };
}

/**
 * 获取状态
 */
function handleGetStatus(): {
  apiConfigured: boolean;
  mem0Configured: boolean;
} {
  return {
    apiConfigured: deepseekClient !== null,
    mem0Configured: mem0Client !== null && !!mem0Client,
  };
}

/**
 * 保存 API Key
 */
async function handleSaveApiKey(payload: SaveApiKeyMessage['payload']): Promise<{ success: boolean }> {
  try {
    if (payload.openrouter) {
      await browser.storage.local.set({ openrouter_api_key: payload.openrouter });
      deepseekClient = await createDeepSeekClient();
    }
    if (payload.mem0) {
      await browser.storage.local.set({ mem0_api_key: payload.mem0 });
      mem0Client = await createMem0Client();
    }
    return { success: true };
  } catch (error) {
    console.error('[VibeMokey] Save API key error:', error);
    return { success: false };
  }
}

/**
 * 获取历史记录
 */
async function handleGetHistory(filter?: HistoryFilter): Promise<{
  success: boolean;
  history: ScriptHistoryItem[];
}> {
  if (!historyManager) {
    return { success: false, history: [] };
  }

  try {
    const history = await historyManager.search(filter || {});
    return { success: true, history };
  } catch (error) {
    console.error('[VibeMokey] Get history error:', error);
    return { success: false, history: [] };
  }
}

/**
 * 删除历史记录
 */
async function handleDeleteHistory(id: string): Promise<{ success: boolean }> {
  if (!historyManager) {
    return { success: false };
  }

  try {
    await historyManager.delete(id);
    return { success: true };
  } catch (error) {
    console.error('[VibeMokey] Delete history error:', error);
    return { success: false };
  }
}

/**
 * 审计脚本代码
 */
function handleAuditScript(code: string): {
  success: boolean;
  result?: AuditResult;
  formatted?: string;
} {
  if (!codeAuditor) {
    return { success: false };
  }

  try {
    const result = codeAuditor.audit(code);
    const formatted = formatAuditResult(result);
    return { success: true, result, formatted };
  } catch (error) {
    console.error('[VibeMokey] Audit script error:', error);
    return { success: false };
  }
}

/**
 * 编译 TypeScript 代码
 */
async function handleCompileTypeScript(payload: {
  code: string;
  minify?: boolean;
}): Promise<CompileResult & { success: boolean }> {
  try {
    const result = await compileTypeScript(payload.code, {
      minify: payload.minify,
      target: 'es2020',
      module: 'es6',
    });
    
    return {
      success: result.success,
      code: result.code,
      error: result.error,
    };
  } catch (error) {
    console.error('[VibeMokey] Compile TypeScript error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 验证 TypeScript 语法
 */
async function handleValidateTypeScript(code: string): Promise<{
  success: boolean;
  valid: boolean;
  errors: string[];
}> {
  try {
    const result = await validateTypeScript(code);
    return {
      success: true,
      valid: result.valid,
      errors: result.errors,
    };
  } catch (error) {
    console.error('[VibeMokey] Validate TypeScript error:', error);
    return {
      success: false,
      valid: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/**
 * 获取即匹配的脚本
 */
async function handleGetMatchingScripts(url: string): Promise<{ success: boolean; scripts: any[] }> {
  if (!scriptManager) {
    return { success: false, scripts: [] };
  }
  
  try {
    const scripts = await scriptManager.getScriptsForUrl(url);
    return { success: true, scripts };
  } catch (error) {
    console.error('[VibeMokey] Get matching scripts error:', error);
    return { success: false, scripts: [] };
  }
}

/**
 * 获取脚本列表（按当前域名分组，供 Popup 使用）
 */
async function handleGetScriptList(url: string): Promise<{
  success: boolean;
  domain: string;
  activeScripts: { id: string; name: string; matchPattern: string; description: string }[];
  inactiveScripts: { id: string; name: string; matchPattern: string; description: string }[];
  otherDomainScripts: { id: string; name: string; domain: string; matchPattern: string }[];
}> {
  if (!agentContextBuilder) {
    return {
      success: false,
      domain: '',
      activeScripts: [],
      inactiveScripts: [],
      otherDomainScripts: [],
    };
  }

  try {
    const result = await agentContextBuilder.getScriptListForPopup(url);
    return {
      success: true,
      ...result,
    };
  } catch (error) {
    console.error('[VibeMokey] Get script list error:', error);
    return {
      success: false,
      domain: '',
      activeScripts: [],
      inactiveScripts: [],
      otherDomainScripts: [],
    };
  }
}

/**
 * 切换脚本启用状态
 */
async function handleToggleScript(payload: { scriptId: string; enabled: boolean }): Promise<{
  success: boolean;
  script?: any;
}> {
  if (!scriptVersionManager) {
    return { success: false };
  }

  try {
    const script = await scriptVersionManager.toggleScript(payload.scriptId, payload.enabled);
    if (script) {
      await updateAgentStatus('idle', `已${payload.enabled ? '启用' : '禁用'}脚本：${script.name}`);
    }
    return { success: !!script, script };
  } catch (error) {
    console.error('[VibeMokey] Toggle script error:', error);
    return { success: false };
  }
}

/**
 * 获取脚本历史版本
 */
async function handleGetScriptHistory(payload: { scriptId: string; version?: number }): Promise<{
  success: boolean;
  versions?: { version: number; createdAt: number; changeNote?: string; code?: string }[];
  specificVersion?: { version: number; code: string; createdAt: number; userRequest?: string };
}> {
  if (!scriptVersionManager) {
    return { success: false };
  }

  try {
    const script = await scriptVersionManager.getScript(payload.scriptId);
    if (!script) {
      return { success: false };
    }

    if (payload.version !== undefined) {
      // 获取特定版本的完整代码
      const versionData = await scriptVersionManager.getScriptVersion(payload.scriptId, payload.version);
      if (versionData) {
        return {
          success: true,
          specificVersion: {
            version: versionData.version,
            code: versionData.code,
            createdAt: versionData.createdAt,
            userRequest: versionData.userRequest,
          },
        };
      }
      return { success: false };
    }

    // 返回所有版本的摘要
    return {
      success: true,
      versions: script.versions.map(v => ({
        version: v.version,
        createdAt: v.createdAt,
        changeNote: v.changeNote,
      })),
    };
  } catch (error) {
    return { success: false };
  }
}

/**
 * 处理沙箱执行请求
 */
async function handleSandboxExecute(payload: { code: string; context?: any }): Promise<any> {
  // 确保 Offscreen 文档存在
  await setupOffscreenDocument('entrypoints/offscreen/index.html');
  
  // 通过 runtime.sendMessage 发送给 Offscreen
  return new Promise((resolve) => {
    browser.runtime.sendMessage({
      type: 'EXECUTE_IN_SANDBOX',
      payload
    }).then(resolve).catch((e) => {
      console.error('Sandbox execution failed:', e);
      resolve({ success: false, error: e.message });
    });
  });
}

/**
 * 执行工具调用 (Agent Dispatcher)
 */
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    await updateAgentStatus('tool_calling', `正在调用工具: ${name}`);
    
    switch (name) {
      case 'analyze_dom': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'No active tab' });
        
        const domResult = await handleAnalyzeDOM({ 
          tabId: tab.id, 
          keywords: (args.keywords as string[]) || (args.selectors as string)?.split(',') || [] 
        });
        return JSON.stringify(domResult);
      }

      case 'find_elements': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'No active tab' });
        
        const result = await browser.tabs.sendMessage(tab.id, {
          type: 'FIND_ELEMENTS',
          payload: {
            keywords: args.keywords as string[],
            weights: args.weights as Record<string, number>,
            topN: args.topN as number
          }
        });
        return JSON.stringify(result);
      }

      case 'inspect_element': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'No active tab' });
        
        const result = await browser.tabs.sendMessage(tab.id, {
          type: 'INSPECT_ELEMENT',
          payload: { selector: args.selector as string }
        });
        return JSON.stringify(result);
      }

      case 'test_script': {
        if (typeof args.code !== 'string') return JSON.stringify({ error: 'Invalid arguments: code required' });
        
        const sandboxRes = await handleSandboxExecute({ code: args.code });
        
        if (sandboxRes.sideEffects?.length > 0) {
           const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
           if (activeTab?.id) {
             browser.tabs.sendMessage(activeTab.id, { 
               type: 'HIGHLIGHT_ELEMENTS', 
               payload: sandboxRes.sideEffects 
             });
           }
        }
        return JSON.stringify(sandboxRes);
      }

      case 'search_scripts':
      case 'search_community_scripts': {
         if (scriptRepository) {
           const query = (args.keyword || args.domain) as string;
           const results = await scriptRepository.searchAll(query);
           return JSON.stringify(results);
         }
         return JSON.stringify({ error: 'Repository not initialized' });
      }

      case 'get_community_script_detail': {
        if (scriptRepository) {
          const code = await scriptRepository.fetchScriptCode(args.url as string);
          return JSON.stringify({ code });
        }
        return JSON.stringify({ error: 'Repository not initialized' });
      }

      case 'save_memory':
      case 'add_memory': {
         if (mem0Client) {
            const res = await mem0Client.add(
              args.content as string, 
              args.type as any, 
              { 
                domain: args.domain as string,
                scriptId: args.scriptId as string,
                ...(args.metadata as object || {})
              }
            );
            return JSON.stringify({ success: true, memoryId: res.id });
         }
         return JSON.stringify({ error: 'Mem0 not initialized' });
      }

      case 'search_memory': {
        if (mem0Client && typeof args.query === 'string') {
          const results = await mem0Client.search(args.query, {
            type: args.type as any,
            domain: args.domain as string
          });
          return JSON.stringify(results);
        }
        return JSON.stringify({ error: 'Mem0 not initialized or missing query' });
      }

      case 'get_script_history': {
        if (scriptVersionManager && typeof args.scriptId === 'string') {
          const script = await scriptVersionManager.getScript(args.scriptId);
          if (!script) return JSON.stringify({ error: 'Script not found' });
          
          if (typeof args.version === 'number') {
            const versionData = await scriptVersionManager.getScriptVersion(args.scriptId, args.version);
            return JSON.stringify(versionData);
          }
          
          return JSON.stringify(script.versions.map(v => ({
            version: v.version,
            createdAt: v.createdAt,
            changeNote: v.changeNote
          })));
        }
        return JSON.stringify({ error: 'Version manager not initialized' });
      }

      case 'speak_to_user': {
        const message = args.message as string;
        const type = (args.type as string) || 'info';
        await updateAgentStatus('idle', message);
        broadcastMessage({
          type: 'AGENT_STATUS_UPDATE',
          payload: { status: 'idle', message: `Agent: ${message}` }
        });
        return JSON.stringify({ success: true });
      }

      case 'compile_and_validate': {
        if (typeof args.code === 'string') {
          const result = await handleCompileTypeScript({ code: args.code });
          const validateRes = await handleValidateTypeScript(args.code);
          return JSON.stringify({
            compile: result,
            validate: validateRes
          });
        }
        return JSON.stringify({ error: 'Missing code' });
      }

      case 'monitor_console_errors': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'No active tab' });
        const errors = await browser.tabs.sendMessage(tab.id, { type: 'GET_RECENT_ERRORS' });
        return JSON.stringify(errors);
      }

      case 'fetch_network_logs': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'No active tab' });
        
        const logs = await browser.tabs.sendMessage(tab.id, { 
          type: 'GET_NETWORK_STATS',
          payload: { urlPattern: args.url_pattern }
        });
        return JSON.stringify(logs);
      }

      case 'get_scripts': {
        if (!scriptVersionManager) return JSON.stringify({ error: 'Not initialized' });
        const scripts = args.domain 
          ? await scriptVersionManager.getScriptsByDomain(args.domain as string)
          : await scriptVersionManager.getAllScripts();
        return JSON.stringify(scripts);
      }

      case 'update_script': {
        if (!scriptVersionManager) return JSON.stringify({ error: 'Not initialized' });
        const res = await scriptVersionManager.updateScript(args.scriptId as string, args.updates as any);
        return JSON.stringify({ success: !!res, script: res });
      }

      case 'delete_script': {
        if (!scriptVersionManager) return JSON.stringify({ error: 'Not initialized' });
        const res = await scriptVersionManager.deleteScript(args.scriptId as string);
        return JSON.stringify({ success: res });
      }

      case 'rollback_script': {
        if (!scriptVersionManager) return JSON.stringify({ error: 'Not initialized' });
        const res = await scriptVersionManager.rollbackToVersion(args.scriptId as string, args.version as number);
        return JSON.stringify({ success: !!res, script: res });
      }

      case 'toggle_script': {
        if (scriptVersionManager && typeof args.scriptId === 'string') {
          const res = await scriptVersionManager.toggleScript(args.scriptId, !!args.enabled);
          return JSON.stringify({ success: !!res });
        }
        return JSON.stringify({ error: 'Version manager not initialized' });
      }

      case 'request_confirmation': {
        const result = await requestUserInteraction('CONFIRMATION', args);
        return JSON.stringify({ result });
      }

      case 'request_input': {
        const result = await requestUserInteraction('INPUT', args);
        return JSON.stringify({ result });
      }

      case 'get_current_tab': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab) return JSON.stringify({ error: 'No active tab' });
        return JSON.stringify({
          url: tab.url,
          title: tab.title,
          domain: tab.url ? new URL(tab.url).hostname : ''
        });
      }

      case 'get_storage': {
        const keys = args.keys as string[];
        const res = await browser.storage.local.get(keys);
        return JSON.stringify(res);
      }

      case 'set_storage': {
        const data = args.data as Record<string, any>;
        await browser.storage.local.set(data);
        return JSON.stringify({ success: true });
      }

      case 'get_script_evolution': {
        if (!mem0Client || !args.scriptId) return JSON.stringify({ error: 'Missing client or id' });
        const memories = await mem0Client.search(args.scriptId as string, { type: 'script_version' });
        return JSON.stringify(memories);
      }

      case 'detect_conflicts': {
        if (!scriptVersionManager) return JSON.stringify({ error: 'Not initialized' });
        const allScripts = await scriptVersionManager.getAllScripts();
        const conflicts = [];
        const newUrls = args.matchUrls as string[];
        
        for (const script of allScripts) {
          if (!script.enabled) continue;
          // 简单检查：如果有重叠的 URL 模式，可能存在冲突
          if (newUrls.some(u => script.matchPattern === u || script.matchPattern === '<all_urls>' || u === '<all_urls>')) {
            conflicts.push({
              scriptId: script.id,
              name: script.name,
              reason: '匹配 URL 模式重叠'
            });
          }
        }
        return JSON.stringify({ hasConflict: conflicts.length > 0, conflicts });
      }

      case 'get_token_usage': {
        // 模拟实现
        const usage = await browser.storage.local.get('token_usage');
        return JSON.stringify(usage.token_usage || { used: 0, limit: 10000000 });
      }

      case 'generate_script': {
        if (typeof args.code === 'string' && typeof args.name === 'string') {
          const domain = extractMainDomain(args.matchPatterns as string || '');
          if (scriptVersionManager) {
            await scriptVersionManager.addScript({
              name: args.name as string,
              description: args.description as string || '',
              matchPattern: (args.matchPatterns as string)?.split(',')[0] || (args.matchPatterns as string) || '<all_urls>',
              domain: domain || 'unknown',
              code: args.code as string,
              changeNote: 'AI 生成'
            });
          }
          return JSON.stringify({ success: true, message: 'Script saved successfully' });
        }
        return JSON.stringify({ error: 'Missing code or name' });
      }

      case 'import_community_script': {
        if (scriptRepository && typeof args.url === 'string') {
          const code = await scriptRepository.fetchScriptCode(args.url as string);
          if (!code) return JSON.stringify({ error: 'Failed to fetch script code' });
          
          const domain = extractMainDomain(await browser.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs[0]?.url || ''));
          
          if (scriptVersionManager) {
            await scriptVersionManager.addScript({
              name: `Imported - ${args.url.split('/').pop()}`,
              description: `从 ${args.url} 导入的社区脚本`,
              matchPattern: '<all_urls>',
              domain: domain || 'unknown',
              code: code,
              changeNote: '从社区导入'
            });
          }
          return JSON.stringify({ success: true });
        }
        return JSON.stringify({ error: 'Repository not initialized or missing url' });
      }

      case 'update_memory': {
        if (mem0Client && args.memoryId && args.content) {
          await mem0Client.update(args.memoryId as string, args.content as string);
          return JSON.stringify({ success: true });
        }
        return JSON.stringify({ error: 'Mem0 not initialized or missing arguments' });
      }

      case 'delete_memory': {
        if (mem0Client && args.memoryId) {
          await mem0Client.delete(args.memoryId as string);
          return JSON.stringify({ success: true });
        }
        return JSON.stringify({ error: 'Mem0 not initialized or missing memoryId' });
      }

      case 'execute_script': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !args.scriptId) return JSON.stringify({ error: 'Missing tab or scriptId' });
        
        const script = await scriptVersionManager?.getScript(args.scriptId as string);
        if (!script) return JSON.stringify({ error: 'Script not found' });
        
        const code = script.versions[0]?.compiledCode || script.versions[0]?.code;
        await browser.tabs.sendMessage(tab.id, {
          type: 'EXECUTE_IMMEDIATELY',
          payload: { code }
        });
        return JSON.stringify({ success: true });
      }

      case 'stop_script': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return JSON.stringify({ error: 'No active tab' });
        // 目前简单的停止就是通过重新加载页面或者发送一个停止信号（如果脚本支持）
        await browser.tabs.sendMessage(tab.id, {
          type: 'STOP_SCRIPT_REQUEST',
          payload: { scriptId: args.scriptId }
        });
        return JSON.stringify({ success: true, message: 'Stop signal sent' });
      }

      default:
        return JSON.stringify({ error: `Tool ${name} not implemented` });
    }
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 请求用户交互（通过 Port）
 */
async function requestUserInteraction(type: 'CONFIRMATION' | 'INPUT', payload: any): Promise<any> {
  if (activePorts.size === 0) {
    throw new Error('Popup is not open to handle interaction');
  }

  return new Promise((resolve, reject) => {
    const interactionId = `int_${Date.now()}`;
    
    const responseHandler = (message: any) => {
      if (message.type === 'USER_INTERACTION_RESPONSE' && message.payload.interactionId === interactionId) {
        broadcastMessage({ type: 'INTERACTION_RESOLVED', payload: { interactionId } }); // 清理 UI
        resolve(message.payload.result);
      }
    };

    // 这里需要一个更复杂的机制来在多个端口中选择并监听响应
    // 简化处理：假设第一个端口是活跃的
    const port = Array.from(activePorts)[0];
    port.onMessage.addListener(responseHandler);

    broadcastMessage({
      type: 'REQUEST_USER_INTERACTION',
      payload: {
        interactionId,
        type,
        ...payload
      }
    });

    // 1 分钟超时
    setTimeout(() => {
      port.onMessage.removeListener(responseHandler);
      reject(new Error('User interaction timeout'));
    }, 60000);
  });
}




