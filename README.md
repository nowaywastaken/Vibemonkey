# VibeMonkey 🐵

> **Tampermonkey 脚本运行器 + AI 生成的脚本**。智能油猴脚本生成 Chrome 扩展 - 基于 DeepSeek V3.2 与 Mem0 记忆系统。

Vibemonkey 是一款创新的 Chrome 扩展程序。它将 AI 的代码生成智慧与脚本运行器的强大能力相结合，旨在让完全不懂编程的用户也能轻松获得专属网页脚本。

## ✨ 核心特性

- **🤖 智能生成**: 使用 DeepSeek V3.2 模型，通过自然语言需求自动完成从代码研究、脚本编写到测试运行的全过程。
- **🔍 DTPP (DOM-Tree Pruning Programming)**: 独创的 DOM 剪枝策略，通过规则过滤、语义评分和 Top-N 提取，将定位目标元素的准确率提升至 88.28%。
- **🧠 记忆系统 (Mem0)**: 三级记忆架构（用户偏好、网站知识、脚本演进），防止脚本退化，实现持续学习。
- **🛡️ 安全沙箱 (QuickJS)**: 基于 WebAssembly 的 QuickJS 虚拟机，支持“影子执行（Shadow Execution）”，在不影响真实页面的情况下捕获脚本副作用。
- **⚡ MV3 适配**: 完善的 Service Worker 保活机制（Keep-Alive Pattern）和状态持久化策略，确保长任务执行。

## 🚀 快速开始

### 开发环境配置

```bash
# 安装依赖
npm install

# 启动开发模式 (自动加载扩展)
npm run dev
```

### 生产环境构建

```bash
# 构建生产版本
npm run build
```

## 🛠️ 技术架构

- **框架**: [WXT (Web Extension Toolkit)](https://wxt.dev/) + React + Tailwind CSS
- **AI 引擎**: DeepSeek V3.2 (via OpenRouter)
- **编译器**: SWC-Wasm (支持 TypeScript 实时编译)
- **沙箱**: QuickJS-emscripten (WASM)
- **记忆**: Mem0 API / Local Storage

## ⚙️ 配置说明

1. 点击扩展图标打开 Popup。
2. 进入 ⚙️ 设置页面。
3. 配置 **OpenRouter API Key** (必填) 和 **Mem0 API Key** (可选)。

## 📦 项目结构

- `entrypoints/`: 包含 background, content, popup, offscreen 等入口。
- `lib/agent/`: Agent 核心逻辑、DeepSeek 客户端及工具定义。
- `lib/dom/`: DTPP 剪枝算法及 Markdown 转换。
- `lib/memory/`: Mem0 记忆系统集成。
- `lib/script/`: 脚本版本管理、仓库搜索及生成。
- `lib/compiler/`: TypeScript 到 JavaScript 的 Wasm 编译。
- `lib/feedback/`: 网络监控与自愈系统。

## 📄 License

MIT