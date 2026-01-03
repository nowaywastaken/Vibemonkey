// ==========================================
// 🧠 AI 规划器 V3 -Snapshot & GoalStack
// ==========================================
// 核心改进：基于 Accessibility Tree 的认知模型
// 引入 Goal Stack 保持长期意图

const PLANNER_CONFIG = {
    maxIterations: 30,
    maxTokensPerCall: 2000,
    temperature: 0.2
};

// 当前正在处理的 tabId（用于发送思考消息）
let currentTargetTabId = null;

/**
 * 定义 Tool Calling 使用的工具集合 (V6 Tool-Aware)
 */
const BROWSER_TOOLS = [
    {
        name: "click",
        description: "Click on an element on the page using its 'ai-id'.",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "The 'ai-id' of the element from the accessibility tree snapshot." },
                description: { type: "string", description: "A short, user-friendly description of what you are clicking." }
            },
            required: ["target", "description"]
        }
    },
    {
        name: "fill",
        description: "Type text into an input field or textarea. Use 'visual_index' or 'visual_label' from the tree to identify the correct field if multiple similar fields exist.",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "The 'ai-id' of the input element." },
                value: { type: "string", description: "The text to type. Use an empty string '' to clear the field." },
                description: { type: "string", description: "A short, user-friendly description. e.g., 'Fill the [Username] field (index 1)'." }
            },
            required: ["target", "value", "description"]
        }
    },
    {
        name: "navigate",
        description: "Navigate to a specific URL.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "The full URL to navigate to (e.g., https://www.google.com)." },
                description: { type: "string", description: "A short, user-friendly description of why you are navigating." }
            },
            required: ["url", "description"]
        }
    },
    {
        name: "wait",
        description: "Wait for a specified duration to allow for page stability or results to appear.",
        parameters: {
            type: "object",
            properties: {
                ms: { type: "integer", description: "Milliseconds to wait. Default is 2000.", default: 2000 },
                description: { type: "string", description: "A short, user-friendly description of why you are waiting." }
            },
            required: ["description"]
        }
    },
    {
        name: "scroll",
        description: "Scroll the page or a specific element.",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "The 'ai-id' of the element to scroll, or 'window' for the main viewport.", default: "window" },
                description: { type: "string", description: "A short, user-friendly description of the scroll action." }
            }
        }
    },
    {
        name: "select",
        description: "Select an option from a dropdown menu.",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "The 'ai-id' of the select element." },
                value: { type: "string", description: "The value of the option to select." },
                description: { type: "string", description: "A short, user-friendly description." }
            },
            required: ["target", "value", "description"]
        }
    },
    {
        name: "complete_task",
        description: "Call this tool when the user's goal has been fully satisfied and verified.",
        parameters: {
            type: "object",
            properties: {
                reason: { type: "string", description: "Briefly explain how the goal was achieved." }
            },
            required: ["reason"]
        }
    }
];

/**
 * 构建迭代规划 Prompt (V6 Tool Calling Aware)
 */
function buildIterativePlannerPrompt(userGoal, domTree, actionHistory = [], memory = {}, goalStack = [], milestones = [], isStuck = false) {
    const historyText = actionHistory.length > 0 
        ? actionHistory.map((h, i) => {
            let line = `step ${i + 1}: ${h.description} -> ${h.success ? '✅OK' : '❌Fail'}`;
            if (h.stateChange) line += ` [${h.stateChange}]`;
            if (h.action === 'SYSTEM_LOOP_DETECTED') line = `step ${i + 1}: ⚠️ SYSTEM: Loop detected. Try a different approach.`;
            return line;
        }).join('\n')
        : '(No actions yet)';

    const currentGoal = goalStack.length > 0 ? goalStack[goalStack.length - 1] : userGoal;
    const goalContext = goalStack.length > 0 
        ? `Goal Stack:\n${goalStack.map((g,i) => `${i+1}. ${g}`).join('\n')}\nCurrent Focus: "${currentGoal}"`
        : `Main Goal: "${userGoal}"`;
    
    // 🎯 V5: Milestones
    const milestonesText = milestones.length > 0
        ? milestones.map(m => `✅ ${m.label} (step ${m.stepIdx})`).join('\n')
        : '(No milestones yet)';

    return `# Browser Automation Agent (V6 Tool Calling)

## User Goal
"${userGoal}"

## Completed Milestones
${milestonesText}

## Cognitive State
${goalContext}

## Page Snapshot (Accessibility Tree)
Pseudo-HTML representation of the current page structure.
Interactive elements have 'ai-id'. USE THIS ID AS 'target' IN TOOLS.
<snapshot>
${domTree}
</snapshot>

## Action History
${historyText}

## ⚠️ Critical Rules
1. **If you see [PAGE_SAME]**: Your action did NOT change the page. Try a different target or approach.
2. **If you see SYSTEM_LOOP_DETECTED**: You are in a loop. You MUST choose a completely different strategy.
3. **If you see [PAGE_CHANGED]**: Your action worked. Proceed with the next step.
4. **Tool Management**:
   - If you want to **CLEAR** an input field, use the \`fill\` tool with an empty string \`value: ""\`.
   - You **MUST** end every response with a valid tool call.
   - Do NOT stop mid-sentence or after a colon. Always provide the final tool call.
5. **Goal Progress**:
   - If you have completed the user's intent, call \`complete_task\`.

${isStuck ? '## ⚠️ ACTION REQUIRED\nYou previously identified an intent but failed to provide a tool call. Please provide the tool call now to proceed.' : ''}

## 🎯 Semantic & Positional Matching
When filling forms or selecting inputs:
1. **READ the 'visual_label' and 'index' attributes** - This shows the label and the order of the field.
2. **CHECK 'container' and 'visual_status' attributes** - For example, fields in a 'decoy-container' might be intentional traps.
3. **MATCH keywords** from your goal to the 'visual_label'. Use 'index' to disambiguate identical labels (e.g., the first 'Username' field).
4. **Use 'placeholder' attribute** as secondary hint if no visual_label matches.

## 🛑 FORM INTEGRITY & VERIFICATION 🛑
- **MANDATORY**: Before clicking any action button (Submit, Login, etc.), check the value of all fields you filled to ensure they haven't been wiped or misfilled.
- **NEVER** call complete_task immediately after a clicking an action button.
- You **MUST** wait or inspect the result in the next step to verify the action effect.
- complete_task means the USER'S INTENT is fully satisfied and verified.
`;
}

/**
 * 调用 AI 进行迭代规划 (流式模式)
 */
async function callIterativePlannerAI(prompt, screenshot, config) {
    const { apiKey, providerUrl, modelName } = config;
    
    if (!apiKey) throw new Error('API Key 未配置');
    
    const endpoint = providerUrl || 'https://openrouter.ai/api/v1/chat/completions';
    
    const messages = [
        { role: 'system', content: 'You are a precise browser automation agent. Analyze the Accessibility Tree and move step-by-step.' }
    ];
    
    if (screenshot) {
        messages.push({
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: screenshot, detail: 'low' } }
            ]
        });
    } else {
        messages.push({ role: 'user', content: prompt });
    }
    
    // ... (Use same fetch logic as before, just cleaner) ...
    // Reuse the fetch logic from previous version or rewrite simply
    
    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName || 'google/gemini-2.0-flash-001',
                messages,
                tools: BROWSER_TOOLS.map(t => ({ type: "function", function: t })),
                tool_choice: "auto",
                stream: true,
                max_tokens: PLANNER_CONFIG.maxTokensPerCall,
                temperature: PLANNER_CONFIG.temperature
            })
        });

        if (!response.ok) {
             const errData = await response.json().catch(() => ({}));
             const errMsg = errData.error?.message || `HTTP ${response.status}`;
             
             // 🛡️ 核心修复：如果模型不支持图片输入，回退到纯文本模式
             if (screenshot && (errMsg.includes('image input') || errMsg.includes('multimodal') || errMsg.includes('vision') || errMsg.includes('visual'))) {
                 console.warn(`⚠️ 模型 ${modelName} 不支持视觉输入或截图分析失败，正在回退到纯文本模式进行规划...`);
                 return callIterativePlannerAI(prompt, null, config);
             }
             
             throw new Error(errMsg);
        }
    } catch (e) {
        if (screenshot && (e.message.includes('image input') || e.message.includes('multimodal') || e.message.includes('vision') || e.message.includes('visual'))) {
            return callIterativePlannerAI(prompt, null, config);
        }
        throw e;
    }

    // Stream reading logic (V6: Tool Call Aware)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let toolCallsBuffer = []; // To accumulate delta fragments
    let buffer = '';
    
    broadcastThinkingUpdate('');
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (value) buffer += decoder.decode(value, { stream: true });
            
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                if (!data) continue;
                try {
                    const json = JSON.parse(data);
                    const delta = json.choices?.[0]?.delta || {};
                    
                    // 1. Text content (Thinking)
                    if (delta.content) {
                        fullContent += delta.content;
                        broadcastThinkingUpdate(delta.content);
                    }
                    
                    // 2. Tool calls (Action)
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index || 0;
                            if (!toolCallsBuffer[idx]) {
                                toolCallsBuffer[idx] = { id: tc.id, function: { name: '', arguments: '' } };
                            }
                            if (tc.id) toolCallsBuffer[idx].id = tc.id;
                            if (tc.function) {
                                if (tc.function.name) toolCallsBuffer[idx].function.name += tc.function.name;
                                if (tc.function.arguments) toolCallsBuffer[idx].function.arguments += tc.function.arguments;
                            }
                        }
                    }
                } catch (e) {}
            }
            if (done) break;
        }
    } finally {
        reader.releaseLock();
    }
    
    // Append accumulated tool calls as a structured JSON at the end for parseIterativeResponse to find
    if (toolCallsBuffer.length > 0) {
        fullContent += '\n\n' + JSON.stringify({ tool_calls: toolCallsBuffer.filter(t => t) });
    }
    
    broadcastThinkingDone();
    return fullContent;
}

/**
 * 广播思考状态 (保持不变)
 */
function broadcastThinkingUpdate(content) {
    if (!currentTargetTabId) return;
    chrome.tabs.sendMessage(currentTargetTabId, { type: 'AI_THINKING_UPDATE', content }).catch(() => {});
}

function broadcastThinkingDone() {
    if (!currentTargetTabId) return;
    chrome.tabs.sendMessage(currentTargetTabId, { type: 'AI_THINKING_DONE' }).catch(() => {});
}

/**
 * 解析响应 (V6 Tool Calling)
 */
function parseIterativeResponse(response) {
    // In stream mode, thinking is pure text, tool calls are delivered via deltas.
    // However, since we are using a simplified full-content return from callIterativePlannerAI,
    // we need to detect if tool calls are embedded or if the response IS a tool call.
    
    let thinking = response;
    let toolCall = null;

    try {
        // 1. Check for standard JSON tool_calls or function objects
        const jsonMatch = response.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/) || response.match(/\{[\s\S]*"name"[\s\S]*"arguments"[\s\S]*\}/);
        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            const nextActionRaw = data.tool_calls?.[0]?.function || data;
            
            if (nextActionRaw && nextActionRaw.name) {
                const args = typeof nextActionRaw.arguments === 'string' ? JSON.parse(nextActionRaw.arguments) : nextActionRaw.arguments;
                toolCall = { name: nextActionRaw.name, arguments: args };
                thinking = response.replace(jsonMatch[0], '').trim();
            }
        }

        // 2. Check for XML-style <function_calls> (Common in some OpenRouter/Anthropic/Gemini outputs)
        if (!toolCall) {
            const xmlMatch = response.match(/<function_calls>[\s\S]*?<invoke name="([\w_]+)">([\s\S]*?)<\/invoke>[\s\S]*?<\/function_calls>/);
            if (xmlMatch) {
                const name = xmlMatch[1];
                const paramsRaw = xmlMatch[2];
                const args = {};
                
                // Parse <parameter name="foo">bar</parameter>
                const paramRegex = /<parameter name="([\w_]+)"[^>]*>([\s\S]*?)<\/parameter>/g;
                let m;
                while ((m = paramRegex.exec(paramsRaw)) !== null) {
                    args[m[1]] = m[2].trim();
                }
                
                toolCall = { name, arguments: args };
                thinking = response.replace(xmlMatch[0], '').trim();
            }
        }
    } catch (e) {
        // Not a recognizable format
    }

    if (toolCall) {
        return {
            thinking: thinking || `Executing ${toolCall.name}`,
            goalCompleted: toolCall.name === 'complete_task',
            updatedGoalStack: [], // Tool calling might not explicitly return state unless we add it
            nextAction: toolCall.name === 'complete_task' ? null : {
                action: toolCall.name,
                target: toolCall.arguments.target || toolCall.arguments.url,
                value: toolCall.arguments.value || toolCall.arguments.ms,
                description: toolCall.arguments.description || toolCall.arguments.reason
            },
            confidence: 0.9
        };
    }

    // Fallback: Check if AI wrote something that looks like an old-style JSON by accident
    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            if (result.nextAction || result.goalCompleted !== undefined) {
                return {
                    thinking: result.thinking || thinking,
                    goalCompleted: result.goalCompleted === true,
                    updatedGoalStack: result.updatedGoalStack || [],
                    nextAction: result.nextAction || null,
                    confidence: result.confidence || 0.5
                };
            }
        }
    } catch (e) {}

    return {
        thinking: response,
        goalCompleted: false,
        updatedGoalStack: [],
        nextAction: null,
        confidence: 0.5
    };
}

/**
 * 迭代规划主函数 - 规划下一步
 */
async function planNextStep(options) {
    const { userGoal, pageData, screenshot, actionHistory, memory, apiConfig, tabId, goalStack, previousPageHash } = options;
    
    currentTargetTabId = tabId || null;
    
    // 使用 domTree 而不是 summary
    const domTree = pageData.domTree || "No DOM data available";
    const currentHash = pageData.contentHash;
    const isStuck = options.isStuck || false;

    // 构建 prompt
    const prompt = buildIterativePlannerPrompt(userGoal, domTree, actionHistory, memory, goalStack, [], isStuck);
    
    // 调用 AI
    console.log(`🧠 V3 Planning (Goal: ${goalStack[goalStack.length-1] || userGoal})...`);
    const aiResponse = await callIterativePlannerAI(prompt, screenshot, apiConfig);
    
    // 解析
    const result = parseIterativeResponse(aiResponse);
    
    // 🛡️ System Supervisor: Completion Guard
    // 如果 AI 认为任务完成了，但页面状态没有变化（且上一步是动作），则强制驳回
    if (result.goalCompleted && actionHistory.length > 0) {
        const lastAction = actionHistory[actionHistory.length - 1];
        
        // 1. 状态改变检测
        const hasStateChanged = currentHash !== previousPageHash;
        
        // 2. 交互动作检测
        const isInteractiveAction = ['click', 'navigate', 'fill', 'submit'].includes(lastAction.action);

        if (isInteractiveAction && !hasStateChanged) {
            console.warn('🛡️ Completion Guard Triggered: Page state unchanged. Forcing WAIT.');
            return {
                goalCompleted: false,
                updatedGoalStack: goalStack,
                thinking: `[System] Action "${lastAction.action}" executed but page remains identical. Waiting once to allow for async UI updates before confirming.`,
                nextStep: {
                    id: actionHistory.length + 1,
                    action: 'wait',
                    target: null,
                    value: '2000',
                    description: 'System: Waiting for page update...'
                },
                confidence: 0.9
            };
        }
        
        // 3. 🆕 关键字段完整性检测 (针对表单)
        const snapshotStr = domTree.toLowerCase();
        const hasErrorStyling = snapshotStr.includes('error-red-border') || snapshotStr.includes('invalid');
        if (hasErrorStyling && !userGoal.toLowerCase().includes('error')) {
            return {
                goalCompleted: false,
                updatedGoalStack: goalStack,
                thinking: `[System] Target page contains error styles or invalid indicators. The task may not be truly successful. Re-verifying...`,
                nextStep: {
                    id: actionHistory.length + 1,
                    action: 'wait',
                    target: null,
                    value: '1000',
                    description: 'System: Checking error states...'
                },
                confidence: 0.8
            };
        }
    }
    
    return {
        goalCompleted: result.goalCompleted,
        updatedGoalStack: (result.updatedGoalStack && result.updatedGoalStack.length > 0) ? result.updatedGoalStack : goalStack,
        thinking: result.thinking,
        nextStep: result.nextAction ? {
            id: actionHistory.length + 1,
            action: result.nextAction.action,
            target: result.nextAction.target, // This will be 'ai-id' or 'url'
            value: result.nextAction.value,
            description: result.nextAction.description
        } : null,
        confidence: result.confidence
    };
}

/**
 * 占位符替换 (保持不变)
 */
function resolveStepPlaceholders(step, userMemory) {
    const resolved = { ...step };
    if (resolved.value && typeof resolved.value === 'string') {
        resolved.value = resolved.value.replace(/\{\{memory\.(\w+)\}\}/g, (m, k) => userMemory[k] || m);
    }
    return resolved;
}

// 导出
if (typeof self !== 'undefined') {
    self.Planner = {
        planNextStep,
        resolveStepPlaceholders,
        PLANNER_CONFIG
    };
}
