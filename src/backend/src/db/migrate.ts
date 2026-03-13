import Database from 'better-sqlite3';

interface Migration {
  id: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    id: '001-pam-migration',
    up: (db) => {
      // Check if password_hash column exists
      const tableInfo = db.pragma('table_info(users)') as { name: string }[];
      const hasPasswordHash = tableInfo.some(col => col.name === 'password_hash');

      if (hasPasswordHash) {
        // SQLite copy-table migration to remove password_hash
        db.exec(`
          CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'programmer' CHECK(role IN ('super_admin', 'admin', 'programmer')),
            box_id TEXT DEFAULT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO users_new (id, username, role, is_active, created_at, updated_at)
            SELECT id, username, role, is_active, created_at, updated_at FROM users;
          DROP TABLE users;
          ALTER TABLE users_new RENAME TO users;
          CREATE UNIQUE INDEX idx_users_username ON users(username);
        `);
      }

      // Check if box_id column exists (in case table was created fresh)
      const tableInfo2 = db.pragma('table_info(users)') as { name: string }[];
      const hasBoxId = tableInfo2.some(col => col.name === 'box_id');
      if (!hasBoxId) {
        db.exec('ALTER TABLE users ADD COLUMN box_id TEXT DEFAULT NULL');
      }

      // Create user_ssh_keys table
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_ssh_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          key_type TEXT NOT NULL DEFAULT 'ssh-rsa',
          public_key TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          comment TEXT DEFAULT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ssh_keys_user ON user_ssh_keys(user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ssh_keys_fingerprint ON user_ssh_keys(fingerprint);
      `);

      // Add new indexes/constraints
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_model_creds_unique ON model_credentials(user_id, provider, model_name);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_superpowers_agent ON agent_superpowers(agent_instance_id);
        CREATE INDEX IF NOT EXISTS idx_events_agent ON system_events(agent_id);
      `);
    },
  },
  {
    id: '002-team-count-max-10',
    up: (db) => {
      // Recreate team_configs with relaxed CHECK constraints (1-10 instead of 1-3)
      const hasTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='team_configs'"
      ).get();
      if (!hasTable) return;

      db.exec(`
        CREATE TABLE team_configs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          config_name TEXT NOT NULL DEFAULT 'default',
          architect_count INTEGER NOT NULL DEFAULT 1 CHECK(architect_count = 1),
          frontend_count INTEGER NOT NULL DEFAULT 1 CHECK(frontend_count BETWEEN 1 AND 10),
          backend_count INTEGER NOT NULL DEFAULT 1 CHECK(backend_count BETWEEN 1 AND 10),
          reviewer_count INTEGER NOT NULL DEFAULT 1 CHECK(reviewer_count = 1),
          devops_count INTEGER NOT NULL DEFAULT 1 CHECK(devops_count = 1),
          architect_model_id INTEGER DEFAULT NULL,
          frontend_model_id INTEGER DEFAULT NULL,
          backend_model_id INTEGER DEFAULT NULL,
          reviewer_model_id INTEGER DEFAULT NULL,
          devops_model_id INTEGER DEFAULT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (architect_model_id) REFERENCES model_credentials(id) ON DELETE SET NULL,
          FOREIGN KEY (frontend_model_id) REFERENCES model_credentials(id) ON DELETE SET NULL,
          FOREIGN KEY (backend_model_id) REFERENCES model_credentials(id) ON DELETE SET NULL,
          FOREIGN KEY (reviewer_model_id) REFERENCES model_credentials(id) ON DELETE SET NULL,
          FOREIGN KEY (devops_model_id) REFERENCES model_credentials(id) ON DELETE SET NULL
        );
        INSERT INTO team_configs_new SELECT * FROM team_configs;
        DROP TABLE team_configs;
        ALTER TABLE team_configs_new RENAME TO team_configs;
        CREATE INDEX IF NOT EXISTS idx_team_configs_user ON team_configs(user_id);
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map(r => r.id)
  );

  for (const migration of migrations) {
    if (!applied.has(migration.id)) {
      console.log(`[Migration] Applying ${migration.id}...`);
      // PRAGMA foreign_keys must be set OUTSIDE any transaction
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(migration.id);
      })();
      db.pragma('foreign_keys = ON');
      console.log(`[Migration] Applied ${migration.id}`);
    }
  }
}
