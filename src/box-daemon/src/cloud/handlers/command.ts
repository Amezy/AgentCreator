import { CloudErrorCode, CommandPayload, makeResponse, nowUnix } from '../types';
import { insertCommandLog, getCommandLog, updateCommandStatus } from '../store/command-log';
import { createManagedUser, updateManagedUserStatus, getManagedUser } from '../store/managed-users';
import {
  validateUsername,
  createUser,
  deleteUser,
  resetPassword,
  disableUser,
  enableUser,
} from '../executor/user';

type SendFn = (data: object) => void;

/**
 * Handles command.request from cloud.
 * Supports idempotency via command_log and timeout control.
 */
export class CommandHandler {
  constructor(
    private readonly boxId: string,
    private readonly send: SendFn,
    private readonly defaultTimeout = 30000,
  ) {}

  /** Handle incoming command.request message */
  async handle(message: Record<string, unknown>): Promise<void> {
    const msgId = message.id as string;
    const payload = message.payload as CommandPayload;
    const { cmd_id, cmd_type, timeout: timeoutSec, data } = payload;

    // Validate required fields
    if (!cmd_id || !cmd_type) {
      this.sendResponse(msgId, cmd_id || '', CloudErrorCode.COMMAND_INVALID_PARAMS, 'missing cmd_id or cmd_type');
      return;
    }

    const timeoutMs = (timeoutSec || 30) * 1000;

    // Idempotency check: if command already succeeded, return cached response
    const existing = getCommandLog(cmd_id);
    if (existing && existing.status === 'success' && existing.response) {
      console.log(`[Cloud] Command ${cmd_id} already succeeded, returning cached response`);
      const cachedData = JSON.parse(existing.response);
      this.sendResponse(msgId, cmd_id, CloudErrorCode.SUCCESS, 'success (cached)', cachedData);
      return;
    }

    // Insert command log (INSERT OR IGNORE if already exists from a prior attempt)
    if (!existing) {
      insertCommandLog(cmd_id, cmd_type, data);
    }

    // Mark as executing
    updateCommandStatus(cmd_id, 'executing');

    // Execute with timeout (using AbortController-like pattern to clean up timer)
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      const result = await Promise.race([
        this.executeCommand(cmd_type, data, cmd_id),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(Object.assign(new Error(`Command timed out after ${timeoutMs}ms`), { classification: 'TIMEOUT' }));
          }, timeoutMs);
        }),
      ]);

      // Success — clear timeout timer
      if (timeoutHandle) clearTimeout(timeoutHandle);

      updateCommandStatus(cmd_id, 'success', result);
      this.sendResponse(msgId, cmd_id, CloudErrorCode.SUCCESS, 'success', result);
    } catch (err: any) {
      // Clear timeout timer on error too
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const { code, message: errMsg } = this.classifyError(err, cmd_type);
      const status = code === CloudErrorCode.COMMAND_TIMEOUT ? 'timeout' : 'failed';
      updateCommandStatus(cmd_id, status, undefined, errMsg);
      this.sendResponse(msgId, cmd_id, code, errMsg);
    }
  }

  /** Execute a command by type */
  private async executeCommand(cmdType: string, data: Record<string, unknown>, cmdId: string): Promise<Record<string, unknown>> {
    const username = data.username as string;

    switch (cmdType) {
      case 'user.create': {
        if (!validateUsername(username)) {
          throw Object.assign(new Error(`Invalid username: ${username}`), { classification: 'USERNAME_INVALID' });
        }
        // Check if user already exists in managed_users (matches Python logic)
        const existingUser = getManagedUser(username);
        if (existingUser && existingUser.status !== 'deleted') {
          throw Object.assign(new Error(`User already exists: ${username}`), { classification: 'USER_EXISTS' });
        }
        const result = await createUser(username, data.password_hash as string);
        createManagedUser(username, result.uid);
        return result as unknown as Record<string, unknown>;
      }

      case 'user.delete': {
        if (!validateUsername(username)) {
          throw Object.assign(new Error(`Invalid username: ${username}`), { classification: 'USERNAME_INVALID' });
        }
        const removeHome = (data.remove_home as boolean) ?? false;
        const result = await deleteUser(username, removeHome);
        updateManagedUserStatus(username, 'deleted');
        return result as unknown as Record<string, unknown>;
      }

      case 'user.reset_password': {
        if (!validateUsername(username)) {
          throw Object.assign(new Error(`Invalid username: ${username}`), { classification: 'USERNAME_INVALID' });
        }
        const result = await resetPassword(username, data.password_hash as string);
        return result as unknown as Record<string, unknown>;
      }

      case 'user.disable': {
        if (!validateUsername(username)) {
          throw Object.assign(new Error(`Invalid username: ${username}`), { classification: 'USERNAME_INVALID' });
        }
        const result = await disableUser(username);
        updateManagedUserStatus(username, 'disabled');
        return result as unknown as Record<string, unknown>;
      }

      case 'user.enable': {
        if (!validateUsername(username)) {
          throw Object.assign(new Error(`Invalid username: ${username}`), { classification: 'USERNAME_INVALID' });
        }
        const result = await enableUser(username);
        updateManagedUserStatus(username, 'active');
        return result as unknown as Record<string, unknown>;
      }

      default:
        throw Object.assign(new Error(`Unknown command type: ${cmdType}`), { classification: 'COMMAND_FAILED' });
    }
  }

  /** Classify an error into a cloud error code */
  private classifyError(err: any, cmdType: string): { code: number; message: string } {
    const errMsg = err.stderr || err.message || String(err);

    if (err.classification === 'TIMEOUT') {
      return { code: CloudErrorCode.COMMAND_TIMEOUT, message: errMsg };
    }

    if (err.classification === 'USERNAME_INVALID') {
      return { code: CloudErrorCode.USERNAME_INVALID, message: errMsg };
    }

    if (err.classification === 'USER_EXISTS') {
      return { code: CloudErrorCode.USER_EXISTS, message: errMsg };
    }

    // Detect specific user operation errors from system command output
    if (cmdType.startsWith('user.')) {
      const lower = errMsg.toLowerCase();
      if (lower.includes('already exists') || lower.includes('已存在')) {
        return { code: CloudErrorCode.USER_EXISTS, message: 'User already exists' };
      }
      if (lower.includes('does not exist') || lower.includes('不存在') || lower.includes('no such user')) {
        return { code: CloudErrorCode.USER_NOT_FOUND, message: 'User not found' };
      }
      if (lower.includes('invalid username')) {
        return { code: CloudErrorCode.USERNAME_INVALID, message: errMsg };
      }
    }

    return { code: CloudErrorCode.COMMAND_FAILED, message: errMsg };
  }

  /** Send command response back to cloud */
  private sendResponse(
    refId: string,
    cmdId: string,
    code: number,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const payload: Record<string, unknown> = { cmd_id: cmdId };
    if (data) {
      payload.data = data;
    }
    const resp = makeResponse('command.response', refId, this.boxId, code, message, payload);
    this.send(resp);
  }
}
