/**
 * @module WorkflowView
 * @description 工作流设计器 - 可视化工作流编辑器，支持节点拖放、连线、属性编辑。
 * 左侧面板：节点面板（拖拽添加节点）
 * 中间：SVG 画布（节点 + 边渲染）
 * 右侧面板：节点属性编辑器（选中节点时出现）
 * 顶部工具栏：保存、验证、执行
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Button from '../../components/m3/Button';
import Snackbar from '../../components/m3/Snackbar';
import { workflowApi } from '../../services/agentCreatorApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WfNode {
  id: string;
  workflow_id: string;
  node_type: string;
  label: string;
  config: any;
  position_x: number;
  position_y: number;
}

interface WfEdge {
  id: string;
  workflow_id: string;
  source_node_id: string;
  target_node_id: string;
  condition: any;
}

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  nodes: WfNode[];
  edges: WfEdge[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_W = 160;
const NODE_H = 56;

const NODE_PALETTE = [
  { type: 'start', label: '开始', color: '#22c55e', icon: 'M8 5v14l11-7z' },
  { type: 'end', label: '结束', color: '#ef4444', icon: 'M6 6h12v12H6z' },
  {
    type: 'persona_task',
    label: '人设任务',
    color: '#6366f1',
    icon: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  },
  {
    type: 'condition',
    label: '条件判断',
    color: '#f59e0b',
    icon: 'M12 2L3.5 12 12 22l8.5-10L12 2zm0 3.58L17.36 12 12 18.42 6.64 12 12 5.58z',
  },
  {
    type: 'parallel',
    label: '并行分支',
    color: '#06b6d4',
    icon: 'M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z',
  },
  {
    type: 'join',
    label: '汇聚',
    color: '#8b5cf6',
    icon: 'M17 20.41L18.41 19 15 15.59 13.59 17 17 20.41zM7.5 8H11v5.59L5.59 19 7 20.41l6-6V8h3.5L12 3.5 7.5 8z',
  },
];

const NODE_COLORS: Record<string, string> = {};
NODE_PALETTE.forEach((p) => {
  NODE_COLORS[p.type] = p.color;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WorkflowView: React.FC = () => {
  // Workflow list & current
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);

  // Canvas state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // UI state
  const [snack, setSnack] = useState({ open: false, message: '' });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);

  // Node property editor state
  const [editLabel, setEditLabel] = useState('');
  const [editPersonaId, setEditPersonaId] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editExpression, setEditExpression] = useState('');

  const svgRef = useRef<SVGSVGElement>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const loadWorkflows = useCallback(async () => {
    try {
      const list = await workflowApi.list();
      setWorkflows(list || []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadWorkflow = useCallback(async (id: string) => {
    try {
      const wf = await workflowApi.get(id);
      setWorkflow(wf);
      setCurrentId(id);
      setSelectedNodeId(null);
      setExecutionResult(null);
    } catch {
      setSnack({ open: true, message: '加载工作流失败' });
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  // sync edit fields when selection changes
  useEffect(() => {
    if (!selectedNodeId || !workflow) return;
    const node = workflow.nodes.find((n) => n.id === selectedNodeId);
    if (node) {
      setEditLabel(node.label);
      const cfg = node.config || {};
      setEditPersonaId(cfg.persona_id || '');
      setEditPrompt(cfg.prompt || '');
      setEditExpression(cfg.expression || '');
    }
  }, [selectedNodeId, workflow]);

  // ---------------------------------------------------------------------------
  // Workflow CRUD
  // ---------------------------------------------------------------------------

  const handleCreateWorkflow = async () => {
    if (!newName.trim()) return;
    try {
      const wf = await workflowApi.create({ name: newName.trim() });
      setSnack({ open: true, message: '工作流已创建' });
      setCreating(false);
      setNewName('');
      await loadWorkflows();
      if (wf?.id) loadWorkflow(wf.id);
    } catch (e: any) {
      setSnack({ open: true, message: e.message || '创建失败' });
    }
  };

  const handleDeleteWorkflow = async () => {
    if (!currentId) return;
    if (!window.confirm('确定删除此工作流？')) return;
    try {
      await workflowApi.delete(currentId);
      setWorkflow(null);
      setCurrentId(null);
      setSnack({ open: true, message: '工作流已删除' });
      loadWorkflows();
    } catch (e: any) {
      setSnack({ open: true, message: e.message || '删除失败' });
    }
  };

  // ---------------------------------------------------------------------------
  // Node operations
  // ---------------------------------------------------------------------------

  const handleAddNode = async (type: string, label: string) => {
    if (!currentId) return;
    try {
      const node = await workflowApi.addNode(currentId, {
        node_type: type,
        label,
        position_x: 250 + Math.random() * 200,
        position_y: 100 + Math.random() * 300,
      });
      if (node) {
        setWorkflow((prev) =>
          prev ? { ...prev, nodes: [...prev.nodes, node] } : prev,
        );
      }
    } catch (e: any) {
      setSnack({ open: true, message: e.message || '添加节点失败' });
    }
  };

  const handleDeleteNode = async () => {
    if (!selectedNodeId) return;
    try {
      await workflowApi.deleteNode(selectedNodeId);
      setWorkflow((prev) =>
        prev
          ? {
              ...prev,
              nodes: prev.nodes.filter((n) => n.id !== selectedNodeId),
              edges: prev.edges.filter(
                (e) =>
                  e.source_node_id !== selectedNodeId &&
                  e.target_node_id !== selectedNodeId,
              ),
            }
          : prev,
      );
      setSelectedNodeId(null);
    } catch (e: any) {
      setSnack({ open: true, message: e.message || '删除节点失败' });
    }
  };

  const handleSaveNodeProps = async () => {
    if (!selectedNodeId) return;
    const node = workflow?.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;

    const config: any = { ...node.config };
    if (node.node_type === 'persona_task') {
      config.persona_id = editPersonaId;
      config.prompt = editPrompt;
    } else if (node.node_type === 'condition') {
      config.expression = editExpression;
    }

    try {
      const updated = await workflowApi.updateNode(selectedNodeId, {
        label: editLabel,
        config,
      });
      if (updated) {
        setWorkflow((prev) =>
          prev
            ? {
                ...prev,
                nodes: prev.nodes.map((n) =>
                  n.id === selectedNodeId ? { ...n, ...updated } : n,
                ),
              }
            : prev,
        );
        setSnack({ open: true, message: '节点已更新' });
      }
    } catch (e: any) {
      setSnack({ open: true, message: e.message || '更新节点失败' });
    }
  };

  // ---------------------------------------------------------------------------
  // Edge operations
  // ---------------------------------------------------------------------------

  const handleDeleteEdge = async (edgeId: string) => {
    try {
      await workflowApi.deleteEdge(edgeId);
      setWorkflow((prev) =>
        prev
          ? { ...prev, edges: prev.edges.filter((e) => e.id !== edgeId) }
          : prev,
      );
    } catch (e: any) {
      setSnack({ open: true, message: e.message || '删除连线失败' });
    }
  };

  const finishConnection = async (targetId: string) => {
    if (!connectingFrom || !currentId || connectingFrom === targetId) {
      setConnectingFrom(null);
      return;
    }
    try {
      const edge = await workflowApi.addEdge(currentId, {
        source_node_id: connectingFrom,
        target_node_id: targetId,
      });
      if (edge) {
        setWorkflow((prev) =>
          prev ? { ...prev, edges: [...prev.edges, edge] } : prev,
        );
      }
    } catch (e: any) {
      setSnack({ open: true, message: e.message || '创建连线失败' });
    }
    setConnectingFrom(null);
  };

  // ---------------------------------------------------------------------------
  // Validate & Execute
  // ---------------------------------------------------------------------------

  const handleValidate = async () => {
    if (!currentId) return;
    try {
      const result = await workflowApi.validate(currentId);
      if (result?.valid) {
        setSnack({ open: true, message: '工作流验证通过' });
      } else {
        const errors = result?.errors?.join('; ') || '未知错误';
        setSnack({ open: true, message: `验证失败: ${errors}` });
      }
    } catch (e: any) {
      setSnack({ open: true, message: e.message || '验证失败' });
    }
  };

  const handleExecute = async () => {
    if (!currentId) return;
    setExecuting(true);
    setExecutionResult(null);
    try {
      const result = await workflowApi.execute(currentId);
      setExecutionResult(result);
      setSnack({
        open: true,
        message:
          result?.status === 'completed'
            ? '工作流执行完成'
            : `执行结果: ${result?.status || '未知'}`,
      });
    } catch (e: any) {
      setSnack({ open: true, message: e.message || '执行失败' });
    } finally {
      setExecuting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Drag handling
  // ---------------------------------------------------------------------------

  const getSvgPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!svgRef.current) return { x: clientX, y: clientY };
      const rect = svgRef.current.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [],
  );

  const handleNodeMouseDown = (
    e: React.MouseEvent,
    nodeId: string,
  ) => {
    if (e.button !== 0) return;
    // Right side of node = start connecting
    const node = workflow?.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const pt = getSvgPoint(e.clientX, e.clientY);
    const nodeRight = node.position_x + NODE_W;
    const distToRight = Math.abs(pt.x - nodeRight);

    if (distToRight < 20) {
      e.stopPropagation();
      setConnectingFrom(nodeId);
      setMousePos(pt);
      return;
    }

    e.stopPropagation();
    setDraggingNodeId(nodeId);
    setDragOffset({
      x: pt.x - node.position_x,
      y: pt.y - node.position_y,
    });
    setSelectedNodeId(nodeId);
  };

  const handleSvgMouseMove = (e: React.MouseEvent) => {
    const pt = getSvgPoint(e.clientX, e.clientY);

    if (connectingFrom) {
      setMousePos(pt);
      return;
    }

    if (draggingNodeId && workflow) {
      const newX = Math.max(0, pt.x - dragOffset.x);
      const newY = Math.max(0, pt.y - dragOffset.y);
      setWorkflow((prev) =>
        prev
          ? {
              ...prev,
              nodes: prev.nodes.map((n) =>
                n.id === draggingNodeId
                  ? { ...n, position_x: newX, position_y: newY }
                  : n,
              ),
            }
          : prev,
      );
    }
  };

  const handleSvgMouseUp = async (e: React.MouseEvent) => {
    if (draggingNodeId && workflow) {
      const node = workflow.nodes.find((n) => n.id === draggingNodeId);
      if (node) {
        // Persist position to backend
        try {
          await workflowApi.updateNode(draggingNodeId, {
            position_x: node.position_x,
            position_y: node.position_y,
          });
        } catch {
          /* silent */
        }
      }
    }
    setDraggingNodeId(null);

    if (connectingFrom) {
      // Check if mouse is over any node
      const pt = getSvgPoint(e.clientX, e.clientY);
      const targetNode = workflow?.nodes.find(
        (n) =>
          pt.x >= n.position_x &&
          pt.x <= n.position_x + NODE_W &&
          pt.y >= n.position_y &&
          pt.y <= n.position_y + NODE_H,
      );
      if (targetNode) {
        finishConnection(targetNode.id);
      } else {
        setConnectingFrom(null);
      }
    }
  };

  const handleCanvasClick = () => {
    if (!draggingNodeId && !connectingFrom) {
      setSelectedNodeId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const selectedNode = workflow?.nodes.find((n) => n.id === selectedNodeId);

  const renderNode = (node: WfNode) => {
    const color = NODE_COLORS[node.node_type] || '#94a3b8';
    const isSelected = node.id === selectedNodeId;
    const paletteItem = NODE_PALETTE.find((p) => p.type === node.node_type);

    return (
      <g
        key={node.id}
        transform={`translate(${node.position_x}, ${node.position_y})`}
        onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
        style={{ cursor: draggingNodeId === node.id ? 'grabbing' : 'grab' }}
      >
        {/* Node body */}
        <rect
          width={NODE_W}
          height={NODE_H}
          rx={16}
          ry={16}
          fill="var(--md-sys-color-surface-container, #f3f3f3)"
          stroke={isSelected ? color : 'var(--md-sys-color-outline-variant, #c4c7c5)'}
          strokeWidth={isSelected ? 2.5 : 1}
        />
        {/* Color indicator bar */}
        <rect
          x={0}
          y={0}
          width={6}
          height={NODE_H}
          rx={3}
          fill={color}
        />
        {/* Icon */}
        {paletteItem && (
          <svg x={16} y={(NODE_H - 20) / 2} width={20} height={20} viewBox="0 0 24 24">
            <path d={paletteItem.icon} fill={color} />
          </svg>
        )}
        {/* Label */}
        <text
          x={44}
          y={NODE_H / 2}
          dominantBaseline="central"
          fontSize={13}
          fontFamily="'Roboto', sans-serif"
          fill="var(--md-sys-color-on-surface, #1d1b20)"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {node.label.length > 10 ? node.label.slice(0, 10) + '...' : node.label}
        </text>
        {/* Connection point (right side) */}
        <circle
          cx={NODE_W}
          cy={NODE_H / 2}
          r={6}
          fill={connectingFrom === node.id ? color : 'white'}
          stroke={color}
          strokeWidth={2}
          style={{ cursor: 'crosshair' }}
        />
        {/* Connection point (left side) */}
        <circle
          cx={0}
          cy={NODE_H / 2}
          r={6}
          fill="white"
          stroke={color}
          strokeWidth={2}
          style={{ cursor: 'crosshair' }}
        />
      </g>
    );
  };

  const renderEdge = (edge: WfEdge) => {
    const src = workflow?.nodes.find((n) => n.id === edge.source_node_id);
    const tgt = workflow?.nodes.find((n) => n.id === edge.target_node_id);
    if (!src || !tgt) return null;

    const x1 = src.position_x + NODE_W;
    const y1 = src.position_y + NODE_H / 2;
    const x2 = tgt.position_x;
    const y2 = tgt.position_y + NODE_H / 2;

    return (
      <g key={edge.id}>
        {/* Clickable wider invisible path for easier selection */}
        <path
          d={bezierPath(x1, y1, x2, y2)}
          fill="none"
          stroke="transparent"
          strokeWidth={12}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            if (window.confirm('删除此连线？')) handleDeleteEdge(edge.id);
          }}
        />
        <path
          d={bezierPath(x1, y1, x2, y2)}
          fill="none"
          stroke="var(--md-sys-color-outline, #79747e)"
          strokeWidth={2}
          markerEnd="url(#arrowhead)"
          style={{ pointerEvents: 'none' }}
        />
        {/* Condition label */}
        {edge.condition && (
          <text
            x={(x1 + x2) / 2}
            y={(y1 + y2) / 2 - 8}
            textAnchor="middle"
            fontSize={11}
            fill="var(--md-sys-color-on-surface-variant, #49454f)"
            fontFamily="'Roboto', sans-serif"
          >
            {typeof edge.condition === 'object'
              ? edge.condition.branch || 'cond'
              : String(edge.condition).slice(0, 20)}
          </text>
        )}
      </g>
    );
  };

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div className="h-full flex flex-col font-roboto">
      {/* Page header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="title-large text-on-surface">工作流设计器</h2>
          <p className="body-medium text-on-surface-variant mt-1">
            拖拽节点构建工作流，连线定义执行顺序
          </p>
        </div>
        <div className="flex gap-2">
          {creating ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="px-3 py-2 rounded-xl border border-outline bg-surface text-on-surface body-medium focus:outline-none focus:border-primary"
                placeholder="工作流名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkflow()}
                autoFocus
              />
              <Button variant="filled" onClick={handleCreateWorkflow}>
                确定
              </Button>
              <Button
                variant="text"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                }}
              >
                取消
              </Button>
            </div>
          ) : (
            <Button variant="filled" onClick={() => setCreating(true)}>
              新建工作流
            </Button>
          )}
        </div>
      </div>

      {/* Workflow selector tabs */}
      {workflows.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {workflows.map((wf) => (
            <button
              key={wf.id}
              type="button"
              onClick={() => loadWorkflow(wf.id)}
              className={`px-4 py-2 rounded-xl label-medium whitespace-nowrap transition-colors ${
                currentId === wf.id
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {wf.name}
            </button>
          ))}
        </div>
      )}

      {/* Main content area */}
      {!workflow ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-surface-container-high flex items-center justify-center mb-4">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                className="text-on-surface-variant/40"
              >
                <path
                  d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <p className="title-medium text-on-surface mb-2">
              {workflows.length === 0 ? '暂无工作流' : '选择一个工作流'}
            </p>
            <p className="body-medium text-on-surface-variant">
              {workflows.length === 0
                ? '点击"新建工作流"开始创建'
                : '点击上方标签查看或编辑'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex gap-4 overflow-hidden">
          {/* Left sidebar - Node palette */}
          <div className="w-48 shrink-0 flex flex-col gap-2">
            <p className="label-large text-on-surface mb-1">节点面板</p>
            {NODE_PALETTE.map((item) => (
              <button
                key={item.type}
                type="button"
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors text-left"
                onClick={() => handleAddNode(item.type, item.label)}
              >
                <svg width={20} height={20} viewBox="0 0 24 24">
                  <path d={item.icon} fill={item.color} />
                </svg>
                <span className="label-medium text-on-surface">{item.label}</span>
              </button>
            ))}

            <div className="mt-auto flex flex-col gap-2">
              <Button variant="outlined" onClick={handleValidate} disabled={!currentId}>
                验证
              </Button>
              <Button
                variant="tonal"
                onClick={handleExecute}
                disabled={!currentId || executing}
              >
                {executing ? '执行中...' : '执行'}
              </Button>
              <Button variant="text" onClick={handleDeleteWorkflow} disabled={!currentId}>
                删除工作流
              </Button>
            </div>
          </div>

          {/* Center - SVG canvas */}
          <div className="flex-1 rounded-2xl border border-outline-variant bg-surface-container-lowest overflow-hidden relative">
            <svg
              ref={svgRef}
              className="w-full h-full"
              onMouseMove={handleSvgMouseMove}
              onMouseUp={handleSvgMouseUp}
              onClick={handleCanvasClick}
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3.5, 0 7"
                    fill="var(--md-sys-color-outline, #79747e)"
                  />
                </marker>
                {/* Grid pattern */}
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path
                    d="M 20 0 L 0 0 0 20"
                    fill="none"
                    stroke="var(--md-sys-color-outline-variant, #c4c7c5)"
                    strokeWidth="0.3"
                  />
                </pattern>
              </defs>

              {/* Background grid */}
              <rect width="100%" height="100%" fill="url(#grid)" />

              {/* Edges */}
              {workflow.edges.map(renderEdge)}

              {/* Connection preview line */}
              {connectingFrom && (() => {
                const src = workflow.nodes.find((n) => n.id === connectingFrom);
                if (!src) return null;
                return (
                  <path
                    d={bezierPath(
                      src.position_x + NODE_W,
                      src.position_y + NODE_H / 2,
                      mousePos.x,
                      mousePos.y,
                    )}
                    fill="none"
                    stroke="var(--md-sys-color-primary, #6750a4)"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    style={{ pointerEvents: 'none' }}
                  />
                );
              })()}

              {/* Nodes */}
              {workflow.nodes.map(renderNode)}
            </svg>

            {/* Canvas hint when empty */}
            {workflow.nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="body-large text-on-surface-variant/50">
                  点击左侧面板添加节点
                </p>
              </div>
            )}
          </div>

          {/* Right sidebar - Node properties */}
          <div className="w-64 shrink-0 overflow-y-auto">
            {selectedNode ? (
              <div className="flex flex-col gap-4">
                <p className="label-large text-on-surface">节点属性</p>

                {/* Type badge */}
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor:
                        NODE_COLORS[selectedNode.node_type] || '#94a3b8',
                    }}
                  />
                  <span className="label-medium text-on-surface-variant">
                    {NODE_PALETTE.find((p) => p.type === selectedNode.node_type)?.label ||
                      selectedNode.node_type}
                  </span>
                </div>

                {/* Label */}
                <div>
                  <label className="label-small text-on-surface-variant block mb-1">
                    标签
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface body-medium focus:outline-none focus:border-primary"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                  />
                </div>

                {/* Persona task config */}
                {selectedNode.node_type === 'persona_task' && (
                  <>
                    <div>
                      <label className="label-small text-on-surface-variant block mb-1">
                        人设 ID
                      </label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface body-medium focus:outline-none focus:border-primary"
                        value={editPersonaId}
                        onChange={(e) => setEditPersonaId(e.target.value)}
                        placeholder="输入 Persona ID"
                      />
                    </div>
                    <div>
                      <label className="label-small text-on-surface-variant block mb-1">
                        任务提示词
                      </label>
                      <textarea
                        className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface body-medium focus:outline-none focus:border-primary resize-none"
                        rows={4}
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        placeholder="描述任务内容..."
                      />
                    </div>
                  </>
                )}

                {/* Condition config */}
                {selectedNode.node_type === 'condition' && (
                  <div>
                    <label className="label-small text-on-surface-variant block mb-1">
                      条件表达式
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 rounded-xl border border-outline-variant bg-surface text-on-surface body-medium focus:outline-none focus:border-primary"
                      value={editExpression}
                      onChange={(e) => setEditExpression(e.target.value)}
                      placeholder="node_id.status == completed"
                    />
                  </div>
                )}

                {/* Position info */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="label-small text-on-surface-variant block mb-1">
                      X
                    </label>
                    <span className="body-small text-on-surface">
                      {Math.round(selectedNode.position_x)}
                    </span>
                  </div>
                  <div className="flex-1">
                    <label className="label-small text-on-surface-variant block mb-1">
                      Y
                    </label>
                    <span className="body-small text-on-surface">
                      {Math.round(selectedNode.position_y)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 mt-2">
                  <Button variant="tonal" onClick={handleSaveNodeProps}>
                    保存属性
                  </Button>
                  <Button variant="text" onClick={handleDeleteNode}>
                    删除节点
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="body-medium text-on-surface-variant">
                  点击节点查看属性
                </p>
                <p className="body-small text-on-surface-variant/60 mt-1">
                  从节点右侧圆点拖拽可创建连线
                </p>
              </div>
            )}

            {/* Execution result panel */}
            {executionResult && (
              <div className="mt-6 border-t border-outline-variant pt-4">
                <p className="label-large text-on-surface mb-2">执行结果</p>
                <div
                  className={`px-3 py-2 rounded-xl body-small ${
                    executionResult.status === 'completed'
                      ? 'bg-tertiary-container text-on-tertiary-container'
                      : 'bg-error-container text-on-error-container'
                  }`}
                >
                  <p className="label-medium mb-1">
                    状态: {executionResult.status}
                  </p>
                  {executionResult.errors?.map((err: string, i: number) => (
                    <p key={i} className="body-small">
                      {err}
                    </p>
                  ))}
                  {executionResult.results?.map((r: any, i: number) => (
                    <div
                      key={i}
                      className="mt-1 pt-1 border-t border-current/10"
                    >
                      <p className="label-small">{r.label}</p>
                      <p className="body-small opacity-80">
                        {r.result?.message || r.result?.output || JSON.stringify(r.result).slice(0, 100)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Snackbar */}
      <Snackbar
        message={snack.message}
        open={snack.open}
        onClose={() => setSnack({ ...snack, open: false })}
      />
    </div>
  );
};

export default WorkflowView;
