import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'VibeMonkey',
    description: '智能油猴脚本生成 Chrome 扩展 - 基于 DeepSeek V3.2 与 Mem0 记忆系统',
    permissions: [
      'activeTab',
      'storage',
      'scripting',
      'tabs',
      'alarms',
      'offscreen',
    ],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  modules: ['@wxt-dev/module-react'],
  dev: {
    server: {
      hostname: '0.0.0.0',
    },
  },
});
