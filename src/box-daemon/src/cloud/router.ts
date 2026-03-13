type MessageHandler = (message: Record<string, unknown>) => void | Promise<void>;

/**
 * Routes incoming WebSocket messages to registered handlers by message type.
 */
export class MessageRouter {
  private handlers = new Map<string, MessageHandler>();

  /** Register a handler for a specific message type */
  on(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  /** Dispatch a message to its handler */
  async dispatch(message: Record<string, unknown>): Promise<boolean> {
    const type = message.type as string;
    console.log(`[Cloud] Received message type=${type}`, JSON.stringify(message).substring(0, 500));
    if (!type) {
      console.warn('[Cloud] Received message without type field');
      return false;
    }

    const handler = this.handlers.get(type);
    if (!handler) {
      console.warn(`[Cloud] No handler for message type: ${type}`);
      return false;
    }

    try {
      await handler(message);
      return true;
    } catch (err) {
      console.error(`[Cloud] Handler error for type ${type}:`, err);
      return false;
    }
  }
}
