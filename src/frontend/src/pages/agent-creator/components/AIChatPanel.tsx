import React, { useState, useRef, useEffect, useCallback } from 'react';
import { fetchSSE, SSEEvent } from '../../../services/agentCreatorApi';
import { modelApi } from '../../../services/agentCreatorApi';

interface Message {
  role: 'user' | 'assistant';
  content: string;
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

  useEffect(() => {
    modelApi.list().then((data: ModelOption[]) => {
      setModels(data);
      if (data.length > 0 && !selectedModel) {
        setSelectedModel(data[0].id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initial greeting
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: `你好！我是技能设计助手。\n\n**Step ${step}/3: ${STEP_LABELS[step]}**\n\n${STEP_HINTS[step]}`,
      }]);
    }
  }, []);

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
        }
        break;
      case 'tools_suggest':
        if (event.tools) {
          onToolsSuggest(event.tools);
        }
        break;
      case 'instructions_update':
        if (event.content) {
          onInstructionsUpdate(event.content);
        }
        break;
      case 'step_complete':
        if (event.next_step) {
          onStepComplete(event.next_step);
        }
        break;
      case 'error':
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ ${event.message ?? '发生错误'}`,
        }]);
        break;
      case 'done':
        streamingRef.current = false;
        setStreaming(false);
        break;
    }
  }, [onFormUpdate, onToolsSuggest, onInstructionsUpdate, onStepComplete]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    streamingRef.current = true;
    setStreaming(true);

    // Add empty assistant message placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await fetchSSE(
        '/skills/ai-generate',
        {
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          current_skill: currentSkill,
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

  const stopStreaming = () => {
    abortRef.current?.abort();
    streamingRef.current = false;
    setStreaming(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header: Model selector + Step indicator */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Step {step}/3</span>
          <span className="text-xs text-blue-600 font-medium">{STEP_LABELS[step]}</span>
        </div>
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
        >
          {models.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-800'
            }`}>
              {msg.content || (streaming && i === messages.length - 1 ? '...' : '')}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={STEP_HINTS[step]}
            className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
            disabled={streaming}
          />
          {streaming ? (
            <button
              onClick={stopStreaming}
              className="px-3 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600"
            >
              停止
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
