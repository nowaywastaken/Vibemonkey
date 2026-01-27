/**
 * 油猴脚本生成器
 * 根据需求和 DOM 分析结果生成 Tampermonkey 兼容脚本
 */

export interface ScriptMetadata {
  name: string;
  namespace?: string;
  version?: string;
  description: string;
  author?: string;
  match: string[];
  grant?: string[];
  require?: string[];
  runAt?: 'document-start' | 'document-end' | 'document-idle';
}

export interface GeneratedScript {
  metadata: ScriptMetadata;
  code: string;
  fullScript: string;
}

/**
 * 生成 Tampermonkey 元数据头
 */
export function generateMetadataBlock(metadata: ScriptMetadata): string {
  const lines: string[] = ['// ==UserScript=='];

  lines.push(`// @name         ${metadata.name}`);
  lines.push(`// @namespace    ${metadata.namespace || 'https://vibemonkey.local'}`);
  lines.push(`// @version      ${metadata.version || '1.0.0'}`);
  lines.push(`// @description  ${metadata.description}`);
  lines.push(`// @author       ${metadata.author || 'VibeMokey Agent'}`);

  for (const pattern of metadata.match) {
    lines.push(`// @match        ${pattern}`);
  }

  const grants = metadata.grant || ['none'];
  for (const grant of grants) {
    lines.push(`// @grant        ${grant}`);
  }

  if (metadata.require) {
    for (const req of metadata.require) {
      lines.push(`// @require      ${req}`);
    }
  }

  lines.push(`// @run-at       ${metadata.runAt || 'document-idle'}`);
  lines.push('// ==/UserScript==');
  lines.push('');

  return lines.join('\n');
}

/**
 * 生成完整脚本
 */
export function generateFullScript(metadata: ScriptMetadata, code: string): GeneratedScript {
  const metadataBlock = generateMetadataBlock(metadata);
  
  // 包装代码为 IIFE
  const wrappedCode = `(function() {
    'use strict';
    
${code.split('\n').map(line => '    ' + line).join('\n')}
})();`;

  const fullScript = metadataBlock + wrappedCode;

  return {
    metadata,
    code,
    fullScript,
  };
}

/**
 * 从 URL 生成 @match 模式
 */
export function urlToMatchPattern(url: string): string {
  try {
    const parsed = new URL(url);
    // 生成较宽松的匹配模式
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return url;
  }
}

/**
 * 生成等待元素出现的辅助代码
 */
export function generateWaitForElement(selector: string, timeout = 10000): string {
  return `
function waitForElement(selector, timeout = ${timeout}) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(\`Element \${selector} not found within \${timeout}ms\`));
    }, timeout);
  });
}`;
}

/**
 * 生成安全的 DOM 操作辅助代码
 */
export function generateDOMHelpers(): string {
  return `
// 安全地查询元素
function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return document.querySelectorAll(selector);
}

// 安全地添加事件监听
function on(element, event, handler) {
  if (element) {
    element.addEventListener(event, handler);
  }
}

// 创建元素
function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'className') {
      el.className = value;
    } else {
      el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else {
      el.appendChild(child);
    }
  }
  return el;
}`;
}

/**
 * 代码模板：添加按钮
 */
export function templateAddButton(
  targetSelector: string,
  buttonText: string,
  onClick: string
): string {
  return `
${generateDOMHelpers()}
${generateWaitForElement(targetSelector)}

waitForElement('${targetSelector}').then(target => {
  const button = createElement('button', {
    className: 'vibemonkey-btn',
    style: {
      padding: '8px 16px',
      marginLeft: '10px',
      backgroundColor: '#4CAF50',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px'
    }
  }, ['${buttonText}']);

  on(button, 'click', function() {
    ${onClick}
  });

  target.parentNode.insertBefore(button, target.nextSibling);
}).catch(err => {
  console.error('VibeMokey:', err);
});`;
}

/**
 * 代码模板：自动点击
 */
export function templateAutoClick(selector: string, delay = 0): string {
  return `
${generateWaitForElement(selector)}

waitForElement('${selector}').then(element => {
  ${delay > 0 ? `setTimeout(() => {
    element.click();
  }, ${delay});` : 'element.click();'}
}).catch(err => {
  console.error('VibeMokey:', err);
});`;
}

/**
 * 代码模板：隐藏元素
 */
export function templateHideElement(selector: string): string {
  return `
const style = document.createElement('style');
style.textContent = \`
  ${selector} {
    display: none !important;
  }
\`;
document.head.appendChild(style);`;
}

/**
 * 代码模板：修改文本
 */
export function templateReplaceText(selector: string, newText: string): string {
  return `
${generateWaitForElement(selector)}

waitForElement('${selector}').then(element => {
  element.textContent = '${newText}';
}).catch(err => {
  console.error('VibeMokey:', err);
});`;
}
