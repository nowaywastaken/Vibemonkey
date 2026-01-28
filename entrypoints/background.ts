/**
 * VibeMonkey Background Service Worker
 * Agent 核心逻辑：协调 DOM 分析、脚本生成、记忆管理
 */

import { createDeepSeekClient, DeepSeekClient } from '@/lib/agent/deepseek';
import { getAllTools } from '@/lib/agent/tools';
import { createMem0Client, Mem0Client } from '@/lib/memory/mem0-client';
import { createScriptRepository, ScriptRepository } from '@/lib/script/repository';
import { generateFullScript, generateMetadataBlock, urlToMatchPattern, ScriptMetadata } from '@/lib/script/generator';
import { createSelfHealingSystem, SelfHealingSystem, RuntimeError } from '@/lib/feedback/self-healing';
import { createHistoryManager, HistoryManager, ScriptHistoryItem, HistoryFilter } from '@/lib/script/history';
import { createCodeAuditor, CodeAuditor, AuditResult, formatAuditResult } from '@/lib/script/auditor';
import { initializeCompiler, compileTypeScript, compileUserScript, validateTypeScript, CompileResult } from '@/lib/compiler/typescript-compiler';
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
let scriptVersionManager: ScriptVersionManager | null = null;
let agentContextBuilder: AgentContextBuilder | null = null;

// Agent 状态存储键
const AGENT_STATUS_KEY = 'vibemonkey_agent_status';

type AgentStatus = 'idle' | 'thinking' | 'writing' | 'tool_calling' | 'retrying' | 'error';

// 生成中断标志
let generationAborted = false;
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
  console.log('[VibeMonkey] Background service worker started');

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
      console.log('[VibeMonkey] Stream port connected');
      activePorts.add(port);
      
      // 获取并发送当前状态
      getAgentStatusState().then(state => {
        port.postMessage({
          type: 'AGENT_STATUS_UPDATE',
          payload: { status: state.status, message: state.message },
        });
      });

      port.onDisconnect.addListener(() => {
        console.log('[VibeMonkey] Stream port disconnected');
        activePorts.delete(port);
        // 注意：不设置 generationAborted，生成任务在后台继续运行
      });

      // 处理来自 Popup 的消息
      port.onMessage.addListener(async (message) => {
        if (message.type === 'GENERATE_SCRIPT_STREAM') {
          await handleGenerateScriptStream(message.payload);
        } else if (message.type === 'STOP_GENERATION') {
          // 用户明确点击停止按钮时才中断
          generationAborted = true;
          console.log('[VibeMonkey] User stopped generation');
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
    console.log('[VibeMonkey] Offscreen document created');
  } catch (e) {
    console.error('[VibeMonkey] Failed to create offscreen document:', e);
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
    scriptVersionManager = createScriptVersionManager();
    agentContextBuilder = createAgentContextBuilder(scriptVersionManager);

    // 初始化 Offscreen (使用 chrome.runtime.getURL 获取正确路径)
    // WXT 构建后 entrypoints/offscreen/index.html 通常对应 offscreen.html
    // 但为了保险，我们使用 entrypoints/offscreen/index.html 并依赖 WXT 的处理
    // 或者尝试直接使用 offscreen.html
    await setupOffscreenDocument('entrypoints/offscreen/index.html');

    console.log('[VibeMonkey] Clients initialized (including version manager)');
  } catch (error) {
    console.error('[VibeMonkey] Failed to initialize clients:', error);
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
      console.log('[VibeMonkey] Agent context built:', {
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

    // 5. 生成元数据
    const metadata: ScriptMetadata = {
      name: extractScriptName(content) || `VibeMonkey - ${domain}`,
      description: userRequest.slice(0, 100),
      match: [urlToMatchPattern(currentUrl)],
      grant: ['none'],
    };

    const metadataBlock = generateMetadataBlock(metadata);

    // 6. 编译 TypeScript 为 JavaScript
    updateAgentStatus('writing', '正在编译脚本...');
    const compileResult = await compileUserScript(scriptCode, metadataBlock);
    
    if (!compileResult.success || !compileResult.code) {
      updateAgentStatus('error', `编译失败: ${compileResult.error}`);
      return { success: false, error: `编译失败: ${compileResult.error}` };
    }

    const fullScript = compileResult.code;

    // 7. 代码审计
    let auditResult: AuditResult | undefined;
    if (codeAuditor) {
      auditResult = codeAuditor.audit(fullScript);
      console.log('[VibeMonkey] Audit score:', auditResult.score);
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
        script: fullScript,
        userRequest,
      });
    }

    // 10. 保存到版本化脚本管理器
    if (scriptVersionManager) {
      await scriptVersionManager.addScript({
        name: metadata.name,
        description: metadata.description,
        matchPattern: urlToMatchPattern(currentUrl),
        domain,
        code: scriptCode,  // 保存原始 TypeScript
        compiledCode: fullScript,  // 保存编译后的完整脚本
        userRequest,
      });
      console.log('[VibeMonkey] Script saved to version manager');
    }

    updateAgentStatus('idle', `已成功生成脚本：${metadata.name}`);

    return {
      success: true,
      script: fullScript,
      metadata,
      auditScore: auditResult?.score,
    };
  } catch (error) {
    console.error('[VibeMonkey] Generate script error:', error);
    updateAgentStatus('error', error instanceof Error ? error.message : '生成失败');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 构建增强的系统提示（包含详细 Agent 策略）
 */
function buildEnhancedSystemPrompt(context: AgentContext | null): string {
  let prompt = `你是 VibeMonkey，一个专业的油猴脚本工程师。

# 🎯 你的使命
让完全不懂编程的用户也能获得专属网页脚本。用户只需说"我想要..."，你就能自动完成一切。

# 📋 状态机工作流

你必须按以下状态顺序执行，每个状态都有明确的进入条件和退出条件：

\`\`\`
[开始] → [S1:搜索社区] → [S2:分析页面] → [S3:生成代码] → [S4:测试验证] → [S5:交付]
              ↓ 没找到          ↓ 失败重试         ↓ 编译失败      ↓ 测试失败
           继续S2             换关键词          修改代码         修改代码
\`\`\`

---

## S1: 搜索社区脚本

**目标**：看看别人有没有做过类似的

**动作序列**：
1. 调用 \`search_community_scripts\`
   - 参数：\`{ keyword: "当前域名 + 用户需求关键词" }\`
   - 例如用户说"隐藏广告"，域名是 bilibili.com
   - 调用：\`search_community_scripts({ keyword: "bilibili 广告" })\`

2. **如果找到脚本**（results.length > 0）：
   - 调用 \`get_community_script_detail({ url: results[0].url })\`
   - 分析代码是否满足需求
   - 如果满足 → 用 \`speak_to_user\` 告知用户并导入
   - 如果不满足 → 继续 S2

3. **如果没找到**：
   - 用 \`speak_to_user\` 说："社区暂无现成脚本，我来为你定制"
   - 继续 S2

---

## S2: 分析页面结构

**目标**：找到用户需求涉及的 DOM 元素

**动作序列**：

### 第一轮：精确关键词
\`\`\`
find_elements({
  keywords: [用户需求的关键词],
  weights: { 主要词: 2, 次要词: 1 },
  topN: 20
})
\`\`\`

**关键词选择策略**：
| 用户说的 | 应该搜索的关键词 |
|---------|----------------|
| "隐藏广告" | ["ad", "ads", "advertisement", "banner", "sponsor", "广告", "推广"] |
| "自动签到" | ["sign", "signin", "check", "checkin", "签到", "打卡", "button"] |
| "去除水印" | ["watermark", "logo", "水印", "版权"] |
| "改成绩" | ["score", "grade", "mark", "成绩", "分数", "table", "tr", "td"] |
| "自动播放" | ["play", "video", "player", "播放", "button"] |

### 第二轮：如果第一轮结果 < 3 个
\`\`\`
find_elements({
  keywords: ["table", "div", "span", "button", "input"],
  topN: 30
})
\`\`\`

### 第三轮：直接检查通用容器
\`\`\`
inspect_element({ selector: "table" })
inspect_element({ selector: "#content" })
inspect_element({ selector: ".main" })
inspect_element({ selector: "body > div" })
\`\`\`

### 退出条件
- 找到至少 1 个相关元素 → 继续 S3
- 尝试 3 轮都没找到 → 用 \`speak_to_user\` 问用户："请告诉我具体是页面上的哪个部分？"

---

## S3: 生成脚本代码

**目标**：根据分析结果编写 TypeScript 代码

**代码模板**：
\`\`\`typescript
// ==UserScript==
// @name         脚本名称
// @description  脚本描述
// @match        匹配URL
// ==/UserScript==

(function() {
  'use strict';
  
  // 1. 定义选择器（使用分析得到的选择器）
  const SELECTORS = {
    target: '从 find_elements 结果中获取的选择器',
  };
  
  // 2. 核心处理函数
  function processElement(el: Element) {
    // 具体操作
  }
  
  // 3. 处理已存在的元素
  document.querySelectorAll(SELECTORS.target).forEach(processElement);
  
  // 4. 处理动态加载的元素
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node instanceof Element) {
          if (node.matches(SELECTORS.target)) {
            processElement(node);
          }
          node.querySelectorAll(SELECTORS.target).forEach(processElement);
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
\`\`\`

**选择器优先级**：
1. \`[data-testid="xxx"]\` - 最稳定
2. \`#id\` - 很稳定
3. \`[role="xxx"]\` - 较稳定
4. \`.class\` - 可能变化
5. \`tag\` - 最不稳定

---

## S4: 测试验证

**目标**：确保脚本能正确执行

**动作序列**：
1. 调用 \`compile_and_validate({ code: 生成的代码 })\`
   - 如果编译失败 → 根据错误修改代码 → 重新编译
   
2. 调用 \`test_script({ code: 编译后的代码 })\`
   - 检查 \`sideEffects\` 是否包含预期操作
   - 如果 \`sideEffects\` 为空 → 可能选择器错误 → 返回 S2
   
3. 最多重试 3 次，每次修改策略

---

## S5: 交付

**动作序列**：
1. 用 \`speak_to_user\` 告知用户：
   - 脚本做了什么
   - 如何验证效果（如"刷新页面后广告应该消失"）
   
2. 脚本自动保存到存储

---

# 🚫 绝对禁止

1. **禁止跳过分析直接写代码**
   - 错误："我来写一个隐藏广告的脚本..."
   - 正确：先调用 find_elements，再写代码

2. **禁止说"无法分析"就放弃**
   - 错误："由于无法分析页面结构，我基于经验..."
   - 正确：换关键词、换选择器、问用户

3. **禁止使用未验证的选择器**
   - 错误：直接用 \`.ad-container\` 而不验证
   - 正确：用 inspect_element 确认选择器存在

4. **禁止一次失败就放弃**
   - 必须至少尝试 3 种不同方法

---

# 💬 与用户沟通规范

使用 \`speak_to_user\` 时：
- 消息不超过 50 字
- 说明当前在做什么
- 如果需要用户确认，说清楚选项

示例：
- "正在分析页面中的广告元素..."
- "找到 5 个疑似广告，开始生成脚本"
- "脚本已生成！刷新页面即可生效"
- "没找到成绩元素，请问成绩显示在表格里还是列表里？"
`;

  if (context) {
    prompt += '\n\n# 📊 当前上下文\n\n' + agentContextBuilder?.formatContextForPrompt(context);
  }

  return prompt;
}


/**
 * 处理流式脚本生成请求（无限重试 + Mem0 记忆）
 */
async function handleGenerateScriptStream(payload: GenerateScriptMessage['payload']): Promise<void> {
  if (!deepseekClient) {
    updateAgentStatus('error', '请先配置 OpenRouter API Key');
    return;
  }

  // 重置中断标志
  generationAborted = false;
  
  const { userRequest, currentUrl, pageInfo } = payload;
  const domain = pageInfo?.domain || new URL(currentUrl).hostname;
  
  let retryCount = 0;
  let lastError = '';
  let scriptCode = '';
  let fullAssistantContent = '';
  let compileResult: CompileResult | null = null;

  // 无限重试循环，直到成功或用户关闭 Popup
  while (!generationAborted) {
    retryCount++;
    
    try {
      updateAgentStatus('retrying', retryCount > 1 ? `第 ${retryCount} 次尝试...` : '正在初始化 Agent...');
      
      // 1. 构建上下文
      let agentContext: AgentContext | null = null;
      let failedApproaches = '';
      
      if (agentContextBuilder) {
        let memoryContext = '';
        if (mem0Client) {
          // 查询普通记忆
          const memories = await mem0Client.search(domain, { domain });
          if (memories.length > 0) {
            memoryContext = memories.map(m => `- ${m.content}`).join('\n');
          }
          
          // 查询历史失败记录
          const failures = await mem0Client.search(`${domain} 生成失败`, { 
            domain,
            type: 'script_version' 
          });
          const recentFailures = failures.filter(f => f.content.includes('失败'));
          if (recentFailures.length > 0) {
            failedApproaches = '\n\n⚠️ 以下方法已经失败过，请避免重复：\n' + 
              recentFailures.slice(0, 5).map(f => `- ${f.content}`).join('\n');
          }
        }

        agentContext = await agentContextBuilder.buildContext(
          currentUrl,
          pageInfo ? { title: pageInfo.title, markdown: pageInfo.markdown || '' } : undefined,
          memoryContext
        );
      }

      // 2. 构建提示（注入失败记录）
      const systemPrompt = buildEnhancedSystemPrompt(agentContext) + failedApproaches;
      const userPrompt = buildUserPrompt(userRequest, currentUrl, pageInfo) + 
        (lastError ? `\n\n上次尝试失败原因：${lastError}。请修正并重新生成。` : '');

      startKeepAlive();
      if (retryCount === 1) {
        broadcastMessage({ type: 'SCRIPT_GENERATION_START' });
      }

      fullAssistantContent = '';
      
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
        if (generationAborted) break;
        
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
            console.log('[Agent Tool Result]', event.content);
            updateAgentStatus('thinking', '正在处理工具返回结果...');
            break;
          
          case 'error':
            lastError = event.content;
            break;
        }
      }
      
      stopKeepAlive();
      
      if (generationAborted) {
        updateAgentStatus('idle', '已停止生成');
        return;
      }
      
      // 4. 解析脚本
      const scriptMatch = fullAssistantContent.match(/```(?:typescript|javascript|ts|js)?\n([\s\S]*?)```/);
      if (!scriptMatch) {
        lastError = '未能解析出有效代码块，请用 ```typescript 或 ```javascript 包裹代码';
        // 记录失败到 Mem0
        if (mem0Client) {
          await mem0Client.add(
            `尝试 #${retryCount} 失败：${lastError}`,
            'script_version',
            { domain, error: 'parse_error' }
          );
        }
        broadcastMessage({ 
          type: 'SCRIPT_GENERATION_RETRY', 
          payload: { attempt: retryCount, error: lastError } 
        });
        continue; // 重试
      }

      scriptCode = scriptMatch[1].trim();

      // 5. 编译
      const metadata: ScriptMetadata = {
        name: extractScriptName(fullAssistantContent) || `VibeMonkey - ${domain}`,
        description: userRequest.slice(0, 100),
        match: [urlToMatchPattern(currentUrl)],
        grant: ['none'],
      };

      const metadataBlock = generateMetadataBlock(metadata);
      updateAgentStatus('writing', '正在编译脚本...');
      compileResult = await compileUserScript(scriptCode, metadataBlock);
      
      if (!compileResult.success || !compileResult.code) {
        lastError = `编译失败: ${compileResult.error}`;
        // 记录编译失败到 Mem0
        if (mem0Client) {
          await mem0Client.add(
            `尝试 #${retryCount} 编译失败：${compileResult.error}\n代码片段：${scriptCode.slice(0, 200)}...`,
            'script_version',
            { domain, error: 'compile_error' }
          );
        }
        broadcastMessage({ 
          type: 'SCRIPT_GENERATION_RETRY', 
          payload: { attempt: retryCount, error: lastError } 
        });
        continue; // 重试
      }

      // 6. 强制测试验证
      updateAgentStatus('writing', '正在测试脚本...');
      const testResult = await handleSandboxExecute({ code: compileResult.code });
      
      if (!testResult.success) {
        lastError = `沙箱测试失败: ${testResult.error || '未知错误'}`;
        if (mem0Client) {
          await mem0Client.add(
            `尝试 #${retryCount} 测试失败：${lastError}\n代码片段：${scriptCode.slice(0, 200)}...`,
            'script_version',
            { domain, error: 'test_error' }
          );
        }
        broadcastMessage({ 
          type: 'SCRIPT_GENERATION_RETRY', 
          payload: { attempt: retryCount, error: lastError } 
        });
        continue; // 重试
      }
      
      // 如果有副作用，在页面上高亮显示
      if (testResult.sideEffects?.length > 0) {
        try {
          const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (activeTab?.id) {
            await browser.tabs.sendMessage(activeTab.id, { 
              type: 'HIGHLIGHT_ELEMENTS', 
              payload: testResult.sideEffects 
            });
          }
        } catch (e) {
          console.warn('[VibeMonkey] Failed to highlight elements:', e);
        }
      }

      // 7. 成功！保存并跳出循环
      const fullScript = compileResult.code;
      
      if (mem0Client) {
        await mem0Client.add(
          `为 ${domain} 成功生成脚本：${metadata.name}。用户需求：${userRequest}`,
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
          compiledCode: fullScript,
          userRequest,
        });
      }

      updateAgentStatus('idle', `已成功生成脚本：${metadata.name}`);

      broadcastMessage({
        type: 'SCRIPT_GENERATION_COMPLETE',
        payload: {
          success: true,
          script: fullScript,
          metadata
        }
      });
      
      return; // 成功，退出函数

    } catch (error) {
      stopKeepAlive();
      lastError = error instanceof Error ? error.message : '未知错误';
      console.error(`[VibeMonkey] 尝试 #${retryCount} 失败:`, error);
      
      // 记录异常到 Mem0
      if (mem0Client) {
        await mem0Client.add(
          `尝试 #${retryCount} 异常：${lastError}`,
          'script_version',
          { domain, error: 'exception' }
        );
      }
      
      broadcastMessage({ 
        type: 'SCRIPT_GENERATION_RETRY', 
        payload: { attempt: retryCount, error: lastError } 
      });
      // 继续重试
    }
  }
  
  // 如果循环结束是因为用户中断
  if (generationAborted) {
    updateAgentStatus('idle', '已停止生成');
  }
}

/**
 * 构建系统提示
 */
function buildSystemPrompt(existingScripts: { name: string; description: string }[], memoryContext: string): string {
  let prompt = `你是 VibeMonkey，一个专业的油猴脚本生成助手。你的任务是根据用户需求生成高质量的 Tampermonkey 兼容脚本。

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
    console.error('[VibeMonkey] Analyze DOM error:', error);
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
    console.log('[VibeMonkey] Healing actions:', actions);
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
    console.error('[VibeMonkey] Save API key error:', error);
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
    console.error('[VibeMonkey] Get history error:', error);
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
    console.error('[VibeMonkey] Delete history error:', error);
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
    console.error('[VibeMonkey] Audit script error:', error);
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
    console.error('[VibeMonkey] Compile TypeScript error:', error);
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
    console.error('[VibeMonkey] Validate TypeScript error:', error);
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
  if (!scriptVersionManager) {
    return { success: false, scripts: [] };
  }
  
  try {
    const scripts = await scriptVersionManager.getScriptsForUrl(url);
    const scriptsWithCode = scripts.map(s => ({
      ...s,
      compiledCode: s.versions[0]?.compiledCode || s.versions[0]?.code
    }));
    return { success: true, scripts: scriptsWithCode };
  } catch (error) {
    console.error('[VibeMonkey] Get matching scripts error:', error);
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
    console.error('[VibeMonkey] Get script list error:', error);
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
    console.error('[VibeMonkey] Toggle script error:', error);
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




