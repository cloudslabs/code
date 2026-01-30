import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../logger.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(dataDir: string): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'cloudscode.db');
  logger.info({ dbPath }, 'Initializing database');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER DEFAULT (unixepoch())
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name)
  );

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      logger.info({ migration: migration.name }, 'Applying migration');
      db.exec(migration.sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);
    }
  }
}

const migrations = [
  {
    name: '001_initial',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        config TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        title TEXT,
        summary TEXT,
        status TEXT DEFAULT 'active',
        total_cost_usd REAL DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id),
        agent_type TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        parent_agent_id TEXT,
        result_summary TEXT,
        cost_usd REAL DEFAULT 0,
        tokens INTEGER DEFAULT 0,
        duration_ms INTEGER,
        started_at INTEGER DEFAULT (unixepoch()),
        completed_at INTEGER
      );

      CREATE TABLE memory_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        source_session_id TEXT,
        confidence REAL DEFAULT 1.0,
        use_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE VIRTUAL TABLE memory_fts USING fts5(
        key, content, category,
        content=memory_entries,
        content_rowid=rowid
      );

      CREATE TRIGGER memory_ai AFTER INSERT ON memory_entries BEGIN
        INSERT INTO memory_fts(rowid, key, content, category)
        VALUES (new.rowid, new.key, new.content, new.category);
      END;

      CREATE TRIGGER memory_ad AFTER DELETE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, key, content, category)
        VALUES ('delete', old.rowid, old.key, old.content, old.category);
      END;

      CREATE TRIGGER memory_au AFTER UPDATE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, key, content, category)
        VALUES ('delete', old.rowid, old.key, old.content, old.category);
        INSERT INTO memory_fts(rowid, key, content, category)
        VALUES (new.rowid, new.key, new.content, new.category);
      END;

      CREATE INDEX idx_sessions_project ON sessions(project_id);
      CREATE INDEX idx_sessions_status ON sessions(status);
      CREATE INDEX idx_agent_runs_session ON agent_runs(session_id);
      CREATE INDEX idx_memory_project ON memory_entries(project_id);
      CREATE INDEX idx_memory_category ON memory_entries(project_id, category);
    `,
  },
  {
    name: '002_settings',
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch())
      );
    `,
  },
  {
    name: '003_messages',
    sql: `
      ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT;

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_id TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX idx_messages_session ON messages(session_id);
    `,
  },
  {
    name: '004_rename_to_projects',
    sql: `
      -- =================================================================
      -- Migration: Rename sessions → projects, projects → workspaces
      -- =================================================================
      -- SQLite doesn't support RENAME COLUMN before 3.25 and doesn't
      -- support ALTER TABLE ... RENAME COLUMN for all cases.
      -- We use the safe CREATE+INSERT+DROP+RENAME pattern.
      -- =================================================================

      -- Temporarily disable foreign keys for migration
      PRAGMA foreign_keys = OFF;

      -- -----------------------------------------------------------------
      -- Step 1: Rename projects → workspaces
      -- -----------------------------------------------------------------
      ALTER TABLE projects RENAME TO workspaces;

      -- -----------------------------------------------------------------
      -- Step 2: Recreate sessions as projects with renamed columns
      -- -----------------------------------------------------------------
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(id),
        title TEXT,
        summary TEXT,
        status TEXT DEFAULT 'active',
        total_cost_usd REAL DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        sdk_session_id TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        -- New rich metadata fields
        metadata TEXT DEFAULT '{}',
        description TEXT,
        purpose TEXT,
        repository_url TEXT,
        primary_language TEXT,
        architecture_pattern TEXT
      );

      INSERT INTO projects (id, workspace_id, title, summary, status, total_cost_usd, total_tokens, sdk_session_id, created_at, updated_at)
        SELECT id, project_id, title, summary, status, total_cost_usd, total_tokens, sdk_session_id, created_at, updated_at
        FROM sessions;

      DROP TABLE sessions;

      -- -----------------------------------------------------------------
      -- Step 3: Recreate messages with project_id column
      -- -----------------------------------------------------------------
      CREATE TABLE messages_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_id TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      INSERT INTO messages_new (id, project_id, role, content, agent_id, created_at)
        SELECT id, session_id, role, content, agent_id, created_at
        FROM messages;

      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;

      -- -----------------------------------------------------------------
      -- Step 4: Recreate agent_runs with project_id column
      -- -----------------------------------------------------------------
      CREATE TABLE agent_runs_new (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        agent_type TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        parent_agent_id TEXT,
        result_summary TEXT,
        cost_usd REAL DEFAULT 0,
        tokens INTEGER DEFAULT 0,
        duration_ms INTEGER,
        started_at INTEGER DEFAULT (unixepoch()),
        completed_at INTEGER
      );

      INSERT INTO agent_runs_new (id, project_id, agent_type, status, parent_agent_id, result_summary, cost_usd, tokens, duration_ms, started_at, completed_at)
        SELECT id, session_id, agent_type, status, parent_agent_id, result_summary, cost_usd, tokens, duration_ms, started_at, completed_at
        FROM agent_runs;

      DROP TABLE agent_runs;
      ALTER TABLE agent_runs_new RENAME TO agent_runs;

      -- -----------------------------------------------------------------
      -- Step 5: Recreate memory_entries with workspace_id and source_project_id
      -- -----------------------------------------------------------------
      -- Drop FTS triggers first
      DROP TRIGGER IF EXISTS memory_ai;
      DROP TRIGGER IF EXISTS memory_ad;
      DROP TRIGGER IF EXISTS memory_au;

      CREATE TABLE memory_entries_new (
        id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(id),
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        source_project_id TEXT,
        confidence REAL DEFAULT 1.0,
        use_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );

      INSERT INTO memory_entries_new (id, workspace_id, category, key, content, source_project_id, confidence, use_count, created_at, updated_at)
        SELECT id, project_id, category, key, content, source_session_id, confidence, use_count, created_at, updated_at
        FROM memory_entries;

      -- Drop FTS table and old table
      DROP TABLE memory_fts;
      DROP TABLE memory_entries;
      ALTER TABLE memory_entries_new RENAME TO memory_entries;

      -- Recreate FTS
      CREATE VIRTUAL TABLE memory_fts USING fts5(
        key, content, category,
        content=memory_entries,
        content_rowid=rowid
      );

      -- Re-populate FTS from existing data
      INSERT INTO memory_fts(rowid, key, content, category)
        SELECT rowid, key, content, category FROM memory_entries;

      -- Recreate FTS triggers
      CREATE TRIGGER memory_ai AFTER INSERT ON memory_entries BEGIN
        INSERT INTO memory_fts(rowid, key, content, category)
        VALUES (new.rowid, new.key, new.content, new.category);
      END;

      CREATE TRIGGER memory_ad AFTER DELETE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, key, content, category)
        VALUES ('delete', old.rowid, old.key, old.content, old.category);
      END;

      CREATE TRIGGER memory_au AFTER UPDATE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, key, content, category)
        VALUES ('delete', old.rowid, old.key, old.content, old.category);
        INSERT INTO memory_fts(rowid, key, content, category)
        VALUES (new.rowid, new.key, new.content, new.category);
      END;

      -- -----------------------------------------------------------------
      -- Step 6: Recreate indexes with new names
      -- -----------------------------------------------------------------
      CREATE INDEX idx_projects_workspace ON projects(workspace_id);
      CREATE INDEX idx_projects_status ON projects(status);
      CREATE INDEX idx_agent_runs_project ON agent_runs(project_id);
      CREATE INDEX idx_messages_project ON messages(project_id);
      CREATE INDEX idx_memory_workspace ON memory_entries(workspace_id);
      CREATE INDEX idx_memory_category ON memory_entries(workspace_id, category);

      -- Re-enable foreign keys
      PRAGMA foreign_keys = ON;
    `,
  },
  {
    name: '005_project_setup',
    sql: `
      ALTER TABLE projects ADD COLUMN directory_path TEXT;
      ALTER TABLE projects ADD COLUMN setup_completed INTEGER DEFAULT 1;
    `,
  },
  {
    name: '006_tool_calls',
    sql: `
      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL DEFAULT '{}',
        output TEXT,
        status TEXT DEFAULT 'running',
        duration_ms INTEGER,
        started_at INTEGER DEFAULT (unixepoch()),
        completed_at INTEGER
      );
      CREATE INDEX idx_tool_calls_project ON tool_calls(project_id);
      CREATE INDEX idx_tool_calls_agent ON tool_calls(agent_id);
    `,
  },
  {
    name: '007_agent_task_description',
    sql: `
      ALTER TABLE agent_runs ADD COLUMN task_description TEXT;
    `,
  },
  {
    name: '008_agent_model',
    sql: `
      ALTER TABLE agent_runs ADD COLUMN model TEXT;
    `,
  },
  {
    name: '009_agent_response_text',
    sql: `
      ALTER TABLE agent_runs ADD COLUMN response_text TEXT;
    `,
  },
  {
    name: '010_agent_context_sections',
    sql: `
      ALTER TABLE agent_runs ADD COLUMN context_sections TEXT;
    `,
  },
  {
    name: '011_memory_scope',
    sql: `
      ALTER TABLE memory_entries ADD COLUMN scope TEXT NOT NULL DEFAULT 'workspace';
      CREATE INDEX idx_memory_scope ON memory_entries(workspace_id, scope);
      CREATE INDEX idx_memory_source_project ON memory_entries(source_project_id);
    `,
  },
  {
    name: '012_plans',
    sql: `
      CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        steps TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'drafting',
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX idx_plans_project ON plans(project_id);
      CREATE INDEX idx_plans_status ON plans(status);
    `,
  },
  {
    name: '013_users',
    sql: `
      -- Users table
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        avatar_url TEXT,
        subscription_type TEXT DEFAULT 'free',
        is_active INTEGER DEFAULT 1,
        is_admin INTEGER DEFAULT 0,
        last_login_at INTEGER,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );

      -- User sessions for authentication
      CREATE TABLE user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        token_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      );

      -- API keys for programmatic access
      CREATE TABLE user_api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        permissions TEXT DEFAULT '{}',
        is_active INTEGER DEFAULT 1,
        last_used_at INTEGER,
        expires_at INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      );

      -- Add user_id column to existing tables
      ALTER TABLE workspaces ADD COLUMN user_id TEXT REFERENCES users(id);
      ALTER TABLE projects ADD COLUMN user_id TEXT REFERENCES users(id);
      ALTER TABLE memory_entries ADD COLUMN user_id TEXT REFERENCES users(id);

      -- Create indexes
      CREATE INDEX idx_users_username ON users(username);
      CREATE INDEX idx_users_email ON users(email);
      CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
      CREATE INDEX idx_user_sessions_token ON user_sessions(token_hash);
      CREATE INDEX idx_user_api_keys_user ON user_api_keys(user_id);
      CREATE INDEX idx_user_api_keys_key ON user_api_keys(key_hash);
      CREATE INDEX idx_workspaces_user ON workspaces(user_id);
      CREATE INDEX idx_projects_user ON projects(user_id);
      CREATE INDEX idx_memory_user ON memory_entries(user_id);
    `,
  },
  {
    name: '014_message_channel',
    sql: `
      ALTER TABLE messages ADD COLUMN channel TEXT DEFAULT 'chat';
      CREATE INDEX idx_messages_channel ON messages(project_id, channel);
    `,
  },
];

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}
