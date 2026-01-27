/**
 * 代码审计模块
 * 对脚本进行安全性和质量检查
 */

export interface AuditResult {
  passed: boolean;
  score: number;  // 0-100
  issues: AuditIssue[];
  warnings: AuditIssue[];
  suggestions: string[];
}

export interface AuditIssue {
  type: 'security' | 'performance' | 'compatibility' | 'style';
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  code?: string;
}

/**
 * 危险模式列表
 */
const DANGEROUS_PATTERNS = [
  {
    pattern: /\beval\s*\(/g,
    message: '使用 eval() 可能导致安全漏洞',
    severity: 'error' as const,
    type: 'security' as const,
  },
  {
    pattern: /new\s+Function\s*\(/g,
    message: '使用 new Function() 可能导致安全漏洞',
    severity: 'error' as const,
    type: 'security' as const,
  },
  {
    pattern: /document\.write\s*\(/g,
    message: 'document.write() 可能覆盖页面内容',
    severity: 'warning' as const,
    type: 'security' as const,
  },
  {
    pattern: /innerHTML\s*=/g,
    message: '直接设置 innerHTML 可能导致 XSS 攻击',
    severity: 'warning' as const,
    type: 'security' as const,
  },
  {
    pattern: /\.outerHTML\s*=/g,
    message: '直接设置 outerHTML 可能导致 XSS 攻击',
    severity: 'warning' as const,
    type: 'security' as const,
  },
  {
    pattern: /location\s*=|location\.href\s*=/g,
    message: '重定向用户可能被滥用',
    severity: 'warning' as const,
    type: 'security' as const,
  },
  {
    pattern: /\bcrypto\b.*private|password|secret/gi,
    message: '可能涉及敏感信息处理',
    severity: 'warning' as const,
    type: 'security' as const,
  },
  {
    pattern: /fetch\s*\([^)]*(?:password|token|key|secret)/gi,
    message: '网络请求中可能包含敏感信息',
    severity: 'error' as const,
    type: 'security' as const,
  },
];

/**
 * 性能问题模式
 */
const PERFORMANCE_PATTERNS = [
  {
    pattern: /setInterval\s*\([^,]+,\s*(\d+)\)/g,
    check: (match: RegExpExecArray) => {
      const interval = parseInt(match[1]);
      return interval < 100;
    },
    message: 'setInterval 间隔过短可能影响性能',
    severity: 'warning' as const,
    type: 'performance' as const,
  },
  {
    pattern: /querySelector(?:All)?\s*\([^)]+\)/g,
    count: 10,
    message: '频繁使用 DOM 查询可能影响性能，考虑缓存结果',
    severity: 'info' as const,
    type: 'performance' as const,
  },
  {
    pattern: /\.scrollTop|\.scrollLeft|\.offsetWidth|\.offsetHeight/g,
    count: 5,
    message: '频繁读取布局属性可能导致重排',
    severity: 'info' as const,
    type: 'performance' as const,
  },
];

/**
 * 最佳实践检查
 */
const BEST_PRACTICE_CHECKS = [
  {
    check: (code: string) => !code.includes("'use strict'") && !code.includes('"use strict"'),
    message: '建议添加 "use strict" 启用严格模式',
    severity: 'info' as const,
    type: 'style' as const,
  },
  {
    check: (code: string) => /var\s+\w+/.test(code),
    message: '建议使用 let/const 替代 var',
    severity: 'info' as const,
    type: 'style' as const,
  },
  {
    check: (code: string) => !code.includes('try') && code.length > 500,
    message: '较长的脚本建议添加错误处理',
    severity: 'info' as const,
    type: 'style' as const,
  },
];

/**
 * 代码审计器
 */
export class CodeAuditor {
  /**
   * 审计代码
   */
  audit(code: string): AuditResult {
    const issues: AuditIssue[] = [];
    const warnings: AuditIssue[] = [];
    const suggestions: string[] = [];

    // 检查危险模式
    for (const pattern of DANGEROUS_PATTERNS) {
      const matches = code.match(pattern.pattern);
      if (matches) {
        const lines = this.findLineNumbers(code, pattern.pattern);
        for (const line of lines) {
          const issue: AuditIssue = {
            type: pattern.type,
            severity: pattern.severity,
            message: pattern.message,
            line,
          };
          
          if (pattern.severity === 'error') {
            issues.push(issue);
          } else {
            warnings.push(issue);
          }
        }
      }
    }

    // 检查性能问题
    for (const pattern of PERFORMANCE_PATTERNS) {
      const matches = code.match(pattern.pattern);
      if (matches && pattern.count && matches.length >= pattern.count) {
        warnings.push({
          type: pattern.type,
          severity: pattern.severity,
          message: `${pattern.message} (发现 ${matches.length} 处)`,
        });
      }
    }

    // 最佳实践检查
    for (const check of BEST_PRACTICE_CHECKS) {
      if (check.check(code)) {
        suggestions.push(check.message);
      }
    }

    // 计算得分
    const score = this.calculateScore(issues, warnings, suggestions);

    return {
      passed: issues.length === 0,
      score,
      issues,
      warnings,
      suggestions,
    };
  }

  /**
   * 快速安全检查
   */
  quickSecurityCheck(code: string): boolean {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.severity === 'error' && pattern.pattern.test(code)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 查找匹配的行号
   */
  private findLineNumbers(code: string, pattern: RegExp): number[] {
    const lines: number[] = [];
    const codeLines = code.split('\n');
    
    for (let i = 0; i < codeLines.length; i++) {
      if (pattern.test(codeLines[i])) {
        lines.push(i + 1);
      }
      // 重置 RegExp 的 lastIndex
      pattern.lastIndex = 0;
    }
    
    return lines;
  }

  /**
   * 计算安全得分
   */
  private calculateScore(
    issues: AuditIssue[],
    warnings: AuditIssue[],
    suggestions: string[]
  ): number {
    let score = 100;
    
    // 每个错误扣 20 分
    score -= issues.length * 20;
    
    // 每个警告扣 5 分
    score -= warnings.length * 5;
    
    // 每个建议扣 1 分
    score -= suggestions.length * 1;
    
    return Math.max(0, Math.min(100, score));
  }
}

/**
 * 格式化审计结果
 */
export function formatAuditResult(result: AuditResult): string {
  const lines: string[] = [];
  
  lines.push(`安全评分: ${result.score}/100 ${result.passed ? '✅' : '❌'}`);
  lines.push('');
  
  if (result.issues.length > 0) {
    lines.push('## 错误');
    for (const issue of result.issues) {
      lines.push(`- ❌ ${issue.message}${issue.line ? ` (行 ${issue.line})` : ''}`);
    }
    lines.push('');
  }
  
  if (result.warnings.length > 0) {
    lines.push('## 警告');
    for (const warning of result.warnings) {
      lines.push(`- ⚠️ ${warning.message}${warning.line ? ` (行 ${warning.line})` : ''}`);
    }
    lines.push('');
  }
  
  if (result.suggestions.length > 0) {
    lines.push('## 建议');
    for (const suggestion of result.suggestions) {
      lines.push(`- 💡 ${suggestion}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * 创建代码审计器实例
 */
export function createCodeAuditor(): CodeAuditor {
  return new CodeAuditor();
}
