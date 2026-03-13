import { getDb } from '../../db';

/** Get a config value by key */
export function getDeviceConfig(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM device_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Set a config value (upsert semantics) */
export function setDeviceConfig(key: string, value: string): void {
  getDb().prepare(
    'INSERT INTO device_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

/** Get all config as a Record */
export function getAllDeviceConfig(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM device_config').all() as Array<{ key: string; value: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
