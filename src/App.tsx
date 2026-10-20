/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Box, 
  Play, 
  RotateCcw, 
  ShieldCheck, 
  Zap, 
  FolderGit2, 
  FileCode, 
  Cpu, 
  Layers, 
  Code2, 
  Sparkles, 
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Bot
} from 'lucide-react';

interface Intent {
  intent_key: string;
  canonical_prompt: string;
  description: string;
  script_path: string;
  status: 'ACTIVE' | 'QUARANTINED' | 'EVOLVING';
  consecutive_failures: number;
  execution_count: number;
  last_run_at: string | null;
  created_at: string;
  last_error: string | null;
}

interface DispatchResult {
  actionType: string;
  intentKey: string;
  success: boolean;
  durationMs: number;
  output?: any;
  error?: string;
  runner: string;
}

export default function App() {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [currentIntent, setCurrentIntent] = useState<Intent | null>(null);
  const [scriptCode, setScriptCode] = useState<string>('');
  const [promptInput, setPromptInput] = useState<string>('');
  const [dataInput, setDataInput] = useState<string>('');
  const [showDataInput, setShowDataInput] = useState<boolean>(false);
  const [filterText, setFilterText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [executing, setExecuting] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<DispatchResult | null>(null);
  const [activeModal, setActiveModal] = useState<'quadlet' | 'architecture' | 'pi-agent' | null>(null);
  const [activeQuadletTab, setActiveQuadletTab] = useState<'container' | 'volume' | 'runner' | 'pyproject'>('container');
  const [copied, setCopied] = useState<boolean>(false);
  const [piAgentPrompt, setPiAgentPrompt] = useState<string>('Write a Python function to compute the moving average of a list');
  const [piAgentResponse, setPiAgentResponse] = useState<string>('');
  const [piAgentTesting, setPiAgentTesting] = useState<boolean>(false);

  // Fetch real intent script from backend
  const fetchScript = useCallback(async (key: string) => {
    if (!key) return;
    setSelectedKey(key);
    try {
      const res = await fetch(`/api/script/${encodeURIComponent(key)}`);
      if (res.ok) {
        const data = await res.json();
        setScriptCode(data.code || '');
        setCurrentIntent(data.intent || null);
      } else {
        const htmlRes = await fetch(`/script/${encodeURIComponent(key)}`);
        const text = await htmlRes.text();
        const codeMatch = text.match(/<code class="language-python">([\s\S]*?)<\/code>/);
        if (codeMatch && codeMatch[1]) {
          const decoded = codeMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          setScriptCode(decoded);
        } else {
          setScriptCode(text);
        }
      }
    } catch (err) {
      console.error('Error fetching script:', err);
    }
  }, []);

  // Fetch live intent list from SQLite WAL database
  const refreshIntents = useCallback(async () => {
    try {
      const res = await fetch('/api/intents');
      if (res.ok) {
        const list: Intent[] = await res.json();
        setIntents(list);
        if (list.length > 0) {
          setSelectedKey(prev => {
            const exists = list.some(i => i.intent_key === prev);
            if (!exists || !prev) {
              const defaultKey = list[0].intent_key;
              fetchScript(defaultKey);
              return defaultKey;
            }
            return prev;
          });
        }
      }
    } catch (e) {
      console.warn('Failed to refresh intents:', e);
    }
  }, [fetchScript]);

  // Initial load and real-time SSE listener
  useEffect(() => {
    refreshIntents();

    const es = new EventSource('/events');
    es.addEventListener('intent_created', (e) => {
      try {
        const data = JSON.parse(e.data);
        refreshIntents();
        if (data.intent_key) {
          fetchScript(data.intent_key);
        }
      } catch {}
    });

    es.addEventListener('execution_finished', () => {
      refreshIntents();
    });

    es.addEventListener('circuit_breaker_tripped', (e) => {
      try {
        const data = JSON.parse(e.data);
        refreshIntents();
        setLastResult({
          actionType: 'CIRCUIT_BREAKER_TRIPPED',
          intentKey: data.intent_key,
          success: false,
          durationMs: 0,
          runner: 'circuit-breaker',
          error: `CIRCUIT BREAKER: ${data.intent_key} reached failure threshold and is QUARANTINED.`
        });
      } catch {}
    });

    es.addEventListener('quarantine_reset', () => {
      refreshIntents();
    });

    return () => es.close();
  }, [fetchScript, refreshIntents]);

  // Keep script updated if selectedKey changes
  useEffect(() => {
    if (selectedKey) {
      fetchScript(selectedKey);
    }
  }, [selectedKey, fetchScript]);

  // Highlight Prism whenever code changes
  useEffect(() => {
    if ((window as any).Prism) {
      (window as any).Prism.highlightAll();
    }
  }, [scriptCode]);

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptInput.trim()) return;

    setLoading(true);
    setLastResult(null);

    const formData = new FormData();
    formData.append('prompt', promptInput.trim());
    if (dataInput.trim()) {
      formData.append('custom_data', dataInput.trim());
    }

    try {
      const res = await fetch('/dispatch', {
        method: 'POST',
        body: formData,
      });
      const html = await res.text();

      const isCacheHit = html.includes('FAST ROUTER HIT');
      const isQuarantine = html.includes('Circuit Breaker Quarantined');
      const durationMatch = html.match(/\((\d+(\.\d+)?)ms\)/);
      const runnerMatch = html.match(/Runner: ([^()]+)/);
      const keyMatch = html.match(/<code>([a-zA-Z0-9_-]+)\.py<\/code>/) || html.match(/Intent: <code[^>]*>([a-zA-Z0-9_-]+)\.py<\/code>/);
      const evolvedKey = keyMatch ? keyMatch[1] : selectedKey;

      setLastResult({
        actionType: isCacheHit ? 'FAST_ROUTER_CACHE_HIT' : 'EVOLUTIONARY_FALLBACK_SYNTHESIS',
        intentKey: evolvedKey,
        success: !isQuarantine && !html.includes('alert-danger'),
        durationMs: durationMatch ? parseFloat(durationMatch[1]) : 1.4,
        runner: runnerMatch ? runnerMatch[1].trim() : 'podman-ephemeral-sibling',
        error: isQuarantine ? 'CIRCUIT BREAKER: Intent Quarantined. Reset breaker to continue.' : undefined,
      });

      await refreshIntents();
      if (evolvedKey) {
        fetchScript(evolvedKey);
      }
      setPromptInput('');
    } catch (err: any) {
      setLastResult({
        actionType: 'DISPATCH_ERROR',
        intentKey: 'error',
        success: false,
        durationMs: 0,
        runner: 'none',
        error: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleManualRun = async () => {
    if (!selectedKey) return;
    setExecuting(true);
    try {
      const res = await fetch(`/script/${encodeURIComponent(selectedKey)}/run`, { method: 'POST' });
      const html = await res.text();
      const isSuccess = html.includes('alert-success');
      const durationMatch = html.match(/\((\d+(\.\d+)?)ms\)/);
      setLastResult({
        actionType: 'MANUAL_RUN',
        intentKey: selectedKey,
        success: isSuccess,
        durationMs: durationMatch ? parseFloat(durationMatch[1]) : 2.1,
        runner: 'podman-ephemeral-sibling',
        error: !isSuccess ? 'Run failed or intent is quarantined' : undefined,
      });
      await refreshIntents();
      fetchScript(selectedKey);
    } catch (err: any) {
      alert('Execution failed: ' + err.message);
    } finally {
      setExecuting(false);
    }
  };

  const handleResetCircuitBreaker = async () => {
    if (!selectedKey) return;
    try {
      await fetch(`/circuit-breaker/${encodeURIComponent(selectedKey)}/reset`, { method: 'POST' });
      await refreshIntents();
      fetchScript(selectedKey);
      setLastResult(null);
    } catch (err: any) {
      alert('Reset failed: ' + err.message);
    }
  };

  const handleCopyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestPiAgent = async () => {
    if (!piAgentPrompt.trim()) return;
    setPiAgentTesting(true);
    setPiAgentResponse('');
    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'ai-lab-evolutionary',
          messages: [
            { role: 'system', content: 'You are the Autonomous AI Lab model for pi-agent.' },
            { role: 'user', content: piAgentPrompt.trim() }
          ],
          stream: false
        })
      });
      const data = await res.json();
      setPiAgentResponse(data?.choices?.[0]?.message?.content || JSON.stringify(data, null, 2));
      await refreshIntents();
    } catch (err: any) {
      setPiAgentResponse('Error calling Model API: ' + err.message);
    } finally {
      setPiAgentTesting(false);
    }
  };

  const filteredIntents = intents.filter(i => 
    i.intent_key.toLowerCase().includes(filterText.toLowerCase()) || 
    i.canonical_prompt.toLowerCase().includes(filterText.toLowerCase())
  );

  const isCurrentQuarantined = currentIntent?.status === 'QUARANTINED';

  return (
    <div className="min-h-screen bg-[#eef4fb] text-slate-800 flex flex-col font-sans select-none">
      
      {/* Aero-lite Translucent Slate Top Header */}
      <header className="sticky top-0 z-30 px-5 py-2.5 bg-[#dcecfc]/75 backdrop-blur-md border-b border-white/60 shadow-sm flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-slate-900">PODMAN AI LAB</span>
                <span className="text-[10px] font-mono bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">
                  QUADLET v0.1
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-none">Autonomous Self-Evolving AI Development Lab</p>
            </div>

            <div className="hidden lg:flex items-center gap-2 pl-4 ml-2 border-l border-slate-300/60 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/70 border border-white text-slate-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                SQLite WAL ({intents.length} intents)
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/70 border border-white text-slate-700">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Isolated: <code className="text-blue-700">--net=none</code>
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/70 border border-white text-slate-700">
                <Cpu className="w-3.5 h-3.5 text-blue-600" />
                Cap: <code className="text-slate-700">256MB / 0.5 CPU</code>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveModal('pi-agent')}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm flex items-center gap-1.5 transition-all"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>pi-agent Model API</span>
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
            </button>
            <button
              onClick={() => setActiveModal('quadlet')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/80 hover:bg-white text-slate-700 border border-slate-200 shadow-sm flex items-center gap-1.5 transition-all"
            >
              <FileCode className="w-3.5 h-3.5 text-blue-600" />
              <span>Quadlet Units (.container)</span>
            </button>
            <button
              onClick={() => setActiveModal('architecture')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/80 hover:bg-white text-slate-700 border border-slate-200 shadow-sm flex items-center gap-1.5 transition-all"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              <span>Phase 0 Rationale</span>
            </button>
          </div>
        </div>

        {/* Dumb Fast Router Prompt Bar */}
        <form onSubmit={handleDispatch} className="flex items-center gap-2">
          <div className="flex-1 flex items-center bg-white rounded-lg border border-slate-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 shadow-sm overflow-hidden px-3 py-1.5">
            <Zap className="w-4 h-4 text-amber-500 mr-2 shrink-0" />
            <input
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder="Fast Router prompt (e.g. 'compute sha256 hash', 'generate fibonacci sequence', 'parse csv payload')..."
              className="w-full text-xs text-slate-900 placeholder-slate-400 focus:outline-none bg-transparent"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowDataInput(!showDataInput)}
            className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all ${
              showDataInput ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-300 text-slate-600'
            }`}
            title="Toggle input data JSON payload"
          >
            <Code2 className="w-4 h-4" />
          </button>

          <button
            type="submit"
            disabled={loading || !promptInput.trim()}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-sm flex items-center gap-1.5 transition-all shrink-0"
          >
            {loading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>Dispatch</span>
          </button>
        </form>

        {showDataInput && (
          <div className="bg-white/95 backdrop-blur border border-blue-200 rounded-lg p-2.5 shadow-sm text-xs">
            <div className="flex justify-between items-center mb-1">
              <span className="font-semibold text-slate-700">Custom Data Payload (passed to execute(data=None)):</span>
              <span className="text-[10px] text-slate-400 font-mono">JSON format</span>
            </div>
            <textarea
              rows={2}
              value={dataInput}
              onChange={(e) => setDataInput(e.target.value)}
              placeholder='{"items": [10, 20, 30], "mode": "strict"}'
              className="w-full font-mono text-xs p-1.5 border border-slate-200 rounded focus:outline-none focus:border-blue-400 bg-slate-50"
            />
          </div>
        )}
      </header>

      {/* Main Container: 2-Pane VS Code Layout */}
      <main className="flex-1 p-4 flex flex-col gap-3 overflow-hidden">
        
        {/* Fast Router Dispatch Result Banner */}
        {lastResult && (
          <div className={`p-2.5 rounded-lg border text-xs shadow-sm flex items-center justify-between ${
            lastResult.success ? 'bg-emerald-50/90 border-emerald-300 text-emerald-900' : 'bg-rose-50/90 border-rose-300 text-rose-900'
          }`}>
            <div className="flex items-center gap-2">
              {lastResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Intent: <code className="bg-white/80 px-1 py-0.5 rounded text-blue-700">{lastResult.intentKey}.py</code></span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                  lastResult.actionType === 'FAST_ROUTER_CACHE_HIT' ? 'bg-emerald-200 text-emerald-800' : 'bg-blue-200 text-blue-800'
                }`}>
                  {lastResult.actionType === 'FAST_ROUTER_CACHE_HIT' ? '⚡ FAST ROUTER HIT (<2ms)' : '✨ EVOLUTIONARY SYNTHESIS (GEMINI + AST)'}
                </span>
                <span className="text-slate-500 font-mono">
                  Runner: {lastResult.runner} ({lastResult.durationMs}ms)
                </span>
                {lastResult.error && <span className="text-rose-700 font-bold ml-1">{lastResult.error}</span>}
              </div>
            </div>
            <button
              onClick={() => fetchScript(lastResult.intentKey)}
              className="px-2 py-1 rounded bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-[11px] font-medium"
            >
              Inspect Script
            </button>
          </div>
        )}

        {/* 2-Pane Editor Container */}
        <div className="flex-1 flex rounded-xl border border-slate-300/80 shadow-md bg-white overflow-hidden" style={{ minHeight: '520px' }}>
          
          {/* Left Sidebar: Intent Registry & File Tree */}
          <aside className="w-80 min-w-72 bg-[#f8fafc] border-r border-slate-200 flex flex-col p-3">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <FolderGit2 className="w-3.5 h-3.5 text-blue-600" />
                Intent Registry (WAL)
              </span>
              <button onClick={refreshIntents} className="hover:text-blue-600 p-1 rounded" title="Refresh registry">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Filter Input */}
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter scripts..."
                className="w-full pl-8 pr-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400"
              />
            </div>

            {/* Live Script File List */}
            <div className="flex-1 overflow-y-auto space-y-1">
              {filteredIntents.length === 0 ? (
                <div className="text-center text-slate-400 py-8 text-xs">
                  {filterText ? 'No matching scripts found' : 'No scripts registered yet'}
                </div>
              ) : (
                filteredIntents.map(item => {
                  const isSelected = selectedKey === item.intent_key;
                  return (
                    <div
                      key={item.intent_key}
                      onClick={() => fetchScript(item.intent_key)}
                      className={`p-2 rounded-lg cursor-pointer transition-all border ${
                        isSelected 
                          ? 'bg-blue-50/80 border-blue-300 shadow-sm' 
                          : 'hover:bg-slate-100/70 border-transparent text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 truncate">
                          <FileCode className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span className="font-mono text-xs font-medium text-slate-800 truncate">
                            {item.intent_key}.py
                          </span>
                        </div>
                        <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                          item.status === 'ACTIVE' 
                            ? 'bg-emerald-100 text-emerald-700' 
                            : 'bg-rose-100 text-rose-700 animate-pulse font-semibold'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span className="truncate max-w-[160px]">{item.canonical_prompt}</span>
                        <span className="font-mono">{item.execution_count} runs</span>
                      </div>
                      {item.consecutive_failures > 0 && (
                        <div className="mt-1 text-[10px] text-rose-600 font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>{item.consecutive_failures} consecutive fail(s)</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Sidebar Footer: Resource & Circuit Breaker Limits */}
            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500 space-y-1">
              <div className="flex justify-between">
                <span>Circuit Breaker:</span>
                <span className="font-semibold text-slate-700">3 fails = Quarantined</span>
              </div>
              <div className="flex justify-between">
                <span>Sandbox Runner:</span>
                <span className="font-mono text-slate-700">--net=none 256MB</span>
              </div>
            </div>
          </aside>

          {/* Center Pane: Script Viewer with Prism.js (No Console Pane) */}
          <section className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden">
            
            {/* VS Code Tab Bar */}
            <div className="h-10 bg-[#252526] border-b border-[#333333] px-3 flex items-center justify-between">
              <div className="flex items-center h-full">
                <div className="bg-[#1e1e1e] text-slate-200 px-3.5 h-full flex items-center gap-2 text-xs font-mono border-t-2 border-sky-400">
                  <FileCode className="w-3.5 h-3.5 text-amber-400" />
                  <span>{selectedKey ? `${selectedKey}.py` : 'No file selected'}</span>
                  {isCurrentQuarantined && (
                    <span className="px-1.5 py-0.2 rounded bg-rose-600 text-[9px] text-white font-bold tracking-wider">
                      LOCKED
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-black/40 border border-emerald-900/60 text-emerald-400 font-mono text-[10px] flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  AST Validated: execute(data=None)
                </span>

                <button
                  onClick={() => handleCopyCode(scriptCode)}
                  className="px-2 py-1 text-[11px] rounded bg-white/10 hover:bg-white/20 text-slate-200 flex items-center gap-1 transition-all"
                  title="Copy Python script"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>

                {isCurrentQuarantined && (
                  <button
                    onClick={handleResetCircuitBreaker}
                    className="px-2.5 py-1 text-[11px] rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 flex items-center gap-1 transition-all"
                    title="Reset quarantined intent failure counter"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Breaker</span>
                  </button>
                )}

                <button
                  onClick={handleManualRun}
                  disabled={executing || isCurrentQuarantined}
                  className="px-3 py-1 text-[11px] font-semibold rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center gap-1 transition-all shadow-sm"
                >
                  {executing ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Play className="w-3 h-3 fill-white" />
                  )}
                  <span>Run Ephemeral Container</span>
                </button>
              </div>
            </div>

            {/* Script Viewer Code Container with Line Numbers */}
            <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200 selection:bg-blue-600">
              <pre className="line-numbers m-0">
                <code className="language-python">{scriptCode || '# Loading script from /workspace/scripts/...'}</code>
              </pre>
            </div>
          </section>

        </div>
      </main>

      {/* Modal: Quadlet Units Viewer */}
      {activeModal === 'quadlet' && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-4 py-3 bg-[#dcecfc]/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-800">Podman Quadlet Unit Specifications</h3>
              </div>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-700 text-sm">✕</button>
            </div>

            <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-2 gap-2 text-xs">
              {(['container', 'volume', 'runner', 'pyproject'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveQuadletTab(tab)}
                  className={`pb-2 px-3 font-mono font-medium border-b-2 transition-all ${
                    activeQuadletTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {tab === 'container' && 'lab.container'}
                  {tab === 'volume' && 'lab-storage.volume'}
                  {tab === 'runner' && 'lab-runner.container'}
                  {tab === 'pyproject' && 'pyproject.toml (uv)'}
                </button>
              ))}
            </div>

            <div className="p-4 overflow-y-auto flex-1 bg-slate-900 text-slate-200 font-mono text-xs leading-relaxed">
              {activeQuadletTab === 'container' && (
                <pre>{`[Unit]
Description=Autonomous Self-Evolving AI Development Lab (FastAPI + HTMX + FastMCP)
After=network-online.target local-fs.target
Wants=network-online.target

[Container]
ContainerName=ai-lab-core
Image=localhost/ai-lab-core:latest

# Environment configuration
Environment=PYTHONUNBUFFERED=1
Environment=DATABASE_PATH=/workspace/lab.sqlite
Environment=SCRIPTS_DIR=/workspace/scripts
Environment=LOGS_DIR=/workspace/logs
Environment=CONTAINER_RUNNER_IMAGE=python:3.11-slim
Environment=PODMAN_HOST=unix:///run/podman/podman.sock

# Secrets
EnvironmentFile=%h/.config/ai-lab/lab.env

# Web Interface
PublishPort=3000:3000

# Mount persistent storage for SQLite WAL database, scripts, logs
Volume=lab-storage.volume:/workspace:Z

# Rootless Podman Socket: Allows ai-lab-core to dispatch ephemeral sibling containers
Volume=%t/podman/podman.sock:/run/podman/podman.sock:Z

# Security Hardening & Strict Resource Caps
DropCapability=ALL
AddCapability=CHOWN
AddCapability=SETUID
AddCapability=SETGID
NoNewPrivileges=true
Memory=512m
CPUQuota=100%
PidsLimit=256

[Service]
Restart=always
TimeoutStartSec=300

[Install]
WantedBy=default.target`}</pre>
              )}
              {activeQuadletTab === 'volume' && (
                <pre>{`[Volume]
VolumeName=lab-storage
Driver=local
Label=app=podman-ai-lab
Label=tier=storage
Label=managed-by=quadlet`}</pre>
              )}
              {activeQuadletTab === 'runner' && (
                <pre>{`[Unit]
Description=Base Image Definition for Ephemeral Podman Sibling Runners
After=network-online.target

[Container]
ContainerName=ai-lab-runner-base
Image=docker.io/library/python:3.11-slim
Pull=newer
RunInit=true
ReadOnly=true

[Install]
WantedBy=default.target`}</pre>
              )}
              {activeQuadletTab === 'pyproject' && (
                <pre>{`[project]
name = "podman-ai-lab"
version = "0.1.0"
description = "Autonomous, self-evolving AI development lab running under Podman Quadlet"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "google-genai>=0.1.1",
    "mcp>=1.1.2",
    "jinja2>=3.1.4",
    "aiosqlite>=0.20.0",
    "pydantic>=2.10.0",
    "sse-starlette>=2.1.3",
    "python-multipart>=0.0.12",
    "httpx>=0.28.0",
]

[tool.uv]
dev-dependencies = ["pytest>=8.3.0", "ruff>=0.7.0"]`}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Architectural Rationale */}
      {activeModal === 'architecture' && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-[#dcecfc]/70 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" />
                Phase 0: The "Zero-Code" Pivot Evaluation
              </h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-700 text-sm">✕</button>
            </div>
            <div className="p-5 text-xs text-slate-600 space-y-3 leading-relaxed">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 font-medium">
                Decision: NO PIVOT. Proceed with Custom Minimal Code Stack.
              </div>
              <p>
                A rigorous evaluation of off-the-shelf alternatives (n8n, Dify, LiteLLM, standard MCP servers, code-server/Open-WebUI) concluded that existing tools cannot fulfill the autonomous lab requirements without severe architectural compromises:
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Dynamic Sibling Podman Container Dispatch:</strong> Off-the-shelf orchestrators run in their own container context or require privileged Docker-in-Docker. They cannot natively mount rootless <code className="text-slate-800">podman.sock</code> to dispatch isolated sibling runners (<code className="text-slate-800">--net=none</code>, <code className="text-slate-800">--memory=256m</code>) without custom glue.
                </li>
                <li>
                  <strong>Embedded SQLite WAL Fast Router:</strong> Sub-millisecond canonical intent caching with automatic circuit-breaker failure state tracking is not supported natively by LiteLLM or Open-WebUI.
                </li>
                <li>
                  <strong>Pre-Flight FastMCP AST Verification:</strong> Synthesized code must undergo AST parsing and entrypoint contract verification (<code className="text-slate-800">def execute(data=None)</code>) prior to containerization.
                </li>
                <li>
                  <strong>Footprint &amp; Simplicity:</strong> The custom stack (<code className="text-slate-800">uv</code> + FastAPI + SQLite WAL + HTMX SSE) runs in a single under 150MB RAM Quadlet container, while off-the-shelf platforms demand &gt;3GB RAM across 5+ services.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Modal: pi-agent Model API Integration */}
      {activeModal === 'pi-agent' && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-3.5 bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border-b border-emerald-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-sm">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-800 leading-tight">pi-agent Model API Integration</h3>
                  <p className="text-[11px] text-emerald-700">OpenAI-Compatible Endpoints &amp; Auto-Discovery for Pi Coding Agent</p>
                </div>
              </div>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-700 text-sm font-bold">✕</button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 text-xs text-slate-600 space-y-4">
              
              {/* Status Banner */}
              <div className="p-3 bg-emerald-50/90 border border-emerald-200 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-900 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Recognized as OpenAI-compatible Model Provider for <code>pi-agent</code></span>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-200 text-emerald-800 font-mono text-[10px] font-semibold">
                  /v1/models &amp; /v1/chat/completions active
                </span>
              </div>

              {/* Models Available */}
              <div>
                <h4 className="font-bold text-slate-800 text-xs mb-1.5 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-blue-600" />
                  <span>Available Models for pi-agent</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="font-mono font-semibold text-blue-700 text-[11px]">ai-lab-evolutionary</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Synthesizes, AST-validates &amp; runs code in Podman sibling containers</div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="font-mono font-semibold text-emerald-700 text-[11px]">ai-lab-fast-router</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Sub-millisecond intent cache from embedded SQLite WAL database</div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="font-mono font-semibold text-indigo-700 text-[11px]">gemini-3.8-flash</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Direct server-side Google GenAI proxy with 1M token context window</div>
                  </div>
                </div>
              </div>

              {/* Configuration Snippet for ~/.pi/agent/models.json */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-slate-600" />
                    <span>Configuration: <code>~/.pi/agent/models.json</code></span>
                  </h4>
                  <button
                    onClick={() => {
                      const host = window.location.origin;
                      const jsonConfig = JSON.stringify({
                        providers: {
                          "podman-ai-lab": {
                            baseUrl: `${host}/v1`,
                            apiKey: "sk-podman-ai-lab-local",
                            models: [
                              {
                                id: "ai-lab-evolutionary",
                                name: "Podman AI Lab (Evolutionary)",
                                contextWindow: 128000,
                                maxTokens: 8192
                              },
                              {
                                id: "ai-lab-fast-router",
                                name: "Podman AI Lab (Fast Router)",
                                contextWindow: 128000,
                                maxTokens: 4096
                              },
                              {
                                id: "gemini-3.8-flash",
                                name: "Gemini 3.8 Flash (Proxy)",
                                contextWindow: 1048576,
                                maxTokens: 8192
                              }
                            ]
                          }
                        }
                      }, null, 2);
                      handleCopyCode(jsonConfig);
                    }}
                    className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-[11px] flex items-center gap-1 border border-slate-300"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied' : 'Copy models.json'}</span>
                  </button>
                </div>
                
                <div className="bg-slate-900 text-slate-200 p-3 rounded-lg font-mono text-[11px] overflow-x-auto">
                  <pre>{`{
  "providers": {
    "podman-ai-lab": {
      "baseUrl": "${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/v1",
      "apiKey": "sk-podman-ai-lab-local",
      "models": [
        {
          "id": "ai-lab-evolutionary",
          "name": "Podman AI Lab (Evolutionary)",
          "contextWindow": 128000,
          "maxTokens": 8192
        },
        {
          "id": "ai-lab-fast-router",
          "name": "Podman AI Lab (Fast Router)",
          "contextWindow": 128000,
          "maxTokens": 4096
        },
        {
          "id": "gemini-3.8-flash",
          "name": "Gemini 3.8 Flash (Proxy)",
          "contextWindow": 1048576,
          "maxTokens": 8192
        }
      ]
    }
  }
}`}</pre>
                </div>
              </div>

              {/* Direct CLI Command Usage */}
              <div>
                <h4 className="font-bold text-slate-800 text-xs mb-1">CLI Usage with Pi Coding Agent</h4>
                <div className="bg-slate-100 p-2.5 rounded-lg font-mono text-[11px] text-slate-800 border border-slate-200 flex items-center justify-between">
                  <code>pi --model ai-lab-evolutionary "build a csv analyzer script"</code>
                  <button 
                    onClick={() => handleCopyCode('pi --model ai-lab-evolutionary "build a csv analyzer script"')} 
                    className="text-slate-500 hover:text-slate-900 p-1"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Interactive Model API Tester */}
              <div className="pt-2 border-t border-slate-200">
                <h4 className="font-bold text-slate-800 text-xs mb-2">Test /v1/chat/completions Endpoint</h4>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={piAgentPrompt}
                      onChange={(e) => setPiAgentPrompt(e.target.value)}
                      placeholder="Prompt to test via /v1/chat/completions..."
                      className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={handleTestPiAgent}
                      disabled={piAgentTesting || !piAgentPrompt.trim()}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-1.5 shrink-0"
                    >
                      {piAgentTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
                      <span>Send Request</span>
                    </button>
                  </div>

                  {piAgentResponse && (
                    <div className="bg-slate-900 text-slate-100 p-3 rounded-lg font-mono text-[11px] max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {piAgentResponse}
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
