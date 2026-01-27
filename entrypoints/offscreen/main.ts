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

        // Helper to create a trap-all mock element
        const createMockElement = (selector: string) => {
            const el = vm.newObject();
            
            // Methods
            const removeHandle = vm.newFunction("remove", () => {
                sideEffects.push({ type: 'remove', selector });
            });
            vm.setProp(el, "remove", removeHandle);
            removeHandle.dispose();
            
            const clickHandle = vm.newFunction("click", () => {
                sideEffects.push({ type: 'click', selector });
            });
            vm.setProp(el, "click", clickHandle);
            clickHandle.dispose();

            const addEventListenerHandle = vm.newFunction("addEventListener", (typeHandle) => {
                sideEffects.push({ type: 'addEventListener', selector, event: vm.getString(typeHandle) });
            });
            vm.setProp(el, "addEventListener", addEventListenerHandle);
            addEventListenerHandle.dispose();

            const setAttributeHandle = vm.newFunction("setAttribute", (nameHandle, valueHandle) => {
                sideEffects.push({ type: 'setAttribute', selector, name: vm.getString(nameHandle), value: vm.getString(valueHandle) });
            });
            vm.setProp(el, "setAttribute", setAttributeHandle);
            setAttributeHandle.dispose();

            // Properties (Mocking common ones as empty strings or objects)
            vm.setProp(el, "innerText", vm.newString(""));
            vm.setProp(el, "innerHTML", vm.newString(""));
            vm.setProp(el, "textContent", vm.newString(""));
            vm.setProp(el, "value", vm.newString(""));
            vm.setProp(el, "className", vm.newString(""));
            
            const styleHandle = vm.newObject();
            vm.setProp(el, "style", styleHandle);
            styleHandle.dispose();

            const classListHandle = vm.newObject();
            const addClassHandle = vm.newFunction("add", (cls) => {
                sideEffects.push({ type: 'classList_add', selector, class: vm.getString(cls) });
            });
            vm.setProp(classListHandle, "add", addClassHandle);
            addClassHandle.dispose();
            vm.setProp(el, "classList", classListHandle);
            classListHandle.dispose();

            return el;
        };

        // Mock document and basic DOM API for Shadow Execution
        const documentHandle = vm.newObject();
        
        // Mock querySelector
        const querySelectorHandle = vm.newFunction("querySelector", (selectorHandle) => {
            const selector = vm.getString(selectorHandle);
            return createMockElement(selector);
        });
        
        vm.setProp(documentHandle, "querySelector", querySelectorHandle);
        querySelectorHandle.dispose();

        // Mock querySelectorAll
        const querySelectorAllHandle = vm.newFunction("querySelectorAll", (selectorHandle) => {
             const selector = vm.getString(selectorHandle);
             const arrayHandle = vm.newArray();
             const el = createMockElement(selector);
             vm.setProp(arrayHandle, 0, el);
             el.dispose();
             return arrayHandle;
        });
        vm.setProp(documentHandle, "querySelectorAll", querySelectorAllHandle);
        querySelectorAllHandle.dispose();

        // Mock createElement
        const createElementHandle = vm.newFunction("createElement", (tagHandle) => {
            const tag = vm.getString(tagHandle);
            return createMockElement(`<${tag}>`);
        });
        vm.setProp(documentHandle, "createElement", createElementHandle);
        createElementHandle.dispose();

        // Mock body
        const bodyHandle = createMockElement("body");
        vm.setProp(documentHandle, "body", bodyHandle);
        bodyHandle.dispose();

        // Mock addEventListener
        const addEventListenerHandle = vm.newFunction("addEventListener", (typeHandle, listenerHandle) => {
            const type = vm.getString(typeHandle);
            sideEffects.push({ type: 'addEventListener', event: type });
        });
        vm.setProp(vm.global, "addEventListener", addEventListenerHandle);
        vm.setProp(documentHandle, "addEventListener", addEventListenerHandle);
        addEventListenerHandle.dispose();

        // Mock GM_addStyle
        const gmAddStyleHandle = vm.newFunction("GM_addStyle", (cssHandle) => {
            const css = vm.getString(cssHandle);
            sideEffects.push({ type: 'addStyle', css: css.slice(0, 100) });
        });
        vm.setProp(vm.global, "GM_addStyle", gmAddStyleHandle);
        gmAddStyleHandle.dispose();

        // Mock localStorage
        const storageHandle = vm.newObject();
        const setItemHandle = vm.newFunction("setItem", (keyHandle, valueHandle) => {
             sideEffects.push({ type: 'storage_set', key: vm.getString(keyHandle) });
        });
        vm.setProp(storageHandle, "setItem", setItemHandle);
        setItemHandle.dispose();
        vm.setProp(vm.global, "localStorage", storageHandle);
        storageHandle.dispose();

        // Mock fetch
        const fetchHandle = vm.newFunction("fetch", (urlHandle) => {
            const url = vm.getString(urlHandle);
            sideEffects.push({ type: 'fetch', url });
            return vm.newPromise().handle; // Simplified promise
        });
        vm.setProp(vm.global, "fetch", fetchHandle);
        fetchHandle.dispose();
        
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
