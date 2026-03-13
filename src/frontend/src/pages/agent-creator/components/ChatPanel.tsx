/**
 * @module ChatPanel
 * @description 右侧常驻聊天面板组件。
 * 提供会话列表、消息显示、WebSocket 实时通信、输入发送和 @提及功能。
 * 常驻于 AgentCreator 布局右侧，不随子页面导航切换消失。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { conversationApi, personaApi } from '../../../services/agentCreatorApi';
import Snackbar from '../../../components/m3/Snackbar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WsMessage {
  id: string;
  type: string;
  conversation_id: string;
  sender_type: 'user' | 'persona' | 'system';
  sender_id: string | null;
  sender_name: string;
  content: string;
  content_type: string;
  attachments?: any[];
  metadata?: any;
  created_at: string;
}

interface Conversation {
  id: string;
  type: 'direct' | 'team' | 'brainstorm';
  title: string | null;
  participants: string[] | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_message?: { content: string; sender_type: string; created_at: string } | null;
}

interface Persona {
  id: string;
  name: string;
  avatar?: string | null;
  position_name?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max reconnection attempts before giving up */
const MAX_RECONNECT_ATTEMPTS = 5;
/** Base delay for exponential backoff (ms) */
const RECONNECT_BASE_DELAY = 1000;
/** Ping interval to keep connection alive (ms) */
const PING_INTERVAL = 30000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChatPanelProps {
  onClose?: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ onClose }) => {
  const navigate = useNavigate();
  // State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showSessions, setShowSessions] = useState(false);
  const [typingPersona, setTypingPersona] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatType, setNewChatType] = useState<'direct' | 'team'>('direct');
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [newChatTitle, setNewChatTitle] = useState('');
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string }>({ open: false, message: '' });

  // Refs
  const ws = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const personasRef = useRef<Persona[]>([]);
  /** Track whether the component is still mounted */
  const mountedRef = useRef(true);
  /** Track intentional close to avoid reconnection */
  const intentionalClose = useRef(false);

  // Keep personasRef in sync for use inside callbacks
  useEffect(() => {
    personasRef.current = personas;
  }, [personas]);

  // Active conversation object
  const activeConversation = conversations.find(c => c.id === activeConversationId);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const getPersonaName = useCallback((personaId: string | null): string => {
    if (!personaId) return '系统';
    const p = personasRef.current.find(p => p.id === personaId);
    return p?.name || '助手';
  }, []);

  const getInitial = (name: string): string => {
    return name.charAt(0).toUpperCase();
  };

  const getTypeBadge = (type: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      direct: { label: '私聊', cls: 'bg-blue-100 text-blue-700' },
      team: { label: '团队', cls: 'bg-green-100 text-green-700' },
      brainstorm: { label: '脑暴', cls: 'bg-purple-100 text-purple-700' },
    };
    const badge = map[type] || { label: type, cls: 'bg-gray-100 text-gray-700' };
    return (
      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${badge.cls}`}>
        {badge.label}
      </span>
    );
  };

  const formatTime = (iso: string): string => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) {
        return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      } else if (diffDays === 1) {
        return '昨天';
      } else if (diffDays < 7) {
        return `${diffDays}天前`;
      }
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  /** Extract @[name](id) mention patterns from input text */
  const extractMentions = (text: string): string[] => {
    const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
    const ids: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(text)) !== null) {
      ids.push(match[2]);
    }
    return ids;
  };

  const showNotification = useCallback((message: string) => {
    setSnackbar({ open: true, message });
  }, []);

  // Participants that can be mentioned in the current conversation
  const mentionablePersonas = personas.filter(p => {
    if (!activeConversation?.participants) return true; // allow all if no participants set
    return activeConversation.participants.includes(p.id);
  });

  const filteredMentionPersonas = mentionablePersonas.filter(p =>
    !mentionFilter || p.name.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const loadConversations = useCallback(async () => {
    try {
      const list = await conversationApi.list();
      setConversations(list || []);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, []);

  const loadPersonas = useCallback(async () => {
    try {
      const list = await personaApi.list();
      setPersonas(list || []);
    } catch (err) {
      console.error('Failed to load personas:', err);
    }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const msgs = await conversationApi.getMessages(convId, { limit: 50 });
      const mapped: WsMessage[] = (msgs || []).map((m: any) => ({
        id: m.id,
        type: 'message',
        conversation_id: m.conversation_id,
        sender_type: m.sender_type,
        sender_id: m.sender_id,
        sender_name: m.sender_type === 'user' ? '你' : getPersonaName(m.sender_id),
        content: m.content,
        content_type: m.content_type || 'text',
        attachments: m.attachments,
        metadata: m.metadata,
        created_at: m.created_at,
      }));
      setMessages(mapped);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }, [getPersonaName]);

  // ---------------------------------------------------------------------------
  // WebSocket connection with reconnection
  // ---------------------------------------------------------------------------

  const clearTimers = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
  }, []);

  const connectWebSocket = useCallback((conversationId: string) => {
    // Close existing connection
    if (ws.current) {
      intentionalClose.current = true;
      ws.current.close();
      ws.current = null;
    }
    clearTimers();
    intentionalClose.current = false;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${location.host}/ws/agent/ws/chat/${conversationId}`
    );

    socket.onopen = () => {
      if (!mountedRef.current) return;
      setWsConnected(true);
      reconnectAttempts.current = 0;

      // Start ping keepalive
      pingTimer.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL);
    };

    socket.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'message') {
          setMessages(prev => {
            // Avoid duplicates
            if (prev.some(m => m.id === data.id)) return prev;
            return [...prev, data as WsMessage];
          });
          // Clear typing indicator when persona responds
          if (data.sender_type === 'persona') {
            setTypingPersona(null);
          }
        } else if (data.type === 'typing' || data.type === 'agent_start') {
          setTypingPersona(data.persona_name);
          // Auto-clear typing after 60s as safety net
          if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
          typingTimerRef.current = setTimeout(() => setTypingPersona(null), 60000);
        } else if (data.type === 'typing_done' || data.type === 'agent_end') {
          setTypingPersona(null);
          if (typingTimerRef.current) {
            clearTimeout(typingTimerRef.current);
            typingTimerRef.current = null;
          }
        } else if (data.type === 'system') {
          // System notification
          setMessages(prev => [
            ...prev,
            {
              id: `sys_${Date.now()}`,
              type: 'message',
              conversation_id: conversationId,
              sender_type: 'system',
              sender_id: null,
              sender_name: '系统',
              content: data.message,
              content_type: 'text',
              created_at: new Date().toISOString(),
            },
          ]);
        } else if (data.type === 'error') {
          const detail = data.message || data.data?.detail || '未知错误';
          showNotification(`错误: ${detail}`);
        }
        // type === 'pong' is silently ignored
      } catch (err) {
        console.error('Failed to parse WS message:', err);
      }
    };

    socket.onclose = (event) => {
      if (!mountedRef.current) return;
      setWsConnected(false);
      if (pingTimer.current) {
        clearInterval(pingTimer.current);
        pingTimer.current = null;
      }

      // Do not reconnect if intentionally closed or code 4004 (not found)
      if (intentionalClose.current || event.code === 4004) return;

      // Attempt reconnection with exponential backoff
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts.current);
        reconnectAttempts.current += 1;
        console.log(`WebSocket closed, reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
        reconnectTimer.current = setTimeout(() => {
          if (mountedRef.current) {
            connectWebSocket(conversationId);
          }
        }, delay);
      } else {
        showNotification('连接已断开，请刷新页面重试');
      }
    };

    socket.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.current = socket;
  }, [clearTimers, showNotification]);

  // Connect/disconnect when active conversation changes
  useEffect(() => {
    if (!activeConversationId) {
      if (ws.current) {
        intentionalClose.current = true;
        ws.current.close();
        ws.current = null;
      }
      clearTimers();
      setWsConnected(false);
      setTypingPersona(null);
      return;
    }

    connectWebSocket(activeConversationId);

    return () => {
      intentionalClose.current = true;
      ws.current?.close();
      ws.current = null;
      clearTimers();
    };
  }, [activeConversationId, connectWebSocket, clearTimers]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      intentionalClose.current = true;
      ws.current?.close();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Initial load + auto-scroll
  // ---------------------------------------------------------------------------

  useEffect(() => {
    loadConversations();
    loadPersonas();
  }, [loadConversations, loadPersonas]);

  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
    }
  }, [activeConversationId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingPersona]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content || !ws.current || ws.current.readyState !== WebSocket.OPEN) return;

    const mentions = extractMentions(content);

    ws.current.send(JSON.stringify({
      type: 'message',
      content,
      content_type: 'text',
      ...(mentions.length > 0 ? { mentions } : {}),
    }));

    setInputValue('');
    setShowMentionPopup(false);
  }, [inputValue]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);

    // Detect @ mention trigger
    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex >= 0) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1);
      // Only trigger if @ is at start or preceded by space/newline
      const charBefore = atIndex > 0 ? val[atIndex - 1] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || atIndex === 0) {
        // Don't trigger if already inside a completed mention @[name](id)
        if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n') && !textAfterAt.includes('[')) {
          setShowMentionPopup(true);
          setMentionFilter(textAfterAt);
          return;
        }
      }
    }
    setShowMentionPopup(false);
  }, []);

  const handleMentionSelect = useCallback((persona: Persona) => {
    const cursorPos = inputRef.current?.selectionStart || inputValue.length;
    const textBeforeCursor = inputValue.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex >= 0) {
      const before = inputValue.slice(0, atIndex);
      const after = inputValue.slice(cursorPos);
      const mention = `@[${persona.name}](${persona.id}) `;
      setInputValue(before + mention + after);
    }

    setShowMentionPopup(false);
    inputRef.current?.focus();
  }, [inputValue]);

  const handleCreateConversation = useCallback(async () => {
    if (selectedParticipants.length === 0) return;

    try {
      const title = newChatTitle.trim() || undefined;
      const conv = await conversationApi.create({
        type: newChatType,
        title,
        participants: selectedParticipants,
      });

      setShowNewChat(false);
      setNewChatTitle('');
      setSelectedParticipants([]);
      setNewChatType('direct');
      await loadConversations();
      setActiveConversationId(conv.id);
      showNotification('会话创建成功');
    } catch (err) {
      console.error('Failed to create conversation:', err);
      showNotification('创建会话失败，请重试');
    }
  }, [selectedParticipants, newChatTitle, newChatType, loadConversations, showNotification]);

  const toggleParticipant = useCallback((id: string) => {
    setSelectedParticipants(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }, []);

  const handleReconnect = useCallback(() => {
    if (activeConversationId) {
      reconnectAttempts.current = 0;
      connectWebSocket(activeConversationId);
    }
  }, [activeConversationId, connectWebSocket]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="w-full h-full flex flex-col bg-surface font-roboto">
      {/* Top bar */}
      <div className="px-4 py-2.5 border-b border-outline-variant/60 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="title-small text-on-surface">智能助手</h3>
          {wsConnected ? (
            <span className="w-2 h-2 rounded-full bg-green-500" title="已连接" />
          ) : activeConversationId ? (
            <button
              type="button"
              onClick={handleReconnect}
              className="w-2 h-2 rounded-full bg-red-400 cursor-pointer"
              title="连接断开，点击重连"
            />
          ) : null}
        </div>
        <div className="flex items-center gap-0.5">
          {/* Toggle session list */}
          <button
            type="button"
            onClick={() => setShowSessions(!showSessions)}
            className="p-1.5 rounded-full text-on-surface-variant hover:bg-on-surface/[0.08] transition-colors"
            title="会话列表"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" fill="currentColor"/>
            </svg>
          </button>
          {/* New conversation */}
          <button
            type="button"
            onClick={() => { setShowNewChat(true); setShowSessions(false); }}
            className="p-1.5 rounded-full text-on-surface-variant hover:bg-on-surface/[0.08] transition-colors"
            title="新建会话"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
            </svg>
          </button>
          {/* Close panel */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full text-on-surface-variant hover:bg-on-surface/[0.08] transition-colors"
              title="关闭"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* New chat dialog */}
      {showNewChat && (
        <div className="border-b border-outline-variant bg-surface-container-low p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-on-surface">新建会话</span>
            <button
              type="button"
              onClick={() => setShowNewChat(false)}
              className="text-on-surface-variant hover:text-on-surface text-sm"
            >
              取消
            </button>
          </div>

          {/* Title */}
          <input
            type="text"
            placeholder="会话标题（可选）"
            value={newChatTitle}
            onChange={e => setNewChatTitle(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-surface-container rounded-lg border border-outline-variant focus:border-primary outline-none text-on-surface"
          />

          {/* Type selector */}
          <div className="flex gap-2">
            {(['direct', 'team'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setNewChatType(t);
                  if (t === 'direct') setSelectedParticipants(prev => prev.slice(0, 1));
                }}
                className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${
                  newChatType === t
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
                }`}
              >
                {t === 'direct' ? '私聊 (1v1)' : '团队协作'}
              </button>
            ))}
          </div>

          {/* Participant selection */}
          <div className="max-h-32 overflow-y-auto space-y-1">
            {personas.length === 0 ? (
              <div className="text-xs text-on-surface-variant text-center py-2">
                暂无数字员工，
                <button
                  type="button"
                  className="text-primary hover:underline font-medium"
                  onClick={() => {
                    onClose?.();
                    navigate('/agent-creator/personas');
                  }}
                >
                  前往创建
                </button>
              </div>
            ) : (
              personas.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (newChatType === 'direct') {
                      setSelectedParticipants([p.id]);
                    } else {
                      toggleParticipant(p.id);
                    }
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                    selectedParticipants.includes(p.id)
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'text-on-surface-variant hover:bg-on-surface/[0.08]'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-primary-container text-primary flex items-center justify-center text-xs font-medium">
                    {getInitial(p.name)}
                  </span>
                  <span className="flex-1 text-left truncate">{p.name}</span>
                  {p.position_name && (
                    <span className="text-xs text-on-surface-variant/60">{p.position_name}</span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Create button */}
          <button
            type="button"
            onClick={handleCreateConversation}
            disabled={selectedParticipants.length === 0}
            className={`w-full py-2 text-sm rounded-lg transition-colors ${
              selectedParticipants.length > 0
                ? 'bg-primary text-on-primary hover:shadow-elevation-1'
                : 'bg-on-surface/[0.12] text-on-surface/[0.38] cursor-not-allowed'
            }`}
          >
            创建会话 {selectedParticipants.length > 0 ? `(${selectedParticipants.length}人)` : ''}
          </button>
        </div>
      )}

      {/* Session list (collapsible) */}
      {showSessions && !showNewChat && (
        <div className="border-b border-outline-variant bg-surface-container-low">
          <div className="px-3 py-2 space-y-1 max-h-60 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="text-xs text-on-surface-variant text-center py-4">
                暂无会话，点击 + 创建
              </p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => {
                    setActiveConversationId(conv.id);
                    setShowSessions(false);
                    setMessages([]);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    activeConversationId === conv.id
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'text-on-surface-variant hover:bg-on-surface/[0.08]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    {getTypeBadge(conv.type)}
                    <span className="text-sm font-medium truncate flex-1">
                      {conv.title || '未命名会话'}
                    </span>
                    <span className="text-xs text-on-surface-variant/60">
                      {formatTime(conv.updated_at)}
                    </span>
                  </div>
                  {conv.last_message && (
                    <p className="text-xs text-on-surface-variant/70 truncate pl-1">
                      {conv.last_message.content}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!activeConversationId ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-primary-container/50 flex items-center justify-center mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-primary">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" fill="currentColor"/>
              </svg>
            </div>
            <p className="body-medium text-on-surface-variant">
              开始对话来与数字员工沟通
            </p>
            <p className="body-small text-on-surface-variant/60 mt-1">
              点击 + 创建新会话，或选择已有会话
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <p className="body-medium text-on-surface-variant">
              发送第一条消息开始对话
            </p>
            <p className="body-small text-on-surface-variant/60 mt-1">
              使用 @ 来提及特定数字员工
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <div key={msg.id}>
                {msg.sender_type === 'system' ? (
                  /* System message */
                  <div className="flex justify-center">
                    <span className="text-xs text-on-surface-variant/60 bg-surface-container-low px-3 py-1 rounded-full">
                      {msg.content}
                    </span>
                  </div>
                ) : msg.sender_type === 'user' ? (
                  /* User message - right aligned */
                  <div className="flex justify-end">
                    <div className="max-w-[85%]">
                      <div className="bg-primary text-on-primary px-4 py-2.5 rounded-2xl rounded-br-sm body-medium whitespace-pre-wrap break-words">
                        {msg.content}
                      </div>
                      <div className="text-right mt-0.5">
                        <span className="text-xs text-on-surface-variant/50">
                          {formatTime(msg.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Persona message - left aligned with avatar */
                  <div className="flex justify-start gap-2">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-tertiary-container text-on-tertiary-container flex items-center justify-center text-sm font-medium mt-1">
                      {getInitial(msg.sender_name || '?')}
                    </div>
                    <div className="max-w-[80%]">
                      <span className="text-xs font-medium text-on-surface-variant mb-1 block">
                        {msg.sender_name}
                      </span>
                      <div className="bg-surface-container-high text-on-surface px-4 py-2.5 rounded-2xl rounded-bl-sm body-medium whitespace-pre-wrap break-words">
                        {msg.content}
                      </div>
                      <div className="mt-0.5">
                        <span className="text-xs text-on-surface-variant/50">
                          {formatTime(msg.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {typingPersona && (
              <div className="flex justify-start gap-2">
                <div className="shrink-0 w-8 h-8 rounded-full bg-tertiary-container text-on-tertiary-container flex items-center justify-center text-sm font-medium mt-1">
                  {getInitial(typingPersona)}
                </div>
                <div>
                  <span className="text-xs font-medium text-on-surface-variant mb-1 block">
                    {typingPersona}
                  </span>
                  <div className="bg-surface-container-high text-on-surface-variant px-4 py-2.5 rounded-2xl rounded-bl-sm body-medium">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                      <span className="ml-2 text-xs">{typingPersona}正在思考...</span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      {activeConversationId && (
        <div className="px-3 pb-3 pt-2 border-t border-outline-variant">
          {/* Disconnected banner */}
          {!wsConnected && (
            <div className="mb-2 flex items-center justify-between px-3 py-1.5 bg-error-container rounded-lg">
              <span className="text-xs text-on-error-container">连接已断开</span>
              <button
                type="button"
                onClick={handleReconnect}
                className="text-xs font-medium text-on-error-container hover:underline"
              >
                重新连接
              </button>
            </div>
          )}

          {/* @mention popup */}
          {showMentionPopup && filteredMentionPersonas.length > 0 && (
            <div className="mb-2 bg-surface-container rounded-xl border border-outline-variant shadow-elevation-2 max-h-32 overflow-y-auto">
              {filteredMentionPersonas.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleMentionSelect(p)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-on-surface hover:bg-on-surface/[0.08] transition-colors"
                >
                  <span className="w-6 h-6 rounded-full bg-primary-container text-primary flex items-center justify-center text-xs font-medium">
                    {getInitial(p.name)}
                  </span>
                  <span>{p.name}</span>
                  {p.position_name && (
                    <span className="text-xs text-on-surface-variant/60 ml-auto">{p.position_name}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="输入消息，@ 提及员工..."
                rows={1}
                className="w-full px-4 py-2.5 bg-surface-container rounded-2xl body-medium text-on-surface placeholder:text-on-surface-variant/50 outline-none border border-outline-variant focus:border-primary resize-none transition-colors"
                style={{ maxHeight: '120px' }}
              />
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputValue.trim() || !wsConnected}
              className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                inputValue.trim() && wsConnected
                  ? 'bg-primary text-on-primary hover:shadow-elevation-1'
                  : 'bg-on-surface/[0.12] text-on-surface/[0.38]'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Snackbar notifications */}
      <Snackbar
        message={snackbar.message}
        open={snackbar.open}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        duration={4000}
      />
    </div>
  );
};

export default ChatPanel;
