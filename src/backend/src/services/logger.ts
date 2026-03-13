/**
 * 统一日志模块
 *
 * 基于 pino 提供结构化日志，同时输出到 stdout 和日志文件。
 * 生产环境日志文件位于 data/logs/，开发环境使用 pino-pretty 格式化输出。
 */
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// 日志目录：后端 data/logs/
const LOG_DIR = path.resolve(__dirname, '..', '..', 'data', 'logs');

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function createLogger(): pino.Logger {
  ensureLogDir();

  const logFilePath = path.join(LOG_DIR, 'app.log');

  if (IS_PRODUCTION) {
    // 生产环境：JSON 格式同时输出到 stdout 和文件
    const streams: pino.StreamEntry[] = [
      { level: LOG_LEVEL as pino.Level, stream: process.stdout },
      { level: LOG_LEVEL as pino.Level, stream: pino.destination(logFilePath) },
    ];

    return pino(
      {
        level: LOG_LEVEL,
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level(label) {
            return { level: label };
          },
        },
      },
      pino.multistream(streams)
    );
  }

  // 开发环境：pino-pretty 格式化 + 文件
  const streams: pino.StreamEntry[] = [
    {
      level: LOG_LEVEL as pino.Level,
      stream: pino.destination(logFilePath),
    },
  ];

  // 尝试加载 pino-pretty，开发环境美化输出
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pretty = require('pino-pretty');
    streams.unshift({
      level: LOG_LEVEL as pino.Level,
      stream: pretty({
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      }),
    });
  } catch {
    streams.unshift({
      level: LOG_LEVEL as pino.Level,
      stream: process.stdout,
    });
  }

  return pino(
    {
      level: LOG_LEVEL,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    },
    pino.multistream(streams)
  );
}

/** 应用全局 logger 实例 */
export const logger = createLogger();

/** 创建带模块前缀的子 logger */
export function createChildLogger(module: string): pino.Logger {
  return logger.child({ module });
}
