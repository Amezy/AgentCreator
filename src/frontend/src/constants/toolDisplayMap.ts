/**
 * 工具场景化展示映射表
 * 将技术 ID 映射为非技术用户友好的描述
 */

export interface ToolDisplayInfo {
  label: string;
  icon: string;
  category: string;
  description: string;
}

export const TOOL_DISPLAY_MAP: Record<string, ToolDisplayInfo> = {
  read:       { label: '阅读文件', icon: '📖', category: '📁 文件处理', description: '读取文件内容' },
  edit:       { label: '编辑文件', icon: '✏️', category: '📁 文件处理', description: '修改已有文件' },
  write:      { label: '创建文件', icon: '📝', category: '📁 文件处理', description: '创建新文件' },
  ls:         { label: '浏览目录', icon: '📂', category: '📁 文件处理', description: '查看目录结构' },
  glob:       { label: '查找文件', icon: '🔎', category: '📁 文件处理', description: '按名称模式查找文件' },
  grep:       { label: '搜索内容', icon: '🔎', category: '🔍 信息检索', description: '在文件中搜索关键词' },
  codesearch: { label: '代码搜索', icon: '💡', category: '🔍 信息检索', description: '语义化代码搜索' },
  bash:       { label: '运行命令', icon: '⚡', category: '⚡ 执行操作', description: '执行终端命令' },
  webfetch:   { label: '访问网页', icon: '🌐', category: '🌐 网络访问', description: '获取网页内容' },
  websearch:  { label: '搜索网络', icon: '🔍', category: '🌐 网络访问', description: '搜索互联网信息' },
};

/** 按分类分组工具 */
export function groupToolsByCategory(toolIds: string[]): Record<string, { id: string; display: ToolDisplayInfo }[]> {
  const groups: Record<string, { id: string; display: ToolDisplayInfo }[]> = {};
  for (const id of toolIds) {
    const display = TOOL_DISPLAY_MAP[id];
    if (!display) continue;
    if (!groups[display.category]) {
      groups[display.category] = [];
    }
    groups[display.category].push({ id, display });
  }
  return groups;
}

/** 获取工具的展示信息，未知工具返回默认值 */
export function getToolDisplay(toolId: string): ToolDisplayInfo {
  return TOOL_DISPLAY_MAP[toolId] ?? {
    label: toolId,
    icon: '🔧',
    category: '🔧 其他',
    description: toolId,
  };
}
