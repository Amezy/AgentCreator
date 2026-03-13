import { cleanupOldCommands } from './store/command-log';
import { cleanupDeletedUsers } from './store/managed-users';

const COMMAND_RETENTION_DAYS = 30;
const USER_RETENTION_DAYS = 90;

/**
 * Periodic cleanup: removes old command logs and deleted user records.
 * Should be called once every 24 hours.
 */
export function runCleanup(): void {
  try {
    const cmds = cleanupOldCommands(COMMAND_RETENTION_DAYS);
    const users = cleanupDeletedUsers(USER_RETENTION_DAYS);
    if (cmds > 0 || users > 0) {
      console.log(`[Cloud] Cleanup: removed ${cmds} old commands, ${users} deleted users`);
    }
  } catch (err) {
    console.error('[Cloud] Cleanup error:', err);
  }
}

/** Start a 24-hour cleanup interval, returns the timer handle */
export function startCleanupSchedule(): ReturnType<typeof setInterval> {
  // Run once immediately
  runCleanup();
  // Then every 24 hours
  return setInterval(runCleanup, 24 * 60 * 60 * 1000);
}
