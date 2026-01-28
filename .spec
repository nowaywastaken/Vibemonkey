## 📋 概览

**Vibemonkey** 是一款创新的 **Chrome 扩展程序**。它将 Tampermonkey 脚本运行器的强大能力与 AI 的代码生成智慧相结合，创造了一个全新的工具范式：**Tampermonkey 脚本运行器 + AI 生成的脚本**。其核心是部署一个 AI Agent，使其像一位专业的脚本工程师，理解用户的网页定制需求，并自动完成从代码研究、脚本编写到测试运行的全过程。

### 🎯 核心理念

Vibemonkey 的构建遵循两个首要原则：

1. **用户群体绝对化**：目标是让完全不懂编程的用户也能轻松获得专属网页脚本。因此，**绝不能假设用户有任何技术能力来解决问题**。所有复杂性都应由 AI Agent 承担。
2. **AI Agent 拥有最高权限**：在设计系统的所有 Function 与工作流时，核心考量是为 Agent 提供**全面、无死角的控制权**，使其能够像人类开发者一样，自由地探索、决策、执行和修复。

---

## ⚙️ 技术架构详解

### 1. 基础技术栈

- **AI 引擎**：基于 DeepSeek V3.2 模型，通过 OpenRouter 接口调用。
- **开发框架**：采用 **WXT (Web Extension Toolkit)** 构建。
    - *补充*：WXT 之于浏览器扩展，犹如 Next.js 之于 React 应用。它引入了文件系统路由、自动导入（Auto-imports）和多浏览器构建支持，极大地降低了心智负担。
- **脚本语言**：使用 TypeScript 编写油猴脚本，编译与纠错过程对用户完全透明。

### 2. 智能化记忆系统 (Mem0)

为防止“修了东墙，坏了西墙”的脚本退化问题，Agent 需要一个能联系历史、理解演变的能力。我们直接集成 **Mem0 记忆系统**，通过“提取与更新”的机制来管理 AI 的长期记忆。

- **三大记忆类型**：
    1. **用户偏好记忆**：存储用户对 UI、交互等个性化设定。
    2. **网站知识记忆**：存储针对特定域名（如 [`example.com`](http://example.com)）的研究成果（例如，其购物车按钮是通过 XHR 异步加载的）。
    3. **脚本演进版本记忆**：存储每个脚本的历史版本、修改内容和反馈结果。这是追踪“代码异味”、定位回归问题的核心数据库。
- **存储与同步**：
    - **存储位置**：云端存储，按主域名进行逻辑分区。
    - **同步策略**：**后台自动同步**。Agent 的记忆会主动同步到云端 Mem0。Memory Function 主要用于让 AI **主动记录**关键洞察。

### 3. 安全与沙箱机制 (QuickJS)

在“氛围编程”中，直接在用户当前的浏览器上下文中执行 AI 生成的 JavaScript 代码具有极高的风险。我们引入 **QuickJS-emscripten** (WASM) 方案。

- **工作流**：
    1. **环境模拟**：将当前页面的 pruned DOM 作为一个模拟对象注入到 QuickJS 上下文中。
    2. **沙箱执行**：生成的脚本在 QuickJS 虚拟机中运行。
    3. **副作用捕获**：脚本尝试执行的操作（如 `document.querySelector('.ad').remove()`）会被捕获。
    4. **可视化反馈**：在真实页面上高亮标记脚本**试图**操作的元素，实现“影子执行（Shadow Execution）”。

---

## ⚓ Manifest V3 适配与生存策略

Chrome 的 Manifest V3 (MV3) 协议用短生命周期的 Service Worker 取代了传统长期运行的 Background Pages，这直接威胁到 AI Agent 执行耗时任务的能力。

### 1. 核心生存策略

基于 WXT 框架，采用一套组合策略：

1. **任务拆分与状态记录**：将复杂的脚本生成任务拆分为独立、可恢复的小步骤（分析 DOM → 生成脚本 → 编译 → 测试）。
2. **定期唤醒**：利用 WXT 的 `browser.alarms` API，以 ≤5 分钟的间隔定时唤醒 Service Worker。
3. **状态持久化**：所有关键状态高频保存到 [`browser.storage`](http://browser.storage)。Agent 重启时可无缝恢复“记忆”。

### 2. Service Worker 保活机制 (Keep-Alive Pattern) 实现

单纯的 `setInterval` 在 MV3 Service Worker 中并不可靠。解决方案是基于 **Alarms API** 的保活模式。

**技术实现代码**：

```tsx
// entrypoints/background/keepalive.ts
const HEARTBEAT_INTERVAL_SECONDS = 20;
export function startKeepAlive() {
  chrome.alarms.create('vibemonkey-heartbeat', {
    periodInMinutes: HEARTBEAT_INTERVAL_SECONDS / 60
  });
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'vibemonkey-heartbeat') {
    // 执行一个轻量级操作以重置计时器
    console.log('Vibemonkey: Heartbeat received');
    void chrome.runtime.getPlatformInfo();
  }
});
```

---

## 📡 通信架构方案

### 1. 核心通信链路：双向长连接 (Port-based)

由于 AI Agent 的任务属于“长任务”，传统的 `sendMessage` 容易中断。

- **方案**：使用 `chrome.runtime.connect` 建立持久化端口 (Port)。
- **优势**：
    - **流式输出**：DeepSeek 生成的 Token 可以通过 `port.postMessage` 实时推送到 UI。
        - *实现细节*：将 API 调用委托给 Background Script，利用 `port` 长连接回传流式数据，规避 CSP 问题。
    - **生命周期感知**：通过 `onDisconnect` 监听捕获 SW 关闭风险。

### 2. 跨层级“记忆”共享：Reactive Storage

- **方案**：[**`chrome.storage](http://chrome.storage).session` + `onChanged` 监听**。
- **应用**：Agent 的工作状态（如 `正在思考`）和 DTPP 剪枝后的临时 DOM 数据。
- **逻辑**：Service Worker 更新状态，Popup/Content Script 订阅变更，实现**状态响应式同步**。

### 3. DTPP 与安全沙箱通信拓扑

| **通信方向** | **技术实现** | **承载数据内容** |
| --- | --- | --- |
| **SW ↔ Content Script** | `tabs.sendMessage` | 发送 DTPP 评分函数，接收精简后的 DOM 片段。 |
| **Content Script ↔ Web Page** | `window.postMessage` | 探测网页原生的网络请求日志 (Network Logs)。 |
| **SW ↔ Offscreen Document** | `runtime.sendMessage` | **核心建议**：将 QuickJS 沙箱放在 Offscreen 中运行，防止 SW 被 WASM 挂起。 |

### 4. 通信补丁 (MV3)

- **心跳重置**：在长连接通信（Port）过程中，每次 `postMessage` 时，手动触发一次 Keep-Alive 操作，重置空闲计时器。
- **状态恢复**：通信包包含 `taskId`，SW 重启后根据 `storage` 中的 `taskId` 恢复上下文。

### 5. 架构最佳实践

- **消息类型安全**：使用 TypeScript `Discriminated Unions`。

```tsx
type AgentMessage = 
  | { type: 'STREAM_TOKEN'; payload: string }
  | { type: 'STATUS_CHANGE'; payload: 'thinking' | 'writing' }
  | { type: 'DTPP_RESULT'; payload: ElementCandidate[] };
```

- **避免主线程阻塞**：DTPP 剪枝应分片处理或移至 Offscreen。

---

## 🤖 核心工作流与策略

### Agent 的必备素质

- **迭代改进能力**：自行分析日志，找出原因并修改脚本。
- **结果导向思维**：不轻言放弃。
- **效率优先原则**：以最少的步骤完成任务。

### 策略一：智能脚本获取（先找现成的）

Agent 优先从全球开发者社区寻找现成脚本。

- **社区接入**：[Userscript.Zone](http://Userscript.Zone)、GreasyFork、OpenUserJS、GitHub/Gist。
- **流程**：搜索 → 代码审计 → 差异化定制 → 安全性验证 → 交付。

### 策略二：网页代码的智能分析 (DTPP)

**DOM-Tree Pruning Programming (DTPP)** 包含三个阶段：

| **阶段** | **执行机制** | **核心输出** |
| --- | --- | --- |
| **1. 规则过滤** | 移除所有非交互、不可见的冗余元素。 | 结构化、富含上下文的交互元素树。 |
| **2. 评分函数生成** | Agent 根据需求生成关键词及权重。 | 可执行的语义评分函数。 |
| **3. 外部执行与排序** | 在浏览器环境中执行评分，返回 Top N。 | 高度精简的关键 DOM 片段（语义化 Markdown）。 |

DTPP 将定位目标元素的准确率提升至 **88.28%**。

### 策略三：稳健的异常处理

- **循环纠错**：基于日志、状态、错误信息进行“测试-修改”循环。
- **脚本冲突预见**：主动分析新旧脚本冲突（选择器、事件），询问用户决策。

---

## 🧩 工程化与开发配置

### 项目脚手架

使用 WXT 官方 React 模板，结合 Tailwind CSS 和 Shadcn UI。

```bash
npx wxt@latest init vibemonkey --template react
```

**关键配置 (`wxt.config.ts`)**：macOS HMR 优化配置。

```tsx
import { defineConfig } from 'wxt';
export default defineConfig({
  manifest: {
    name: 'Vibemonkey',
    description: 'AI-driven Tampermonkey script generator',
    permissions: ['offscreen'],
    host_permissions: []
  },
  modules: ['@wxt-dev/module-react'],
  dev: {
    server: {
      hostname: '0.0.0.0'
    }
  }
});
```

---

## 🖥️ 用户交互界面 (POPUP)

- **状态栏**：扩展状态、当前域名、**模型工作状态**（流式显示）、Token 用量。
- **脚本列表**：
    - **激活的脚本**：显示具体作用网址（区分子域）。
    - **未激活的脚本**。
- **交互区域**：
    - **AI 消息**：流式回复。
    - **用户输入框**：需求、反馈。
- **上下文感知**：自动获知当前网址和历史脚本信息。

---

## 🛠️ AGENT FUNCTION 全集

### 1. 网页分析类

```tsx
function getDOMTree(options: { maxDepth?: number; includeHidden?: boolean }): Promise<DOMNode[]>
function findElements(query: { keywords: string[]; weights?: Record<string, number>; topN?: number }): Promise<ElementCandidate[]>
function inspectElement(selector: string): Promise<{ html: string; computedStyles: Record<string, string>; boundingRect: DOMRect; eventListeners: string[]; }>
function getNetworkLogs(filter?: { type?: 'xhr' | 'fetch' | 'script' | 'all'; urlPattern?: string }): Promise<NetworkLogEntry[]>
function getConsoleErrors(): Promise<ConsoleError[]>
```

### 2. 脚本管理类

```tsx
function getScripts(domain?: string): Promise<Script[]> 
function getScriptHistory(scriptId: string, limit?: number): Promise<ScriptVersion[]> 
function createScript(script: { name: string; description: string; matchUrls: string[]; code: string; enabled?: boolean }): Promise<{ scriptId: string; compileResult: CompileResult }>
function updateScript(scriptId: string, updates: { name?: string; description?: string; matchUrls?: string[]; code?: string; enabled?: boolean }): Promise<{ compileResult: CompileResult }>
function deleteScript(scriptId: string): Promise<void>
function toggleScript(scriptId: string, enabled: boolean): Promise<void>
function rollbackScript(scriptId: string, versionId: string): Promise<void>
```

### 3. 脚本执行与测试类

```tsx
function compileScript(code: string): Promise<CompileResult>
function testScript(code: string, timeout?: number): Promise<TestResult>
function executeScript(scriptId: string): Promise<ExecutionResult>
function stopScript(scriptId: string): Promise<void>
```

### 4. 社区脚本类

```tsx
function searchCommunityScripts(query: { keyword: string; source?: 'greasyfork' | 'openuserjs' | 'github' | 'all'; limit?: number }): Promise<CommunityScript[]>
function getCommunityScriptDetail(url: string): Promise<{ code: string; metadata: ScriptMetadata; ratings: number; installCount: number; }>
function importCommunityScript(url: string, autoAdapt?: boolean): Promise<{ scriptId: string }>
```

### 5. 记忆系统类 (Mem0)

```tsx
function addMemory(memory: { type: 'user_preference' | 'site_knowledge' | 'script_evolution'; domain?: string; scriptId?: string; content: string; metadata?: Record<string, any> }): Promise<{ memoryId: string }>
function searchMemory(query: { text: string; type?: 'user_preference' | 'site_knowledge' | 'script_evolution'; domain?: string; limit?: number }): Promise<Memory[]>
function getScriptEvolution(scriptId: string): Promise<{ oldMemory: Memory; newMemory: Memory; diff: MemoryDiff; }> 
function updateMemory(memoryId: string, content: string): Promise<void>
function deleteMemory(memoryId: string): Promise<void>
```

### 6. 用户交互类

```tsx
function sendMessage(message: string, type?: 'info' | 'warning' | 'error' | 'success'): Promise<void>
function requestConfirmation(question: string, choices?: string[]): Promise<string>
function requestInput(prompt: string, options?: { placeholder?: string; multiline?: boolean }): Promise<string>
function updateStatus(status: 'idle' | 'thinking' | 'writing' | 'testing' | 'tool_calling', detail?: string): Promise<void>
```

### 7. 工具与环境类

```tsx
function getCurrentTab(): Promise<{ url: string; domain: string; title: string }>
function getStorage(keys: string[]): Promise<Record<string, any>>
function setStorage(data: Record<string, any>): Promise<void>
function detectConflicts(newScript: { matchUrls: string[]; code: string }): Promise<Conflict[]>
function getTokenUsage(): Promise<{ used: number; limit: number }>
```

---

## 📝 Implementation Plan: AutoFix 增强

本次更新包含两个核心修复，旨在提升 Agent 的自主纠错能力和用户体验。

### 修复概览

| 修复项 | 目标 |
| --- | --- |
| **无限重试循环** | 失败时自动重试，直到用户主动停止 |
| **API Key 持久化** | 添加保存反馈，提升用户感知 |

---

### Feature 1: 无限重试 + Mem0 记忆

#### 核心逻辑

```tsx
while (!userStopped) {
  // 1. 查询 Mem0 获取此前失败的尝试
  // 2. 将失败记录注入 prompt，告诉 AI 不要重复
  // 3. 执行生成
  // 4. 如果失败 → 记录到 Mem0 → continue
  // 5. 如果成功 → break
}
```

#### [MODIFY] background.ts

**1. 添加生成中断标志**

```tsx
let generationAborted = false;

// 在 port.onDisconnect 中设置
port.onDisconnect.addListener(() => {
  generationAborted = true;
});
```

**2. 修改 handleGenerateScriptStream 函数**

```tsx
async function handleGenerateScriptStream(payload) {
  generationAborted = false;
  let retryCount = 0;
  
  while (!generationAborted) {
    retryCount++;
    updateAgentStatus('retrying', retryCount > 1 ? `第 ${retryCount} 次尝试...` : '正在生成...');
    
    // 1. 查询历史失败记录
    let failedApproaches = '';
    if (mem0Client) {
      const failures = await mem0Client.search(`${domain} 脚本生成失败`, { 
        domain, 
        type: 'script_version' 
      });
      if (failures.length > 0) {
        failedApproaches = '\n\n⚠️ 以下方法已经失败过，请避免：\n' + 
          failures.slice(0, 5).map(f => `- ${f.content}`).join('\n');
      }
    }
    
    // 2. 运行 Agent 循环（注入失败记录到 prompt）
    const agentLoop = deepseekClient.runStreamingAgentLoop([
      { role: 'system', content: systemPrompt + failedApproaches },
      { role: 'user', content: userPrompt }
    ], getAllTools(), executeTool);
    
    // ... 执行生成 ...
    
    // 3. 检查结果
    if (!scriptMatch) {
      // 记录失败到 Mem0
      if (mem0Client) {
        await mem0Client.add(
          `尝试 #${retryCount} 失败：未能解析代码块`,
          'script_version',
          { domain, error: 'parse_error' }
        );
      }
      broadcastMessage({ type: 'SCRIPT_GENERATION_RETRY', payload: { attempt: retryCount } });
      continue;
    }
    
    if (!compileResult.success) {
      // 记录编译错误到 Mem0
      if (mem0Client) {
        await mem0Client.add(
          `尝试 #${retryCount} 编译失败：${compileResult.error}\n代码片段：${scriptCode.slice(0, 200)}...`,
          'script_version',
          { domain, error: 'compile_error' }
        );
      }
      broadcastMessage({ type: 'SCRIPT_GENERATION_RETRY', payload: { attempt: retryCount, error: compileResult.error } });
      continue;
    }
    
    // 4. 成功 - 清理失败记录（可选）并跳出
    break;
  }
  
  if (generationAborted) {
    updateAgentStatus('idle', '已停止生成');
    return;
  }
}
```

**3. 添加消息类型**

```tsx
type AgentMessage = 
  | { type: 'STREAM_TOKEN'; payload: string }
  | { type: 'STATUS_CHANGE'; payload: 'thinking' | 'writing' }
  | { type: 'DTPP_RESULT'; payload: ElementCandidate[] }
  | { type: 'SCRIPT_GENERATION_RETRY'; payload: { attempt: number; error?: string } }; // 新增
```

#### [MODIFY] App.tsx

处理 `SCRIPT_GENERATION_RETRY` 消息，更新 UI 显示重试状态。

---

### Feature 2: API Key 持久化反馈

#### [MODIFY] background.ts

添加保存日志（详见前版本）。

#### [MODIFY] App.tsx

添加保存结果反馈（详见前版本）。

---

### Verification 验证步骤

1. `npm run build`
2. 测试：输入复杂需求，观察是否持续重试直到成功或手动关闭 Popup
3. 检查 Mem0 存储中是否有失败记录

---

## ✅ 总结

Vibemonkey 通过深度融合 AI Agent 与浏览器扩展能力，将复杂的网页脚本编写过程自动化、智能化。它通过精心设计的架构应对了 MV3 的技术挑战，通过创新的 DTPP 策略和 Mem0 记忆系统确保了高准确性与持续学习能力，并通过安全沙箱机制保障了用户的使用安全。其最终目标是让网页定制化变得像日常对话一样简单。