import { getQuickJS } from 'quickjs-emscripten';

let qjs: Awaited<ReturnType<typeof getQuickJS>> | null = null;

async function init() {
  try {
    qjs = await getQuickJS();
    console.log('[VibeMonkey Offscreen] QuickJS initialized');
  } catch (e) {
    console.error('[VibeMonkey Offscreen] Failed to initialize QuickJS:', e);
  }
}

init();

browser.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  if (message.type === 'EXECUTE_IN_SANDBOX') {
    handleExecution(message.payload).then(sendResponse);
    return true; // Async response
  }
});

async function handleExecution(payload: { code: string; context?: any }) {
  if (!qjs) await init();
  if (!qjs) return { success: false, error: 'QuickJS not initialized' };

  return executeSafe(payload);
}

function executeSafe(payload: { code: string; context?: any }) {
    if (!qjs) throw new Error("QuickJS not initialized");
    
    const vm = qjs.newContext();
    const logs: string[] = [];
    const sideEffects: any[] = [];

    try {
        // Mock console
        const consoleHandle = vm.newObject();
        const logHandle = vm.newFunction("log", (...args) => {
             const text = args.map(arg => vm.dump(arg)).join(" ");
             logs.push(text);
        });
        vm.setProp(consoleHandle, "log", logHandle);
        vm.setProp(vm.global, "console", consoleHandle);
        logHandle.dispose();
        consoleHandle.dispose();

        // Mock document and basic DOM API for Shadow Execution
        const documentHandle = vm.newObject();
        
        // Mock querySelector
        const querySelectorHandle = vm.newFunction("querySelector", (selectorHandle) => {
            const selector = vm.getString(selectorHandle);
            
            // Return a mock element that traps actions
            const elementHandle = vm.newObject();
            
            // Mock .remove()
            const removeHandle = vm.newFunction("remove", () => {
                sideEffects.push({ type: 'remove', selector });
            });
            vm.setProp(elementHandle, "remove", removeHandle);
            removeHandle.dispose();
            
            // Mock .click()
            const clickHandle = vm.newFunction("click", () => {
                sideEffects.push({ type: 'click', selector });
            });
            vm.setProp(elementHandle, "click", clickHandle);
            clickHandle.dispose();

            // Mock .style
            const styleHandle = vm.newObject();
            vm.setProp(elementHandle, "style", styleHandle);
            styleHandle.dispose();

            return elementHandle;
        });
        
        vm.setProp(documentHandle, "querySelector", querySelectorHandle);
        querySelectorHandle.dispose();

        // Mock querySelectorAll (simplified: returns array of one mock element)
        const querySelectorAllHandle = vm.newFunction("querySelectorAll", (selectorHandle) => {
             const selector = vm.getString(selectorHandle);
             const arrayHandle = vm.newArray();
             
             // Create one mock element
             const elementHandle = vm.newObject();
             const removeHandle = vm.newFunction("remove", () => {
                sideEffects.push({ type: 'remove', selector });
             });
             vm.setProp(elementHandle, "remove", removeHandle);
             removeHandle.dispose();
             
             vm.setProp(arrayHandle, 0, elementHandle);
             elementHandle.dispose();
             
             return arrayHandle;
        });
        vm.setProp(documentHandle, "querySelectorAll", querySelectorAllHandle);
        querySelectorAllHandle.dispose();
        
        vm.setProp(vm.global, "document", documentHandle);
        documentHandle.dispose();

        // Mock window
        vm.setProp(vm.global, "window", vm.global);

        // Execute user code
        const result = vm.evalCode(payload.code);
        
        if (result.error) {
            const error = vm.dump(result.error);
            result.error.dispose();
            return { success: false, error: String(error), logs, sideEffects };
        }
        
        const value = vm.dump(result.value);
        result.value.dispose();
        
        return { success: true, result: value, logs, sideEffects };

    } catch (e) {
        return { success: false, error: String(e), logs, sideEffects };
    } finally {
        vm.dispose();
    }
}
