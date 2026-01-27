/**
 * TypeScript 编译器模块
 * 使用 SWC-Wasm 在浏览器中编译 TypeScript
 */

import type { Output, Options } from '@swc/wasm-web';

// SWC 模块引用
let swc: typeof import('@swc/wasm-web') | null = null;
let initialized = false;

/**
 * 编译选项
 */
export interface CompileOptions {
  minify?: boolean;
  sourceMaps?: boolean;
  target?: 'es5' | 'es2015' | 'es2016' | 'es2017' | 'es2018' | 'es2019' | 'es2020' | 'es2021' | 'es2022';
  module?: 'es6' | 'commonjs' | 'umd' | 'nodenext';
}

/**
 * 编译结果
 */
export interface CompileResult {
  success: boolean;
  code?: string;
  map?: string;
  error?: string;
}

/**
 * 初始化 SWC-Wasm
 */
export async function initializeCompiler(): Promise<boolean> {
  if (initialized && swc) {
    return true;
  }

  try {
    // 动态导入 SWC
    swc = await import('@swc/wasm-web');
    
    // 初始化 WASM 模块
    await swc.default();
    initialized = true;
    
    console.log('[VibeMokey] SWC-Wasm compiler initialized');
    return true;
  } catch (error) {
    console.error('[VibeMokey] Failed to initialize SWC-Wasm:', error);
    return false;
  }
}

/**
 * 编译 TypeScript 代码
 */
export async function compileTypeScript(
  code: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  if (!initialized || !swc) {
    const success = await initializeCompiler();
    if (!success) {
      return {
        success: false,
        error: 'Failed to initialize SWC-Wasm compiler',
      };
    }
  }

  try {
    const swcOptions: Options = {
      jsc: {
        parser: {
          syntax: 'typescript',
          tsx: false,
          decorators: true,
          dynamicImport: true,
        },
        target: options.target || 'es2020',
        loose: false,
        minify: options.minify ? {
          compress: true,
          mangle: true,
        } : undefined,
      },
      module: {
        type: options.module || 'es6',
      },
      sourceMaps: options.sourceMaps || false,
      minify: options.minify || false,
    };

    const result: Output = await swc!.transform(code, swcOptions);

    return {
      success: true,
      code: result.code,
      map: result.map || undefined,
    };
  } catch (error) {
    console.error('[VibeMokey] TypeScript compilation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown compilation error',
    };
  }
}

/**
 * 编译并打包 Tampermonkey 脚本
 */
export async function compileUserScript(
  tsCode: string,
  metadata: string
): Promise<CompileResult> {
  // 编译 TypeScript
  const result = await compileTypeScript(tsCode, {
    target: 'es2020',
    module: 'es6',
    minify: false, // 油猴脚本通常不压缩，便于阅读
  });

  if (!result.success || !result.code) {
    return result;
  }

  // 组合 metadata 和编译后的代码
  const fullScript = `${metadata}\n\n${result.code}`;

  return {
    success: true,
    code: fullScript,
  };
}

/**
 * 验证 TypeScript 语法
 */
export async function validateTypeScript(code: string): Promise<{
  valid: boolean;
  errors: string[];
}> {
  if (!initialized || !swc) {
    const success = await initializeCompiler();
    if (!success) {
      return {
        valid: false,
        errors: ['Failed to initialize SWC-Wasm compiler'],
      };
    }
  }

  try {
    // 尝试解析代码
    await swc!.parse(code, {
      syntax: 'typescript',
      tsx: false,
      decorators: true,
      dynamicImport: true,
    });

    return {
      valid: true,
      errors: [],
    };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : 'Unknown parse error'],
    };
  }
}

/**
 * 转换 JSX/TSX 代码
 */
export async function compileJSX(
  code: string,
  options: CompileOptions & { runtime?: 'automatic' | 'classic' } = {}
): Promise<CompileResult> {
  if (!initialized || !swc) {
    const success = await initializeCompiler();
    if (!success) {
      return {
        success: false,
        error: 'Failed to initialize SWC-Wasm compiler',
      };
    }
  }

  try {
    const swcOptions: Options = {
      jsc: {
        parser: {
          syntax: 'typescript',
          tsx: true,
          decorators: true,
          dynamicImport: true,
        },
        target: options.target || 'es2020',
        transform: {
          react: {
            runtime: options.runtime || 'automatic',
            development: false,
            throwIfNamespace: true,
          },
        },
      },
      module: {
        type: options.module || 'es6',
      },
      minify: options.minify || false,
    };

    const result: Output = await swc!.transform(code, swcOptions);

    return {
      success: true,
      code: result.code,
      map: result.map || undefined,
    };
  } catch (error) {
    console.error('[VibeMokey] JSX compilation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown compilation error',
    };
  }
}

/**
 * 压缩 JavaScript 代码
 */
export async function minifyCode(code: string): Promise<CompileResult> {
  if (!initialized || !swc) {
    const success = await initializeCompiler();
    if (!success) {
      return {
        success: false,
        error: 'Failed to initialize SWC-Wasm compiler',
      };
    }
  }

  try {
    const result = await swc!.transform(code, {
      jsc: {
        parser: {
          syntax: 'ecmascript',
        },
        target: 'es2020',
        minify: {
          compress: {
            unused: true,
          },
          mangle: true,
        },
      },
      minify: true,
    });

    return {
      success: true,
      code: result.code,
    };
  } catch (error) {
    console.error('[VibeMokey] Minification error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown minification error',
    };
  }
}

/**
 * 检查编译器是否已初始化
 */
export function isCompilerInitialized(): boolean {
  return initialized;
}
