import { useState, useRef, useEffect, useCallback } from 'react';
import type React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SSEEvent } from '../../../services/agentCreatorApi';
import { fetchSSE, modelApi } from '../../../services/agentCreatorApi';

interface ToolStep {
  label: string;
  count: number;
  status: 'running' | 'done';
  details?: string[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolSteps?: ToolStep[];
  /** Full content sent to LLM (includes events summary invisible to user) */
  llmContent?: string;
}

interface ChoiceOption {
  id: string;
  label: string;
}

interface PendingChoice {
  question: string;
  choices: ChoiceOption[];
  field: string;
}

interface AIChatPanelProps {
  step: number;
  currentSkill: Record<string, unknown>;
  onFormUpdate: (field: string, value: string) => void;
  onToolsSuggest: (tools: string[]) => void;
  onInstructionsUpdate: (content: string) => void;
  onStepComplete: (nextStep: number) => void;
}

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

const STEP_LABELS = ['', '基本信息', '工具与资源', '技能指令'];
const STEP_HINTS = [
  '',
  '描述你想创建的技能，AI 会自动提取名称、分类等基本信息',
  '确认或调整 AI 推荐的工具列表',
  'AI 将生成完整的 Markdown 技能指令，你可以在编辑器中修改',
];

/* ── Sub-components ── */

const ThinkingIndicator: React.FC = () => (
  <div className="flex items-center gap-2 py-2">
    <span className="chat-thinking-dot" />
    <span className="chat-thinking-text">思考中...</span>
  </div>
);

const ToolStepsPills: React.FC<{
  steps: ToolStep[];
  onToggle: (i: number) => void;
  expanded: number | null;
}> = ({ steps, onToggle, expanded }) => {
  if (steps.length === 0) return null;
  return (
    <div className="chat-tool-steps">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="h-2 w-2 rounded-full bg-blue-500" />
        <span className="text-xs font-semibold text-gray-500">AgentCreator</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {steps.map((s, i) => {
          const hasDetails = s.details && s.details.length > 0;
          return (
            <button
              key={`${s.label}-${s.count}`}
              type="button"
              onClick={hasDetails ? () => onToggle(i) : undefined}
              className={`chat-tool-pill ${s.status === 'running' ? 'chat-tool-pill-running' : ''} ${!hasDetails ? 'chat-tool-pill-static' : ''}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${s.status === 'running' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
              <span>{s.label}</span>
              {s.count > 1 && <span className="text-gray-400">&times;{s.count}</span>}
              {hasDetails && (
                <svg
                  className={`w-3 h-3 text-gray-400 transition-transform ${expanded === i ? 'rotate-180' : ''}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <title>展开</title>
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      {expanded !== null && steps[expanded]?.details && (
        <div className="chat-tool-detail">
          {(steps[expanded].details ?? []).map((d) => (
            <div key={d} className="text-xs text-gray-500 font-mono truncate">
              <span className="text-gray-400 mr-1">&bull;</span>{d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ChoiceCards: React.FC<{
  choice: PendingChoice;
  onSelect: (id: string, label: string) => void;
}> = ({ choice, onSelect }) => (
  <div className="chat-choice-card">
    <p className="text-sm font-medium text-gray-700 mb-2">{choice.question}</p>
    <div className="space-y-1.5">
      {choice.choices.map((opt, i) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onSelect(opt.id, opt.label)}
          className="chat-choice-option"
        >
          <span className="chat-choice-num">{i + 1}</span>
          <span className="text-sm text-gray-700">{opt.label}</span>
        </button>
      ))}
    </div>
  </div>
);

/* ── Markdown components for react-markdown ── */
const mdComponents: Record<string, React.FC<React.HTMLAttributes<HTMLElement> & { node?: unknown }>> = {
  h1: ({ children, node: _, ...props }) => <h2 className="chat-h2" {...props}>{children}</h2>,
  h2: ({ children, node: _, ...props }) => <h3 className="chat-h3" {...props}>{children}</h3>,
  h3: ({ children, node: _, ...props }) => <h4 className="chat-h4" {...props}>{children}</h4>,
  p: ({ children, node: _, ...props }) => <p className="chat-p" {...props}>{children}</p>,
  strong: ({ children, node: _, ...props }) => <strong className="font-semibold text-gray-900" {...props}>{children}</strong>,
  em: ({ children, node: _, ...props }) => <em className="text-gray-600 italic" {...props}>{children}</em>,
  ul: ({ children, node: _, ...props }) => <ul className="chat-ul" {...props}>{children}</ul>,
  ol: ({ children, node: _, ...props }) => <ol className="chat-ol" {...props}>{children}</ol>,
  li: ({ children, node: _, ...props }) => (
    <li className="chat-li" {...props}>
      <span className="chat-bullet" />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  ),
  code: ({ children, className, node: _, ...props }) => {
    const isBlock = className?.includes('language-');
    if (isBlock) {
      const lang = className?.replace('language-', '') || '';
      return (
        <div className="chat-code-block">
          {lang && <div className="chat-code-lang">{lang}</div>}
          <pre className="chat-code-pre"><code {...props}>{children}</code></pre>
        </div>
      );
    }
    return <code className="chat-inline-code" {...props}>{children}</code>;
  },
  blockquote: ({ children, node: _, ...props }) => <blockquote className="chat-bq" {...props}>{children}</blockquote>,
  table: ({ children, node: _, ...props }) => (
    <div className="chat-table-wrap"><table className="chat-table" {...props}>{children}</table></div>
  ),
  thead: ({ children, node: _, ...props }) => <thead className="chat-thead" {...props}>{children}</thead>,
  th: ({ children, node: _, ...props }) => <th className="chat-th" {...props}>{children}</th>,
  td: ({ children, node: _, ...props }) => <td className="chat-td" {...props}>{children}</td>,
  hr: ({ node: _, ...props }) => <hr className="chat-hr" {...props} />,
  a: ({ children, node: _, ...props }) => <a className="chat-link" target="_blank" rel="noopener" {...props}>{children}</a>,
};

/* ── Main Component ── */

const AIChatPanel: React.FC<AIChatPanelProps> = ({
  step,
  currentSkill,
  onFormUpdate,
  onToolsSuggest,
  onInstructionsUpdate,
  onStepComplete,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(null);
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [expandedTool, setExpandedTool] = useState<number | null>(null);
  // Collect structured events per turn so LLM gets full context in history
  const turnEventsRef = useRef<string[]>([]);

  useEffect(() => {
    modelApi.list().then((data: ModelOption[]) => {
      setModels(data);
      if (data.length > 0) {
        setSelectedModel(prev => {
          if (prev) return prev;
          // 优先选择 Flash Lite 作为默认模型
          const flashLite = data.find(m => /flash\s*lite/i.test(m.name));
          return flashLite ? flashLite.id : data[0].id;
        });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      streamingRef.current = false;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: `你好！我是技能设计助手。\n\n**Step ${step}/3: ${STEP_LABELS[step]}**\n\n${STEP_HINTS[step]}`,
      }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case 'message':
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && streamingRef.current) {
            return [...prev.slice(0, -1), { ...last, content: last.content + (event.content ?? '') }];
          }
          return [...prev, { role: 'assistant', content: event.content ?? '' }];
        });
        break;
      case 'form_update':
        if (event.field && event.value !== undefined) {
          onFormUpdate(event.field, event.value);
          turnEventsRef.current.push(`[已设置 ${event.field} = ${event.value}]`);
          setToolSteps(prev => {
            const existing = prev.find(s => s.label === '更新表单');
            if (existing) { existing.count++; return [...prev]; }
            return [...prev, { label: '更新表单', count: 1, status: 'done', details: [`${event.field} = ${event.value}`] }];
          });
        }
        break;
      case 'tools_suggest':
        if (event.tools) {
          const tools = event.tools;
          onToolsSuggest(tools);
          turnEventsRef.current.push(`[已推荐工具: ${tools.join(', ')}]`);
          setToolSteps(prev => [...prev, { label: '推荐工具', count: tools.length, status: 'done',
            details: tools.map((t: string) => event.labels?.[t] || t) }]);
        }
        break;
      case 'instructions_update':
        if (event.content) {
          onInstructionsUpdate(event.content);
          turnEventsRef.current.push('[已生成技能指令]');
          setToolSteps(prev => [...prev, { label: '生成指令', count: 1, status: 'done' }]);
        }
        break;
      case 'user_choices':
        if (event.choices && event.question) {
          const choiceLabels = event.choices.map(c => c.label).join(' / ');
          turnEventsRef.current.push(`[已向用户提问: ${event.question} — 选项: ${choiceLabels}]`);
          setPendingChoice({
            question: event.question,
            choices: event.choices,
            field: event.field || '',
          });
          // Trim trailing duplicate content from last assistant message
          setMessages(prev => {
            const lastIdx = prev.length - 1;
            if (lastIdx >= 0 && prev[lastIdx].role === 'assistant') {
              const content = prev[lastIdx].content;
              const questionText = event.question ?? '';
              if (questionText && content.includes(questionText)) {
                const trimmed = content.slice(0, content.indexOf(questionText)).trimEnd();
                if (trimmed.length > 0) {
                  const updated = [...prev];
                  updated[lastIdx] = { ...updated[lastIdx], content: trimmed };
                  return updated;
                }
              }
            }
            return prev;
          });
        }
        break;
      case 'step_complete':
        if (event.next_step) {
          onStepComplete(event.next_step);
          turnEventsRef.current.push(`[步骤完成，进入步骤 ${event.next_step}]`);
        }
        break;
      case 'error':
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ ${event.message ?? '发生错误'}`,
        }]);
        break;
      case 'done': {
        // Build llmContent = visible content + events summary
        const eventsSummary = turnEventsRef.current.length > 0
          ? `\n\n---\n${turnEventsRef.current.join('\n')}`
          : '';
        turnEventsRef.current = [];

        // Attach toolSteps + llmContent to the last assistant message
        setToolSteps(currentSteps => {
          const finalSteps = currentSteps.length > 0
            ? currentSteps.map(s => ({ ...s, status: 'done' as const }))
            : [];
          setMessages(prev => {
            const lastIdx = prev.length - 1;
            if (lastIdx >= 0 && prev[lastIdx].role === 'assistant') {
              const updated = [...prev];
              const msg = updated[lastIdx];
              updated[lastIdx] = {
                ...msg,
                toolSteps: finalSteps.length > 0 ? finalSteps : msg.toolSteps,
                llmContent: msg.content + eventsSummary,
              };
              return updated;
            }
            return prev;
          });
          return [];
        });
        streamingRef.current = false;
        setStreaming(false);
        break;
      }
    }
  }, [onFormUpdate, onToolsSuggest, onInstructionsUpdate, onStepComplete]);

  const sendMessage = async (text?: string, skillOverride?: Record<string, unknown>) => {
    const msgText = (text ?? input).trim();
    if (!msgText || streaming) return;

    const userMsg: Message = { role: 'user', content: msgText };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setPendingChoice(null);
    streamingRef.current = true;
    setStreaming(true);
    setToolSteps([{ label: '分析需求', count: 1, status: 'running' }]);
    turnEventsRef.current = [];

    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    // Use skillOverride if provided (e.g. from choice selection where
    // parent state hasn't re-rendered yet with the updated value)
    const skillToSend = skillOverride ?? currentSkill;

    try {
      setToolSteps(prev => prev.map(s => s.label === '分析需求' ? { ...s, status: 'done' as const } : s));

      await fetchSSE(
        '/skills/ai-generate',
        {
          // Send llmContent (with events summary) when available, otherwise content
          messages: newMessages.map(m => ({ role: m.role, content: m.llmContent ?? m.content })),
          current_skill: skillToSend,
          model_id: selectedModel || undefined,
          step,
        },
        handleSSEEvent,
        controller.signal,
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⚠️ 连接中断，请重试',
        }]);
      }
    } finally {
      streamingRef.current = false;
      setStreaming(false);
    }
  };

  const handleChoiceSelect = (id: string, label: string) => {
    const field = pendingChoice?.field;
    if (field) {
      onFormUpdate(field, id);
    }
    setPendingChoice(null);
    // Merge choice into skill immediately — React state update from
    // onFormUpdate is async, so currentSkill would still be stale
    const mergedSkill = field
      ? { ...currentSkill, [field]: id }
      : currentSkill;
    sendMessage(`我选择: ${label}`, mergedSkill);
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    streamingRef.current = false;
    setStreaming(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white/80">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          <span className="text-xs font-semibold text-gray-500">Step {step}/3</span>
          <span className="text-xs text-blue-600 font-semibold">{STEP_LABELS[step]}</span>
        </div>
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-600"
        >
          {models.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 chat-scroll">
        {messages.map((msg, idx) => {
          const isLiveAssistant = streaming && idx === messages.length - 1 && msg.role === 'assistant';
          const stepsToShow = isLiveAssistant ? toolSteps : (msg.toolSteps ?? []);
          const msgKey = `${msg.role}-${msg.content.slice(0, 20)}`;

          return (
            <div key={msgKey} className={msg.role === 'user' ? 'flex justify-end' : 'chat-assistant-row'}>
              {msg.role === 'user' ? (
                <div className="chat-user-bubble">{msg.content}</div>
              ) : msg.content ? (
                <>
                  {stepsToShow.length > 0 && (
                    <ToolStepsPills steps={stepsToShow} onToggle={j => setExpandedTool(expandedTool === j ? null : j)} expanded={expandedTool} />
                  )}
                  <div className="chat-assistant-msg chat-md">
                    <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {msg.content}
                    </Markdown>
                  </div>
                </>
              ) : isLiveAssistant ? (
                <>
                  {toolSteps.length > 0 && (
                    <ToolStepsPills steps={toolSteps} onToggle={j => setExpandedTool(expandedTool === j ? null : j)} expanded={expandedTool} />
                  )}
                  <ThinkingIndicator />
                </>
              ) : null}
            </div>
          );
        })}

        {pendingChoice && (
          <ChoiceCards choice={pendingChoice} onSelect={handleChoiceSelect} />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3 bg-white/80">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={STEP_HINTS[step]}
            className="flex-1 text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 bg-gray-50 placeholder:text-gray-400"
            disabled={streaming}
          />
          {streaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              className="px-3.5 py-2.5 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors"
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={() => sendMessage()}
              disabled={!input.trim()}
              className="px-3.5 py-2.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIChatPanel;
