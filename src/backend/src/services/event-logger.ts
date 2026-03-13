/**
 * 系统事件记录器
 *
 * 提供统一的系统事件记录功能，将事件写入 system_events 表。
 * 被 daemon、agent-manager、llm-gateway 等多个服务共同使用。
 */
import { getDb } from '../db/connection';
import { createChildLogger } from './logger';

const log = createChildLogger('EventLogger');

/**
 * 向 system_events 表中插入一条系统事件记录。
 *
 * @param eventType   - 事件类型（如 agent_start、resource_alert 等）
 * @param agentId     - 关联的 Agent 实例 ID，无关联时传 null
 * @param severity    - 严重级别：info | warn | error | critical
 * @param message     - 事件描述信息
 * @param metadataJson - 可选的 JSON 格式元数据
 * @param logTag      - 日志标签，用于错误输出时标识来源模块
 */
export function recordSystemEvent(
  eventType: string,
  agentId: number | null,
  severity: string,
  message: string,
  metadataJson?: string,
  logTag: string = 'EventLogger'
): void {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO system_events (event_type, agent_id, severity, message, metadata_json) VALUES (?, ?, ?, ?, ?)'
    ).run(eventType, agentId, severity, message, metadataJson || null);
  } catch (err) {
    log.error({ logTag, err }, 'Failed to record system event');
  }
}
