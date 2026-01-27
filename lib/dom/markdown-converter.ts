/**
 * HTML 转 Markdown 转换器
 * 将 DOM 元素转换为语义化 Markdown，便于 LLM 处理
 */

import { PrunedElement } from './pruner';

/**
 * 将 HTML 文档转换为 Markdown
 */
export function htmlToMarkdown(doc: Document): string {
  const body = doc.body;
  if (!body) return '';

  return elementToMarkdown(body, 0);
}

/**
 * 将单个元素转换为 Markdown
 */
function elementToMarkdown(el: Element, depth: number): string {
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.children);
  const text = el.textContent?.trim() || '';

  switch (tag) {
    // 标题
    case 'h1':
      return `# ${text}\n\n`;
    case 'h2':
      return `## ${text}\n\n`;
    case 'h3':
      return `### ${text}\n\n`;
    case 'h4':
      return `#### ${text}\n\n`;
    case 'h5':
      return `##### ${text}\n\n`;
    case 'h6':
      return `###### ${text}\n\n`;

    // 段落和文本块
    case 'p':
      return `${text}\n\n`;
    case 'blockquote':
      return `> ${text}\n\n`;
    case 'pre':
    case 'code':
      return `\`\`\`\n${text}\n\`\`\`\n\n`;

    // 列表
    case 'ul':
      return children.map(child => {
        const liText = child.textContent?.trim() || '';
        return `- ${liText}`;
      }).join('\n') + '\n\n';
    case 'ol':
      return children.map((child, i) => {
        const liText = child.textContent?.trim() || '';
        return `${i + 1}. ${liText}`;
      }).join('\n') + '\n\n';

    // 链接
    case 'a':
      const href = el.getAttribute('href') || '#';
      return `[${text}](${href})`;

    // 图片
    case 'img':
      const src = el.getAttribute('src') || '';
      const alt = el.getAttribute('alt') || 'image';
      return `![${alt}](${src})`;

    // 表格
    case 'table':
      return tableToMarkdown(el as HTMLTableElement);

    // 交互元素（特殊标记）
    case 'button':
      return `[Button: ${text}]`;
    case 'input':
      const inputType = el.getAttribute('type') || 'text';
      const placeholder = el.getAttribute('placeholder') || '';
      return `[Input(${inputType}): ${placeholder}]`;
    case 'select':
      return `[Select: ${text}]`;
    case 'form':
      return `[Form]\n${childrenToMarkdown(el, depth)}\n[/Form]\n\n`;

    // 容器元素递归处理
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'nav':
    case 'aside':
    case 'header':
    case 'footer':
      return childrenToMarkdown(el, depth);

    default:
      if (children.length > 0) {
        return childrenToMarkdown(el, depth);
      }
      return text ? `${text}\n` : '';
  }
}

/**
 * 递归处理子元素
 */
function childrenToMarkdown(el: Element, depth: number): string {
  if (depth > 10) return ''; // 防止无限递归

  const children = Array.from(el.children);
  return children.map(child => elementToMarkdown(child, depth + 1)).join('');
}

/**
 * 将表格转换为 Markdown
 */
function tableToMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  const lines: string[] = [];
  let hasHeader = false;

  rows.forEach((row, i) => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    const cellTexts = cells.map(cell => cell.textContent?.trim() || '');
    lines.push(`| ${cellTexts.join(' | ')} |`);

    // 第一行后添加分隔线
    if (i === 0 && row.querySelector('th')) {
      hasHeader = true;
      lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
    }
  });

  // 如果没有表头，在第一行后添加分隔线
  if (!hasHeader && lines.length > 0) {
    const firstRowCells = rows[0]?.querySelectorAll('td').length || 1;
    lines.splice(1, 0, `| ${Array(firstRowCells).fill('---').join(' | ')} |`);
  }

  return lines.join('\n') + '\n\n';
}

/**
 * 将 PrunedElement 数组转换为结构化描述
 */
export function prunedElementsToMarkdown(elements: PrunedElement[]): string {
  const lines: string[] = ['# 页面结构分析\n'];

  // 按分数分组
  const highScore = elements.filter(e => (e.score || 0) >= 20);
  const mediumScore = elements.filter(e => (e.score || 0) >= 10 && (e.score || 0) < 20);
  const lowScore = elements.filter(e => (e.score || 0) < 10);

  if (highScore.length > 0) {
    lines.push('## 高优先级元素 (核心交互)\n');
    highScore.forEach(el => {
      lines.push(prunedElementToLine(el));
    });
    lines.push('');
  }

  if (mediumScore.length > 0) {
    lines.push('## 中优先级元素\n');
    mediumScore.forEach(el => {
      lines.push(prunedElementToLine(el));
    });
    lines.push('');
  }

  if (lowScore.length > 0) {
    lines.push('## 其他元素\n');
    lowScore.slice(0, 20).forEach(el => { // 限制数量
      lines.push(prunedElementToLine(el));
    });
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 将单个 PrunedElement 转换为描述行
 */
function prunedElementToLine(el: PrunedElement): string {
  const parts: string[] = [];
  
  // 标签和选择器
  parts.push(`- **${el.tag}**`);
  if (el.selector) {
    parts.push(`\`${el.selector}\``);
  }

  // 分数
  if (el.score !== undefined) {
    parts.push(`(分数: ${el.score})`);
  }

  // 文本内容
  if (el.text) {
    const truncated = el.text.length > 50 ? el.text.slice(0, 50) + '...' : el.text;
    parts.push(`"${truncated}"`);
  }

  // 关键属性
  if (el.attributes) {
    const attrStr = Object.entries(el.attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    if (attrStr) {
      parts.push(`{${attrStr}}`);
    }
  }

  return parts.join(' ');
}

/**
 * 快速转换：从 HTML 字符串到 Markdown
 */
export function quickHtmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return htmlToMarkdown(doc);
}
