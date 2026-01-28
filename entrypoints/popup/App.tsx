import React, { useEffect, useState, useRef } from 'react';
import { browser } from 'wxt/browser';
import { Settings, Send, Copy, Check, ChevronDown, ChevronUp, Power, Bot, Activity } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

// Helper for Tailwind classes
function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// Types
interface ScriptInfo {
  id: string;
  name: string;
  matchPattern: string;
  description: string;
}

interface OtherDomainScript {
  id: string;
  name: string;
  domain: string;
  matchPattern: string;
}

interface ScriptListResponse {
  success: boolean;
  domain: string;
  activeScripts: ScriptInfo[];
  inactiveScripts: ScriptInfo[];
  otherDomainScripts: OtherDomainScript[];
}

type AgentStatus = 'idle' | 'thinking' | 'writing' | 'tool_calling' | 'error';

export default function App() {
  // State
  const [currentUrl, setCurrentUrl] = useState('');
  const [currentDomain, setCurrentDomain] = useState('');
  const [activeScripts, setActiveScripts] = useState<ScriptInfo[]>([]);
  const [inactiveScripts, setInactiveScripts] = useState<ScriptInfo[]>([]);
  const [otherScripts, setOtherScripts] = useState<OtherDomainScript[]>([]);
  const [showOtherScripts, setShowOtherScripts] = useState(false);

  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [agentMessage, setAgentMessage] = useState('');

  const [userRequest, setUserRequest] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedScript, setGeneratedScript] = useState('');
  const [auditScore, setAuditScore] = useState<number | null>(null);
  const [generationError, setGenerationError] = useState('');

  const [showSettings, setShowSettings] = useState(false);
  const [apiKeys, setApiKeys] = useState({ openrouter: '', mem0: '' });

  const [interaction, setInteraction] = useState<{
    id: string;
    type: 'CONFIRMATION' | 'INPUT';
    question?: string;
    prompt?: string;
    choices?: string[];
    placeholder?: string;
  } | null>(null);

  const scriptOutputRef = useRef<HTMLPreElement>(null);
  const portRef = useRef<any>(null);

  // Initialize
  useEffect(() => {
    init();
    return () => {
      if (portRef.current) {
        portRef.current.disconnect();
      }
    };
  }, []);

  // Auto-scroll script output
  useEffect(() => {
    if (scriptOutputRef.current) {
      scriptOutputRef.current.scrollTop = scriptOutputRef.current.scrollHeight;
    }
  }, [generatedScript]);

  async function init() {
    await updateCurrentTab();
    await checkApiStatus();
    await loadScriptList();
    connectPort();
    await recoverAgentStatus();
  }

  async function updateCurrentTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      setCurrentUrl(tab.url);
      try {
        const urlObj = new URL(tab.url);
        setCurrentDomain(urlObj.hostname);
      } catch {
        setCurrentDomain('-');
      }
    }
  }

  async function checkApiStatus() {
    try {
      const response = await browser.runtime.sendMessage({ type: 'GET_STATUS' });
      if (response?.apiConfigured) {
        setAgentStatus('idle');
        setStatusMessage('Connected');
      } else {
        setAgentStatus('error');
        setStatusMessage('Configure API Key');
      }
    } catch (e) {
      setAgentStatus('error');
      setStatusMessage('Connection Failed');
    }
  }

  async function loadScriptList() {
    if (!currentUrl) {
      // Retry if url is not yet ready (happens on fast init)
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const url = tab.url;
        setCurrentUrl(url);
        const urlObj = new URL(url);
        setCurrentDomain(urlObj.hostname);
        // Proceed with local url variable
        try {
          const response: ScriptListResponse = await browser.runtime.sendMessage({
            type: 'GET_SCRIPT_LIST',
            payload: { url },
          });

          if (response?.success) {
            setActiveScripts(response.activeScripts);
            setInactiveScripts(response.inactiveScripts);
            setOtherScripts(response.otherDomainScripts);
          }
        } catch (e) {
          console.error('Failed to load scripts', e);
        }
        return;
      }
      return;
    }

    try {
      const response: ScriptListResponse = await browser.runtime.sendMessage({
        type: 'GET_SCRIPT_LIST',
        payload: { url: currentUrl },
      });

      if (response?.success) {
        setActiveScripts(response.activeScripts);
        setInactiveScripts(response.inactiveScripts);
        setOtherScripts(response.otherDomainScripts);
      }
    } catch (e) {
      console.error('Failed to load scripts', e);
    }
  }

  function connectPort() {
    try {
      const port = browser.runtime.connect({ name: 'vibemonkey-stream' });
      portRef.current = port;

      port.onMessage.addListener((message: any) => {
        switch (message.type) {
          case 'AGENT_STATUS_UPDATE':
            setAgentStatus(message.payload.status);
            setStatusMessage(getStatusLabel(message.payload.status));
            if (message.payload.message) {
              setAgentMessage(message.payload.message);
            }
            break;

          case 'SCRIPT_GENERATION_START':
            setIsGenerating(true);
            setGeneratedScript('');
            setAuditScore(null);
            setGenerationError('');
            break;

          case 'SCRIPT_GENERATION_CHUNK':
            setGeneratedScript(prev => prev + message.payload);
            break;

          case 'SCRIPT_GENERATION_COMPLETE':
            setIsGenerating(false);
            const { success, script, auditScore, error } = message.payload;
            if (success) {
              setGeneratedScript(script);
              setAuditScore(auditScore);
              loadScriptList();
            } else {
              setGenerationError(error || 'Generation failed');
              setAgentMessage(error || 'Generation failed');
            }
            break;

          case 'SCRIPT_GENERATION_ERROR':
            setIsGenerating(false);
            setGenerationError(message.payload || 'Unknown error');
            setAgentMessage(message.payload || 'Generation failed');
            break;

          case 'REQUEST_USER_INTERACTION':
            setInteraction(message.payload);
            break;

          case 'INTERACTION_RESOLVED':
            setInteraction(null);
            break;
        }
      });

      port.onDisconnect.addListener(() => {
        console.log('Port disconnected');
        setTimeout(connectPort, 1000);
      });
    } catch (e) {
      console.error("Connect port failed", e);
    }
  }

  async function recoverAgentStatus() {
    try {
      const result = await browser.storage.local.get('vibemonkey_agent_status');
      const state = result.vibemonkey_agent_status as { status: AgentStatus; message: string } | undefined;
      if (state && state.status) {
        setAgentStatus(state.status);
        setStatusMessage(getStatusLabel(state.status));
        if (state.message) {
          setAgentMessage(state.message);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  function getStatusLabel(status: AgentStatus): string {
    switch (status) {
      case 'idle': return 'Idle';
      case 'thinking': return 'Thinking...';
      case 'writing': return 'Writing Code...';
      case 'tool_calling': return 'Using Tools...';
      case 'error': return 'Error';
      default: return 'Unknown';
    }
  }

  async function handleSend() {
    if (!userRequest.trim()) return;

    // Rejected patterns check
    const rejectedPatterns = [/summarize/i, /summary/i, /总结/, /摘要/];
    if (rejectedPatterns.some(p => p.test(userRequest))) {
      setAgentMessage("I focus on script automation, not content summarization.");
      return;
    }

    setIsGenerating(true);
    setGeneratedScript('');
    setAgentMessage('Starting...');

    try {
      // Get page info from content script
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      let pageInfo;
      if (tab?.id) {
        try {
          const pageResponse = await browser.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
          if (pageResponse?.success) {
            pageInfo = pageResponse.info;
          }
        } catch {
          // Content script might not be ready
        }
      }

      if (portRef.current) {
        portRef.current.postMessage({
          type: 'GENERATE_SCRIPT_STREAM',
          payload: {
            userRequest,
            currentUrl,
            pageInfo: pageInfo ? {
              title: pageInfo.title,
              domain: currentDomain,
              markdown: pageInfo.markdown,
            } : undefined,
          },
        });
        setUserRequest('');
      } else {
        setAgentMessage("Connection lost. Retrying...");
        connectPort();
      }
    } catch (e) {
      setIsGenerating(false);
      setAgentMessage("Failed to send request.");
    }
  }

  async function toggleScript(scriptId: string, enabled: boolean) {
    try {
      await browser.runtime.sendMessage({
        type: 'TOGGLE_SCRIPT',
        payload: { scriptId, enabled },
      });
      loadScriptList();
    } catch (e) {
      console.error(e);
    }
  }

  async function loadSettings() {
    const res = await browser.storage.local.get(['openrouter_api_key', 'mem0_api_key']);
    setApiKeys({
      openrouter: res.openrouter_api_key as string || '',
      mem0: res.mem0_api_key as string || '',
    });
  }

  async function saveSettings() {
    await browser.runtime.sendMessage({
      type: 'SAVE_API_KEY',
      payload: {
        openrouter: apiKeys.openrouter || undefined,
        mem0: apiKeys.mem0 || undefined,
      },
    });
    setShowSettings(false);
    checkApiStatus();
  }

  function handleInteractionResponse(result: any) {
    if (portRef.current && interaction) {
      portRef.current.postMessage({
        type: 'USER_INTERACTION_RESPONSE',
        payload: { interactionId: interaction.id, result }
      });
      setInteraction(null);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      // Visual feedback could be added here
    } catch (e) {
      console.error(e);
    }
  }

  // --- Render Components ---

  const ScriptItem = ({ script, active }: { script: ScriptInfo; active: boolean }) => (
    <div className={cn("flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-sm mb-2", !active && "opacity-75 bg-slate-50")}>
      <div className="flex items-center gap-3 overflow-hidden">
        <div className={cn("w-2 h-2 rounded-full flex-shrink-0", active ? "bg-green-500" : "bg-slate-400")} />
        <div className="flex flex-col min-w-0">
          <span className="font-medium text-sm truncate text-slate-900" title={script.name}>{script.name}</span>
          <span className="text-xs text-slate-500 truncate" title={script.matchPattern}>{script.matchPattern}</span>
        </div>
      </div>
      <label className="relative inline-flex items-center cursor-pointer ml-2">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={active}
          onChange={(e) => toggleScript(script.id, e.target.checked)}
        />
        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
      </label>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shadow-sm z-10">
        <div className="flex items-center gap-2">
          <img src="/icon/48.png" alt="Logo" className="w-8 h-8" />
          <h1 className="font-bold text-lg text-slate-800">VibeMonkey</h1>
        </div>
        <button
          onClick={() => { setShowSettings(true); loadSettings(); }}
          className="p-2 text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        >
          <Settings size={20} />
        </button>
      </header>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-100 text-xs">
        <div className="flex items-center gap-2">
          <span className={cn(
            "w-2 h-2 rounded-full animate-pulse",
            agentStatus === 'idle' ? "bg-green-500" :
              agentStatus === 'error' ? "bg-red-500" : "bg-blue-500"
          )} />
          <span className="font-medium text-slate-700">{statusMessage}</span>
        </div>
        <span className="text-slate-500 max-w-[150px] truncate" title={currentDomain}>{currentDomain}</span>
      </div>

      {/* Main Content (Scrollable) */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Agent Message */}
        {(agentMessage || generationError) && (
          <div className={cn("flex items-start gap-3 p-3 rounded-lg text-sm", generationError ? "bg-red-50 text-red-700 border border-red-100" : "bg-indigo-50 text-indigo-700 border border-indigo-100")}>
            <Bot size={18} className="mt-0.5 flex-shrink-0" />
            <p>{generationError || agentMessage}</p>
          </div>
        )}

        {/* Script Lists */}
        <div>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Active Scripts</h2>
          {activeScripts.length > 0 ? (
            activeScripts.map(s => <ScriptItem key={s.id} script={s} active={true} />)
          ) : (
            <p className="text-sm text-slate-400 italic px-2">No active scripts</p>
          )}
        </div>

        {inactiveScripts.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Inactive Scripts</h2>
            {inactiveScripts.map(s => <ScriptItem key={s.id} script={s} active={false} />)}
          </div>
        )}

        {otherScripts.length > 0 && (
          <div className="border-t border-slate-200 pt-2">
            <button
              onClick={() => setShowOtherScripts(!showOtherScripts)}
              className="flex items-center justify-between w-full py-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
            >
              <span>Other Scripts ({otherScripts.length})</span>
              {showOtherScripts ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showOtherScripts && (
              <div className="mt-2 space-y-2">
                {otherScripts.map(s => (
                  <div key={s.id} className="p-2 bg-white border border-slate-100 rounded text-xs">
                    <div className="font-medium text-slate-700">{s.name}</div>
                    <div className="text-slate-400">{s.domain}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Generated Result */}
        {(generatedScript || isGenerating) && (
          <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
              <span className="text-xs font-medium text-slate-600 flex items-center gap-1">
                {isGenerating ? <Activity size={12} className="animate-spin" /> : <Check size={12} />}
                Generated Script
              </span>
              <div className="flex items-center gap-2">
                {auditScore !== null && (
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded font-medium",
                    auditScore >= 80 ? "bg-green-100 text-green-700" :
                      auditScore >= 60 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
                  )}>
                    Score: {auditScore}
                  </span>
                )}
                <button
                  onClick={() => copyToClipboard(generatedScript)}
                  className="p-1 hover:bg-slate-200 rounded text-slate-500"
                  title="Copy"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
            <pre
              ref={scriptOutputRef}
              className="p-3 text-xs font-mono bg-slate-900 text-slate-300 overflow-x-auto max-h-60 whitespace-pre-wrap"
            >
              {generatedScript}
            </pre>
          </div>
        )}

      </main>

      {/* Chat Input */}
      <div className="p-4 bg-white border-t border-slate-200 shadow-lg z-10">
        <div className="relative">
          <textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="How should I change this page?"
            className="w-full p-3 pr-12 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none h-20 shadow-inner"
          />
          <button
            onClick={handleSend}
            disabled={!userRequest.trim() || isGenerating}
            className="absolute right-2 bottom-2 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">×</button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">OpenRouter API Key</label>
                <input
                  type="password"
                  value={apiKeys.openrouter}
                  onChange={e => setApiKeys({ ...apiKeys, openrouter: e.target.value })}
                  className="w-full p-2 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  placeholder="sk-or-..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mem0 API Key (Optional)</label>
                <input
                  type="password"
                  value={apiKeys.mem0}
                  onChange={e => setApiKeys({ ...apiKeys, mem0: e.target.value })}
                  className="w-full p-2 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  placeholder="mem0-..."
                />
              </div>
            </div>
            <div className="px-4 py-3 bg-slate-50 flex justify-end">
              <button
                onClick={saveSettings}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interaction Modal */}
      {interaction && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-4 text-center">
            <h3 className="font-semibold text-lg text-slate-800 mb-2">
              {interaction.type === 'CONFIRMATION' ? 'Confirmation' : 'Input Required'}
            </h3>
            <p className="text-sm text-slate-600 mb-4">{interaction.question || interaction.prompt}</p>

            {interaction.type === 'INPUT' ? (
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  id="interaction-input-field"
                  placeholder={interaction.placeholder}
                  className="w-full p-2 text-sm border border-slate-300 rounded"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleInteractionResponse((e.target as HTMLInputElement).value);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    const val = (document.getElementById('interaction-input-field') as HTMLInputElement).value;
                    handleInteractionResponse(val);
                  }}
                  className="w-full py-2 bg-indigo-600 text-white rounded text-sm font-medium"
                >
                  Submit
                </button>
              </div>
            ) : (
              <div className="flex gap-2 justify-center">
                {(interaction.choices || ['Yes', 'No']).map(choice => (
                  <button
                    key={choice}
                    onClick={() => handleInteractionResponse(choice)}
                    className={cn(
                      "px-4 py-2 rounded text-sm font-medium min-w-[80px]",
                      choice === 'Cancel' || choice === 'No'
                        ? "bg-slate-200 text-slate-700 hover:bg-slate-300"
                        : "bg-indigo-600 text-white hover:bg-indigo-700"
                    )}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
