/**
 * Centralized environment configuration with type-safe defaults.
 * All environment variables are read once at startup.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

export const CONFIG = Object.freeze({
  // Server
  PORT: parseInt(process.env.PORT || '3010', 10),
  WS_PORT: parseInt(process.env.WS_PORT || '3011', 10),
  HOST: process.env.HOST || '0.0.0.0',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
  JWT_EXPIRES_IN: '24h',

  // Daemon
  DAEMON_TOKEN: process.env.DAEMON_TOKEN || '',
  BOX_ID: process.env.BOX_ID || '',
  DAEMON_DB_PATH: process.env.AIBOX_DAEMON_DB_PATH || '/var/lib/aibox-daemon/aibox.db',

  // Linux user management
  LINUX_USER_ENABLED: process.env.AIBOX_LINUX_USER_ENABLED !== 'false',
  HOME_BASE: process.env.AIBOX_HOME_BASE || '/home',
  DEFAULT_SHELL: process.env.AIBOX_DEFAULT_SHELL || '/bin/bash',
  USER_GROUP: process.env.AIBOX_USER_GROUP || 'aibox',
  ADMIN_GROUP: process.env.AIBOX_ADMIN_GROUP || 'aibox-admin',
  PROCESS_USER: process.env.AIBOX_PROCESS_USER || 'boxsystem',
  SUDO_TIMEOUT_MS: parseInt(process.env.AIBOX_SUDO_TIMEOUT_MS || '10000', 10),

  // Factory defaults
  FACTORY_USER: process.env.AIBOX_FACTORY_USER || 'aiboxadmin',
  FACTORY_PASSWORD: process.env.AIBOX_FACTORY_PASSWORD || 'changeme123',

  // PAM authentication
  PAM_SERVICE: process.env.AIBOX_PAM_SERVICE || 'login',
  PAM_TIMEOUT_MS: parseInt(process.env.AIBOX_PAM_TIMEOUT_MS || '10000', 10),

  // VS Code Server
  VSCODE_ENABLED: process.env.AIBOX_VSCODE_ENABLED !== 'false',
  VSCODE_ASSETS_DIR: process.env.AIBOX_VSCODE_ASSETS_DIR
    || (fs.existsSync('/opt/aibox/vscode-server') ? '/opt/aibox/vscode-server' : path.join(__dirname, '..', '..', '..', '..', 'assets', 'vscode-server')),
  VSCODE_INSTALL_TIMEOUT_MS: parseInt(process.env.AIBOX_VSCODE_INSTALL_TIMEOUT_MS || '120000', 10),

  // Subagent (CLAUDE.md generation)
  SUBAGENT_ASSETS_DIR: process.env.AIBOX_SUBAGENT_ASSETS_DIR
    || (fs.existsSync('/opt/aibox/subagent') ? '/opt/aibox/subagent' : path.join(__dirname, '..', '..', '..', '..', 'assets', 'subagent')),

  // Deploy scripts (deploy.yaml generation)
  DEPLOY_ASSETS_DIR: process.env.AIBOX_DEPLOY_ASSETS_DIR
    || (fs.existsSync('/opt/aibox/deploy-scripts') ? '/opt/aibox/deploy-scripts' : path.join(__dirname, '..', '..', '..', '..', 'assets', 'deploy')),

  // Claude Auth (OAuth PKCE)
  CLAUDE_AUTH_ENABLED: process.env.AIBOX_CLAUDE_AUTH_ENABLED !== 'false',
  CLAUDE_AUTH_TIMEOUT_MS: parseInt(process.env.AIBOX_CLAUDE_AUTH_TIMEOUT_MS || '300000', 10),
  CLAUDE_AUTH_USER_AGENT: process.env.AIBOX_CLAUDE_AUTH_USER_AGENT || 'claude-code/2.0.0',
});
