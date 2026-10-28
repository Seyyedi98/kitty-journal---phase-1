// Versioned migrations. Each step runs once, inside a transaction, and bumps
// PRAGMA user_version. NEVER edit an old step — always append a new one.
// Step 1 matches the schema the app already shipped with, so existing
// installs (user_version = 0 but tables present) upgrade without data loss.

export const MIGRATIONS = [
  // v1 — baseline (entries + daily_moods)
  `
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    journal_date TEXT NOT NULL,
    mood TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(journal_date);
  CREATE TABLE IF NOT EXISTS daily_moods (
    journal_date TEXT PRIMARY KEY NOT NULL,
    mood TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // v2 — soft delete, pinned, content format version, tags, drafts
  `
  ALTER TABLE entries ADD COLUMN deleted_at TEXT;
  ALTER TABLE entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE entries ADD COLUMN content_format_version INTEGER NOT NULL DEFAULT 1;
  CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deleted_at);

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, tag_id)
  );
  CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

  -- One recoverable draft per editing session target.
  -- entry_id = 0 means "a brand-new entry that was never committed".
  CREATE TABLE IF NOT EXISTS drafts (
    entry_id INTEGER PRIMARY KEY NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    journal_date TEXT NOT NULL,
    mood TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );
  `,
  // v3 — persisted user preferences (language, calendar, appearance, ...)
  `
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // v4 — stable entry ids (for backup/merge), photo attachments, optional
  //      locations and secondary emotions.
  `
  ALTER TABLE entries ADD COLUMN uuid TEXT;
  UPDATE entries SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_uuid ON entries(uuid);

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    thumb_name TEXT,
    original_name TEXT,
    mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    captured_at TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id);

  -- One optional, explicitly chosen location per entry. Coordinates are
  -- nullable so a place may be saved by name only.
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE CASCADE,
    latitude REAL,
    longitude REAL,
    name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  -- Secondary emotions are stored by stable machine key, never by label.
  CREATE TABLE IF NOT EXISTS entry_emotions (
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    emotion_key TEXT NOT NULL,
    intensity INTEGER CHECK (intensity IS NULL OR (intensity BETWEEN 1 AND 5)),
    PRIMARY KEY (entry_id, emotion_key)
  );
  `,
  // v5 — rich text: sanitised HTML next to the plain-text body (body stays the
  // searchable plain text; content_format_version = 2 means body_html is valid)
  `
  ALTER TABLE entries ADD COLUMN body_html TEXT;
  `,
];

export const LATEST_VERSION = MIGRATIONS.length;

// Idempotent re-creation of the v4 tables. Used only if a database claims to be
// up to date but a table is missing (e.g. an interrupted or mixed-version install).
const REPAIR_V4 = `
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    thumb_name TEXT,
    original_name TEXT,
    mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    captured_at TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id);

  -- One optional, explicitly chosen location per entry. Coordinates are
  -- nullable so a place may be saved by name only.
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE CASCADE,
    latitude REAL,
    longitude REAL,
    name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  -- Secondary emotions are stored by stable machine key, never by label.
  CREATE TABLE IF NOT EXISTS entry_emotions (
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    emotion_key TEXT NOT NULL,
    intensity INTEGER CHECK (intensity IS NULL OR (intensity BETWEEN 1 AND 5)),
    PRIMARY KEY (entry_id, emotion_key)
  );
`;
const REQUIRED_TABLES = ['entries','tags','entry_tags','app_settings','attachments','locations','entry_emotions'];

export async function runMigrations(db) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  if (version > LATEST_VERSION) {
    // Database written by a newer app build: refuse to touch it.
    throw new Error(`Database version ${version} is newer than app (${LATEST_VERSION}).`);
  }

  for (let next = version + 1; next <= LATEST_VERSION; next++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[next - 1]);
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
  }

  // Self-heal: make sure every table AND column the app queries really exists.
  // (A database can claim to be up to date yet lack pieces after an
  // interrupted or mixed-version install.)
  // A side table left by an OLDER design (e.g. attachments with a NOT NULL `uri`
  // column) would make every insert fail. Keep it as <name>_legacy and rebuild.
  const OURS = {
    attachments: ['id','uuid','entry_id','file_name','thumb_name','original_name','mime_type','size_bytes','width','height','captured_at','status','sort_order','created_at'],
    locations: ['id','uuid','entry_id','latitude','longitude','name','address','created_at'],
    entry_emotions: ['entry_id','emotion_key','intensity'],
  };
  for (const [table, ours] of Object.entries(OURS)) {
    const info = await db.getAllAsync(`PRAGMA table_info(${table})`);
    const blocking = info.filter((col) => col.notnull && col.dflt_value == null && !col.pk && !ours.includes(col.name));
    if (blocking.length) {
      let legacyName = `${table}_legacy`;
      const taken = new Set((await db.getAllAsync("SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name));
      for (let i = 2; taken.has(legacyName); i++) legacyName = `${table}_legacy${i}`;
      const idx = await db.getAllAsync("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL", table);
      await db.withTransactionAsync(async () => {
        for (const i of idx) await db.execAsync(`DROP INDEX IF EXISTS "${i.name}"`);
        await db.execAsync(`ALTER TABLE ${table} RENAME TO ${legacyName}`);
      });
    }
  }
  const have = await db.getAllAsync("SELECT name FROM sqlite_master WHERE type='table'");
  const names = new Set(have.map((r) => r.name));
  if (REQUIRED_TABLES.some((n) => !names.has(n)) && LATEST_VERSION >= 4) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(REPAIR_V4);
    });
  }
  const cols = new Set((await db.getAllAsync('PRAGMA table_info(entries)')).map((r) => r.name));
  const addCols = [
    ['deleted_at', 'TEXT'],
    ['pinned', 'INTEGER NOT NULL DEFAULT 0'],
    ['content_format_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['uuid', 'TEXT'],
    ['body_html', 'TEXT'],
  ].filter(([n]) => !cols.has(n));
  if (addCols.length) {
    await db.withTransactionAsync(async () => {
      for (const [n, def] of addCols) await db.execAsync(`ALTER TABLE entries ADD COLUMN ${n} ${def}`);
    });
  }
  // Same for the v4 side tables (columns only; every added column has a default).
  const sideCols = {
    attachments: [
      ['uuid', "TEXT NOT NULL DEFAULT ''"], ['entry_id', 'INTEGER NOT NULL DEFAULT 0'], ['file_name', "TEXT NOT NULL DEFAULT ''"],
      ['thumb_name', 'TEXT'], ['original_name', 'TEXT'], ['mime_type', "TEXT NOT NULL DEFAULT 'image/jpeg'"],
      ['size_bytes', 'INTEGER NOT NULL DEFAULT 0'], ['width', 'INTEGER'], ['height', 'INTEGER'], ['captured_at', 'TEXT'],
      ['status', "TEXT NOT NULL DEFAULT 'ready'"], ['sort_order', 'INTEGER NOT NULL DEFAULT 0'], ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ],
    locations: [
      ['uuid', "TEXT NOT NULL DEFAULT ''"], ['entry_id', 'INTEGER NOT NULL DEFAULT 0'], ['latitude', 'REAL'], ['longitude', 'REAL'],
      ['name', "TEXT NOT NULL DEFAULT ''"], ['address', "TEXT NOT NULL DEFAULT ''"], ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ],
    entry_emotions: [['intensity', 'INTEGER']],
  };
  for (const [table, defs] of Object.entries(sideCols)) {
    const have2 = new Set((await db.getAllAsync(`PRAGMA table_info(${table})`)).map((r) => r.name));
    for (const [n, def] of defs) {
      if (!have2.has(n)) await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${n} ${def}`);
    }
  }
  if (!cols.has('uuid') || (await db.getFirstAsync('SELECT 1 AS x FROM entries WHERE uuid IS NULL LIMIT 1'))) {
    await db.execAsync(
      "UPDATE entries SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;" +
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_uuid ON entries(uuid);" +
        "CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deleted_at);",
    );
  }
}
