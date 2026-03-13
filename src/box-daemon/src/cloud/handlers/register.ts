import { CloudErrorCode, nowUnix } from '../types';
import { setDeviceConfig } from '../store/device-config';

/**
 * Handles register.response from cloud.
 * On success (code=0), persists registration info to device_config.
 */
export class RegisterHandler {
  private _registered = false;
  private _resolve: (() => void) | null = null;
  private _reject: ((err: Error) => void) | null = null;

  /** Returns a promise that resolves when registration succeeds */
  waitForRegistration(): Promise<void> {
    if (this._registered) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  get isRegistered(): boolean {
    return this._registered;
  }

  /** Handle incoming register.response message */
  handle(message: Record<string, unknown>): void {
    console.log('[Cloud] register.response:', JSON.stringify(message));

    // Cloud may respond with either { code: 0 } or { success: true }
    const code = message.code as number | undefined;
    const success = message.success as boolean | undefined;
    const payload = message.payload as Record<string, unknown> | undefined;
    const isSuccess = success === true || code === CloudErrorCode.SUCCESS;

    if (isSuccess) {
      this._registered = true;
      const name = (payload?.name ?? message.name ?? message.boxId) as string | undefined;

      // Persist registration info
      setDeviceConfig('registered_at', String(nowUnix()));
      if (name) {
        setDeviceConfig('device_name', name);
      }

      console.log(`[Cloud] Registration successful${name ? ` (${name})` : ''}`);
      this._resolve?.();
    } else {
      const errMsg = (message.message as string) || `Registration failed with code ${code}`;
      console.error(`[Cloud] Registration failed: ${errMsg}`);
      this._reject?.(new Error(errMsg));
    }

    this._resolve = null;
    this._reject = null;
  }

  /** Reset state for reconnection */
  reset(): void {
    this._registered = false;
    this._resolve = null;
    this._reject = null;
  }
}
