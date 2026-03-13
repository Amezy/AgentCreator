/**
 * User SSH Key Routes
 *
 * Endpoints to manage SSH public keys for users.
 * Keys are stored in the database and deployed to the user's authorized_keys.
 */
import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db/connection';
import { authMiddleware } from '../middleware/auth';
import { deploySSHKey, removeSSHKey } from '../services/system-user';
import { User, UserSSHKey, AddSSHKeyBody, ApiResponse } from '../types';

/**
 * Parse an SSH public key string to extract type, fingerprint, and comment.
 */
function parseSSHPublicKey(
  publicKey: string
): { keyType: string; fingerprint: string; comment: string | null } | null {
  const trimmed = publicKey.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length < 2) return null;

  const keyType = parts[0];
  const validTypes = ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'];
  if (!validTypes.includes(keyType)) return null;

  const base64Part = parts[1];

  // Validate base64
  try {
    const decoded = Buffer.from(base64Part, 'base64');
    if (decoded.length === 0) return null;

    // Compute SHA256 fingerprint
    const hash = crypto.createHash('sha256').update(decoded).digest('base64');
    const fingerprint = `SHA256:${hash}`;

    const comment = parts.length > 2 ? parts.slice(2).join(' ') : null;

    return { keyType, fingerprint, comment };
  } catch {
    return null;
  }
}

export async function userSSHKeyRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/users/:id/ssh-keys
   * Add an SSH public key for a user. Admin or self.
   */
  fastify.post<{ Params: { id: string }; Body: AddSSHKeyBody }>(
    '/api/v1/users/:id/ssh-keys',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest<{ Params: { id: string }; Body: AddSSHKeyBody }>, reply: FastifyReply) => {
      const userId = parseInt(request.params.id, 10);
      if (isNaN(userId)) {
        return reply.code(400).send({ success: false, error: '无效的用户 ID' } as ApiResponse);
      }

      // Admin or self
      const isAdmin = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      if (!isAdmin && request.user!.userId !== userId) {
        return reply.code(403).send({ success: false, error: '无权操作' } as ApiResponse);
      }

      const { public_key } = request.body;
      if (!public_key || !public_key.trim()) {
        return reply.code(400).send({ success: false, error: '缺少公钥' } as ApiResponse);
      }

      // Parse the public key
      const parsed = parseSSHPublicKey(public_key);
      if (!parsed) {
        return reply.code(400).send({
          success: false,
          error: '无效的 SSH 公钥格式',
        } as ApiResponse);
      }

      const db = getDb();

      // Verify user exists
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
      if (!user) {
        return reply.code(404).send({ success: false, error: '用户不存在' } as ApiResponse);
      }

      // Check for duplicate fingerprint
      const existingKey = db
        .prepare('SELECT id FROM user_ssh_keys WHERE fingerprint = ?')
        .get(parsed.fingerprint);
      if (existingKey) {
        return reply.code(409).send({
          success: false,
          error: '该公钥已存在',
        } as ApiResponse);
      }

      // Insert into DB
      const result = db.prepare(
        'INSERT INTO user_ssh_keys (user_id, key_type, public_key, fingerprint, comment) VALUES (?, ?, ?, ?, ?)'
      ).run(userId, parsed.keyType, public_key.trim(), parsed.fingerprint, parsed.comment);

      // Deploy to authorized_keys
      const deployResult = await deploySSHKey(user.username, public_key);
      if (!deployResult.success) {
        // Rollback DB insert
        db.prepare('DELETE FROM user_ssh_keys WHERE id = ?').run(result.lastInsertRowid);
        return reply.code(500).send({
          success: false,
          error: `SSH 密钥部署失败: ${deployResult.error}`,
        } as ApiResponse);
      }

      const newKey = db
        .prepare('SELECT * FROM user_ssh_keys WHERE id = ?')
        .get(result.lastInsertRowid) as UserSSHKey;

      return reply.code(201).send({
        success: true,
        data: newKey,
        message: 'SSH 密钥添加成功',
      } as ApiResponse);
    }
  );

  /**
   * GET /api/v1/users/:id/ssh-keys
   * List all SSH keys for a user. Admin or self.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/users/:id/ssh-keys',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = parseInt(request.params.id, 10);
      if (isNaN(userId)) {
        return reply.code(400).send({ success: false, error: '无效的用户 ID' } as ApiResponse);
      }

      // Admin or self
      const isAdmin = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      if (!isAdmin && request.user!.userId !== userId) {
        return reply.code(403).send({ success: false, error: '无权访问' } as ApiResponse);
      }

      const db = getDb();
      const keys = db
        .prepare('SELECT * FROM user_ssh_keys WHERE user_id = ? ORDER BY id ASC')
        .all(userId) as UserSSHKey[];

      return reply.code(200).send({ success: true, data: keys } as ApiResponse);
    }
  );

  /**
   * DELETE /api/v1/users/:id/ssh-keys/:keyId
   * Remove an SSH key. Admin or self.
   */
  fastify.delete<{ Params: { id: string; keyId: string } }>(
    '/api/v1/users/:id/ssh-keys/:keyId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest<{ Params: { id: string; keyId: string } }>, reply: FastifyReply) => {
      const userId = parseInt(request.params.id, 10);
      const keyId = parseInt(request.params.keyId, 10);

      if (isNaN(userId) || isNaN(keyId)) {
        return reply.code(400).send({ success: false, error: '无效的 ID' } as ApiResponse);
      }

      // Admin or self
      const isAdmin = request.user!.role === 'admin' || request.user!.role === 'super_admin';
      if (!isAdmin && request.user!.userId !== userId) {
        return reply.code(403).send({ success: false, error: '无权操作' } as ApiResponse);
      }

      const db = getDb();

      // Verify the key belongs to this user
      const key = db
        .prepare('SELECT * FROM user_ssh_keys WHERE id = ? AND user_id = ?')
        .get(keyId, userId) as UserSSHKey | undefined;
      if (!key) {
        return reply.code(404).send({ success: false, error: 'SSH 密钥不存在' } as ApiResponse);
      }

      // Get the user for the username
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
      if (user) {
        // Remove from authorized_keys (best-effort)
        await removeSSHKey(user.username, key.public_key);
      }

      // Delete from DB
      db.prepare('DELETE FROM user_ssh_keys WHERE id = ?').run(keyId);

      return reply.code(200).send({
        success: true,
        message: 'SSH 密钥已删除',
      } as ApiResponse);
    }
  );
}
