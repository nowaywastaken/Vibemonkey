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

// 全局状态
let deepseekClient: DeepSeekClient | null = null;
let mem0Client: Mem0Client | null = null;
let scriptRepository: ScriptRepository | null = null;
let healingSystem: SelfHealingSystem | null = null;
let historyManager: HistoryManager | null = null;
let codeAuditor: CodeAuditor | null = null;
let scriptManager: ScriptManager | null = null;

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
  | GetMatchingScriptsMessage;

export default defineBackground(() => {
  console.log('[VibeMokey] Background service worker started');

  // 初始化客户端
  initializeClients();

  // 消息监听器
  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true; // 表示异步响应
  });
});

/**
 * 初始化各种客户端
 */
async function initializeClients(): Promise<void> {
  try {
    deepseekClient = await createDeepSeekClient();
    mem0Client = await createMem0Client();
    scriptRepository = createScriptRepository();
    healingSystem = createSelfHealingSystem();
    historyManager = createHistoryManager();
    codeAuditor = createCodeAuditor();
    scriptManager = createScriptManager();
    console.log('[VibeMokey] Clients initialized');
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
    const { userRequest, currentUrl, pageInfo } = payload;
    const domain = pageInfo?.domain || new URL(currentUrl).hostname;

    // 1. 搜索现有脚本
    console.log('[VibeMokey] Searching existing scripts for:', domain);
    const existingScripts = await scriptRepository?.searchByDomain(domain);
    
    // 2. 搜索相关记忆
    let memoryContext = '';
    if (mem0Client) {
      const memories = await mem0Client.search(domain, { domain });
      if (memories.length > 0) {
        memoryContext = memories.map(m => `- ${m.content}`).join('\n');
      }
    }

    // 3. 构建 Agent 提示
    const systemPrompt = buildSystemPrompt(existingScripts?.scripts || [], memoryContext);
    const userPrompt = buildUserPrompt(userRequest, currentUrl, pageInfo);

    // 4. 调用 DeepSeek 生成脚本
    const response = await deepseekClient.chatWithThinking([
      { role: 'user', content: systemPrompt + '\n\n' + userPrompt },
    ]);

    const content = response.choices[0]?.message.content || '';
    
    // 5. 解析生成的脚本
    const scriptMatch = content.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
    if (!scriptMatch) {
      return { success: false, error: '未能生成有效脚本' };
    }

    const scriptCode = scriptMatch[1].trim();

    // 6. 生成完整的 Tampermonkey 脚本
    const metadata: ScriptMetadata = {
      name: extractScriptName(content) || `VibeMokey - ${domain}`,
      description: userRequest.slice(0, 100),
      match: [urlToMatchPattern(currentUrl)],
      grant: ['none'],
    };

    const generated = generateFullScript(metadata, scriptCode);

    // 7. 代码审计
    let auditResult: AuditResult | undefined;
    if (codeAuditor) {
      auditResult = codeAuditor.audit(generated.fullScript);
      console.log('[VibeMokey] Audit score:', auditResult.score);
    }

    // 8. 保存到记忆
    if (mem0Client) {
      await mem0Client.add(
        `为 ${domain} 生成了脚本：${metadata.name}。用户需求：${userRequest}`,
        'script_version',
        { domain, scriptName: metadata.name }
      );
    }

    // 9. 保存到历史记录
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

    // 10. 保存到 ScriptManager (激活脚本)
    if (scriptManager) {
      await scriptManager.addScript({
        name: metadata.name,
        description: metadata.description,
        code: generated.fullScript,
        matches: metadata.match,
      });
      console.log('[VibeMokey] Script activated and saved');
    }

    return {
      success: true,
      script: generated.fullScript,
      metadata,
      auditScore: auditResult?.score,
    };
  } catch (error) {
    console.error('[VibeMokey] Generate script error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
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
