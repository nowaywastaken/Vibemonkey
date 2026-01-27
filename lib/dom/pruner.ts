/**
 * DOM 剪枝模块
 * 实现 Prune4Web 策略的 3 阶段 DOM 剪枝
 */

/**
 * 需要移除的无意义标签
 */
const PRUNE_TAGS = [
  'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
  'video', 'audio', 'object', 'embed', 'applet', 'map',
  'head', 'meta', 'link', 'template', 'slot',
];

/**
 * 需要保留的交互元素标签
 */
const INTERACTIVE_TAGS = [
  'a', 'button', 'input', 'select', 'textarea', 'form',
  'label', 'option', 'optgroup', 'details', 'summary',
  'dialog', 'menu', 'menuitem',
];

/**
 * 需要保留的语义结构标签
 */
const SEMANTIC_TAGS = [
  'main', 'article', 'section', 'nav', 'aside', 'header', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'figure', 'figcaption', 'blockquote', 'pre', 'code',
];

export interface PrunedElement {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  attributes?: Record<string, string>;
  children?: PrunedElement[];
  score?: number;
  selector?: string;
}

export interface PruneOptions {
  maxDepth?: number;
  maxElements?: number;
  keywords?: string[];
  includeHidden?: boolean;
}

/**
 * DOM 剪枝器类
 */
export class DOMPruner {
  private options: Required<PruneOptions>;

  constructor(options: PruneOptions = {}) {
    this.options = {
      maxDepth: options.maxDepth ?? 10,
      maxElements: options.maxElements ?? 100,
      keywords: options.keywords ?? [],
      includeHidden: options.includeHidden ?? false,
    };
  }

  /**
   * 阶段1：规则过滤 - 移除无关元素
   */
  pruneDecorative(doc: Document): void {
    // 移除无意义标签
    for (const tag of PRUNE_TAGS) {
      const elements = doc.querySelectorAll(tag);
      elements.forEach(el => el.remove());
    }

    // 移除隐藏元素
    if (!this.options.includeHidden) {
      const allElements = doc.querySelectorAll('*');
      allElements.forEach(el => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          el.remove();
        }
      });
    }

    // 移除空元素
    const allElements = doc.querySelectorAll('*');
    allElements.forEach(el => {
      if (!el.textContent?.trim() && 
          !INTERACTIVE_TAGS.includes(el.tagName.toLowerCase()) &&
          el.children.length === 0) {
        el.remove();
      }
    });
  }

  /**
   * 阶段2：评分函数 - 根据关键词和交互性评分
   */
  buildScoringFunction(keywords: string[]): (el: Element) => number {
    const keywordSet = new Set(keywords.map(k => k.toLowerCase()));
    
    return (el: Element): number => {
      let score = 0;
      const tagName = el.tagName.toLowerCase();
      const text = el.textContent?.toLowerCase() || '';
      const id = el.id?.toLowerCase() || '';
      const className = el.className?.toString().toLowerCase() || '';

      // 交互元素加分
      if (INTERACTIVE_TAGS.includes(tagName)) {
        score += 10;
      }

      // 语义元素加分
      if (SEMANTIC_TAGS.includes(tagName)) {
        score += 5;
      }

      // 关键词匹配加分
      for (const keyword of keywordSet) {
        if (text.includes(keyword)) score += 15;
        if (id.includes(keyword)) score += 20;
        if (className.includes(keyword)) score += 20;
      }

      // 有 ID 的元素加分（选择器稳定性）
      if (el.id) score += 8;

      // 有特定属性的加分
      if (el.hasAttribute('data-testid')) score += 10;
      if (el.hasAttribute('aria-label')) score += 5;
      if (el.hasAttribute('role')) score += 5;

      return score;
    };
  }

  /**
   * 阶段3：提取前 N 个最相关节点
   */
  extractTopCandidates(doc: Document, n: number = 50): PrunedElement[] {
    const scoringFn = this.buildScoringFunction(this.options.keywords);
    const candidates: { element: Element; score: number }[] = [];

    // 遍历所有元素并评分
    const allElements = doc.querySelectorAll('*');
    allElements.forEach(el => {
      const score = scoringFn(el);
      if (score > 0) {
        candidates.push({ element: el, score });
      }
    });

    // 按分数排序
    candidates.sort((a, b) => b.score - a.score);

    // 提取前 N 个
    const topCandidates = candidates.slice(0, n);

    return topCandidates.map(({ element, score }) => this.elementToPrunedElement(element, score));
  }

  /**
   * 将 DOM 元素转换为精简对象
   */
  private elementToPrunedElement(el: Element, score?: number): PrunedElement {
    const result: PrunedElement = {
      tag: el.tagName.toLowerCase(),
    };

    if (el.id) {
      result.id = el.id;
      result.selector = `#${el.id}`;
    }

    if (el.className && typeof el.className === 'string') {
      result.classes = el.className.split(' ').filter(c => c.trim());
      if (!result.selector && result.classes.length > 0) {
        result.selector = `${result.tag}.${result.classes[0]}`;
      }
    }

    const text = el.textContent?.trim();
    if (text && text.length < 200) {
      result.text = text;
    }

    // 提取关键属性
    const importantAttrs = ['href', 'src', 'type', 'name', 'value', 'placeholder', 
                           'aria-label', 'data-testid', 'role', 'title'];
    const attributes: Record<string, string> = {};
    for (const attr of importantAttrs) {
      const val = el.getAttribute(attr);
      if (val) {
        attributes[attr] = val;
      }
    }
    if (Object.keys(attributes).length > 0) {
      result.attributes = attributes;
    }

    if (score !== undefined) {
      result.score = score;
    }

    // 生成选择器
    if (!result.selector) {
      result.selector = this.generateSelector(el);
    }

    return result;
  }

  /**
   * 生成元素的 CSS 选择器
   */
  private generateSelector(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;

    while (current && current !== document.body && parts.length < 5) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        return `#${current.id} ${parts.reverse().join(' > ')}`.trim();
      }

      if (current.className && typeof current.className === 'string') {
        const firstClass = current.className.split(' ')[0]?.trim();
        if (firstClass) {
          selector += `.${firstClass}`;
        }
      }

      // 添加 nth-child 以增加唯一性
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          c => c.tagName === current!.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      parts.push(selector);
      current = current.parentElement;
    }

    return parts.reverse().join(' > ');
  }

  /**
   * 完整的剪枝流程
   */
  prune(doc: Document): PrunedElement[] {
    // 克隆文档避免修改原始 DOM
    const clone = doc.cloneNode(true) as Document;
    
    // 阶段1：规则过滤
    this.pruneDecorative(clone);
    
    // 阶段2+3：评分并提取
    return this.extractTopCandidates(clone, this.options.maxElements);
  }
}

/**
 * 快速剪枝函数
 */
export function quickPrune(doc: Document, keywords: string[] = []): PrunedElement[] {
  const pruner = new DOMPruner({ keywords });
  return pruner.prune(doc);
}
