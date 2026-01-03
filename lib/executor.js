// ==========================================
// ⚡️ 确定性执行器 V3 (Stability Aware)
// ==========================================
// 核心改进：引入智能等待 (waitForStability)
// 移除硬编码 delay

const EXECUTOR_CONFIG = {
    maxRetries: 3,
    defaultTimeout: 15000,
    quickDelay: 300,
    stabilityDuration: 500 // 需要由多长时间的“静默”才算稳定
};

/**
 * 智能等待页面稳定
 */
async function waitForStability(tabId, timeout = EXECUTOR_CONFIG.defaultTimeout) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: (duration, maxWait) => {
                return new Promise(resolve => {
                    let lastMutation = Date.now();
                    let observer = new MutationObserver(() => {
                        lastMutation = Date.now();
                    });
                    
                    observer.observe(document.body, { 
                        subtree: true, 
                        childList: true, 
                        attributes: true, 
                        characterData: true 
                    });
                    
                    const interval = setInterval(() => {
                        const now = Date.now();
                        // 1. DOM 静默检测
                        const isDomStable = (now - lastMutation) > duration;
                        // 2. ReadyState 检测
                        const isReady = document.readyState === 'complete';
                        
                        if (isDomStable && isReady) {
                            cleanup();
                            resolve({ stable: true });
                        }
                        
                        // 超时
                        if (now - lastMutation > maxWait) { 
                            // 注意：这里的 timeout 逻辑有点怪，通常是总时间超时
                        }
                    }, 100);
                    
                    // 总超时强制结束
                    const timeoutId = setTimeout(() => {
                        cleanup();
                        resolve({ stable: false, reason: 'timeout' });
                    }, maxWait);
                    
                    function cleanup() {
                        observer.disconnect();
                        clearInterval(interval);
                        clearTimeout(timeoutId);
                    }
                });
            },
            args: [EXECUTOR_CONFIG.stabilityDuration, timeout]
        });
    } catch (e) {
        // Tab 可能关闭了
        console.warn('Wait stability failed:', e);
    }
}



/**
 * 验证输入值是否正确设置
 */
async function verifyValue(tabId, target, expectedValue) {
    const selectors = Array.isArray(target) ? target : [{ type: 'css', value: target }];
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId },
            func: (candidateSelectors, val) => {
                let el = null;
                for (const selObj of candidateSelectors) {
                    try {
                        if (selObj.type === 'xpath') {
                            el = document.evaluate(selObj.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        } else {
                            el = document.querySelector(selObj.value);
                        }
                        if (el) break;
                    } catch(e) {}
                }
                
                if (!el) return { success: false, reason: 'element_not_found' };
                const current = el.value || '';
                
                // 🌟 Strict check for equality, with a trim fallback
                const success = val === '' ? current === '' : (current === val || current.trim() === val.trim());
                return { success, current, expected: val }; 
            },
            args: [selectors, expectedValue]
        });
        return result[0]?.result || { success: false, reason: 'script_failed' };
    } catch (e) {
        return { success: false, error: e.message, reason: 'exception' };
    }
}

/**
 * 执行单个步骤
 */
async function executeStep(step, context = {}) {
    const { tabId, userMemory = {}, onProgress } = context;
    
    // 替换占位符 (委托给 Planner 或自己做)
    const resolvedStep = self.Planner?.resolveStepPlaceholders 
        ? self.Planner.resolveStepPlaceholders(step, userMemory)
        : step;
    
    const result = {
        stepId: step.id,
        action: step.action,
        success: false,
        error: null,
        executedAt: Date.now()
    };
    
    // 报告进度
    if (onProgress) onProgress({ type: 'step_start', step: resolvedStep });
    
    try {
        switch (resolvedStep.action) {
            case 'navigate':
                await executeNavigate(tabId, resolvedStep);
                result.success = true;
                break;
                
            case 'fill':
                await executeFill(tabId, resolvedStep);
                result.success = true;
                break;
                
            case 'click':
                await executeClick(tabId, resolvedStep, result);
                break;
                
            case 'wait': // 显式等待
                await delay(parseInt(resolvedStep.value) || 1000);
                result.success = true;
                break;
                
            case 'scroll':
                await executeScroll(tabId, resolvedStep);
                result.success = true;
                break;
                
            case 'select':
                await executeSelect(tabId, resolvedStep);
                result.success = true;
                break;

            default:
                throw new Error(`Unknown action: ${resolvedStep.action}`);
        }
        
        // 🌟 动作后自动等待稳定 (核心改进)
        if (['click', 'navigate', 'fill', 'select'].includes(resolvedStep.action)) {
            // 对 fill 操作进行值验证
            if (resolvedStep.action === 'fill') {
                const verifyRes = await verifyValue(tabId, resolvedStep.target, resolvedStep.value);
                if (!verifyRes.success) {
                    console.warn(`Verify failed (${verifyRes.reason}): current="${verifyRes.current}", expected="${verifyRes.expected}". Retrying once...`);
                    // Retry once
                    await executeFill(tabId, resolvedStep);
                    const secondVerify = await verifyValue(tabId, resolvedStep.target, resolvedStep.value);
                    if (!secondVerify.success) {
                        throw new Error(`Verification persistent failure: expected "${resolvedStep.value}" but got "${secondVerify.current}"`);
                    }
                }
            }
            
            await waitForStability(tabId, 2000); 
        }

    } catch (error) {
        result.error = error.message;
        result.success = false;
        console.error(`Step failed:`, error);
    }
    
    // 报告结果
    if (onProgress) onProgress({ type: 'step_complete', step: resolvedStep, result });
    
    return result;
}

/**
 * 智能定位并等待元素出现 (原子化重试核心)
 */
async function findAndObserveElement(tabId, selectors, timeout = 5000) {
    if (!selectors || selectors.length === 0) return { found: false };
    
    return await chrome.scripting.executeScript({
        target: { tabId },
        func: async (candidateSelectors, waitTimeout) => {
            const cleanSelectors = JSON.parse(JSON.stringify(candidateSelectors));
            const cleanTimeout = JSON.parse(JSON.stringify(waitTimeout));
            const start = Date.now();
            
            while (Date.now() - start < cleanTimeout) {
                for (const selObj of cleanSelectors) {
                    let el = null;
                    try {
                        if (selObj.type === 'xpath') {
                            el = document.evaluate(selObj.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        } else {
                            el = document.querySelector(selObj.value);
                        }
                        
                        if (el) {
                            // 检查可见性
                            const style = window.getComputedStyle(el);
                            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                            if (isVisible) {
                                // 滚动到视图
                                el.scrollIntoView({ behavior: 'instant', block: 'center' });
                                return { found: true, selectorUsed: selObj.value, type: selObj.type };
                            }
                        }
                    } catch (e) {}
                }
                await new Promise(r => setTimeout(r, 200));
            }
            return { found: false };
        },
        args: [selectors, timeout]
    }).then(res => res[0]?.result || { found: false });
}

async function executeNavigate(tabId, step) {
    await chrome.tabs.update(tabId, { url: step.target });
    // 等待加载完成
    await new Promise(resolve => {
        const listener = (tid, info) => {
            if (tid === tabId && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener); // 超时也继续
            resolve(); 
        }, 15000);
    });
}

async function executeFill(tabId, step) {
    const selectors = Array.isArray(step.target) ? step.target : [{ type: 'css', value: step.target }];
    
    const locator = await findAndObserveElement(tabId, selectors);
    if (!locator.found) throw new Error('Element not found after retry: ' + JSON.stringify(selectors));

    await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel, type, value) => {
            let el = null;
            if (type === 'xpath') {
                el = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            } else {
                el = document.querySelector(sel);
            }
            
            if (!el) throw new Error('Lost element during execution');
            
            el.focus();
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
        },
        args: [locator.selectorUsed, locator.type, step.value]
    });
}

async function executeClick(tabId, step, result) {
    const selectors = Array.isArray(step.target) ? step.target : [{ type: 'css', value: step.target }];
    
    const locator = await findAndObserveElement(tabId, selectors);
    if (!locator.found) throw new Error('Element not found after retry: ' + JSON.stringify(selectors));

    const execResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel, type) => {
            let el = null;
            if (type === 'xpath') {
                el = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            } else {
                el = document.querySelector(sel);
            }
            
            if (!el) throw new Error('Lost element during execution');
            
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.click();
            
            return { isLink: el.tagName === 'A' };
        },
        args: [locator.selectorUsed, locator.type]
    });
    
    result.success = true;
    result.causedNavigation = execResult[0]?.result?.isLink;
}

async function executeScroll(tabId, step) {
    if (step.target && step.target !== 'window') {
        const selectors = Array.isArray(step.target) ? step.target : [{ type: 'css', value: step.target }];
        await findAndObserveElement(tabId, selectors, 2000);
    } else {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => window.scrollBy(0, 500)
        });
    }
    await delay(300);
}

async function executeSelect(tabId, step) {
    const selectors = Array.isArray(step.target) ? step.target : [{ type: 'css', value: step.target }];
    const locator = await findAndObserveElement(tabId, selectors);
    if (!locator.found) throw new Error('Element not found');

    await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel, type, value) => {
            let el = null;
            if (type === 'xpath') {
                el = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            } else {
                el = document.querySelector(sel);
            }
            if (!el) throw new Error('Element not found');
            el.value = value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        args: [locator.selectorUsed, locator.type, step.value]
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 导出
if (typeof self !== 'undefined') {
    self.Executor = {
        executeStep,
        waitForStability,
        EXECUTOR_CONFIG
    };
}
