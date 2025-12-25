// db.js (Postgres)
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Set it in Render Environment Variables.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL in most cases
  ssl: { rejectUnauthorized: false },
});

// db is pool itself (to keep your existing openDb signature)
function openDb() {
  return pool;
}

async function run(db, sql, params = []) {
  // for INSERT/UPDATE/DELETE
  const res = await db.query(sql, params);
  return res;
}

async function get(db, sql, params = []) {
  const res = await db.query(sql, params);
  return res.rows[0] || null;
}

async function all(db, sql, params = []) {
  const res = await db.query(sql, params);
  return res.rows;
}

// Helpers to convert sqlite-style ? placeholders -> $1,$2...
function toPgParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function migrateAndSeed() {
  const db = openDb();

  // USERS
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin','manager','user','sales')),
      status TEXT NOT NULL CHECK (status IN ('enabled','disabled')) DEFAULT 'enabled',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `
  );

  // CLIENTS
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      currency TEXT NOT NULL,
      masked_panelist_prefix TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL
    );
  `
  );

  // PROJECTS
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      project_number INTEGER NOT NULL UNIQUE,
      project_uid TEXT NOT NULL UNIQUE,
      project_link_uid TEXT NOT NULL UNIQUE,
      project_name TEXT NOT NULL,
      client_id INTEGER REFERENCES clients(id),
      project_manager_id INTEGER REFERENCES users(id),
      sales_rep_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('live','pending','paused')) DEFAULT 'pending',
      currency TEXT NOT NULL DEFAULT 'USD',
      po_number TEXT,
      study_type TEXT,
      loi INTEGER,
      bid_target DOUBLE PRECISION,
      time_frame INTEGER,
      client_live_link TEXT,
      client_test_link TEXT,
      redirect_complete_url TEXT,
      redirect_terminate_url TEXT,
      redirect_quotafull_url TEXT,
      redirect_securityterminate_url TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );
  `
  );

  // PROJECT COUNTRY LINKS
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS project_country_links (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      country_name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('live','test')),
      link_url TEXT NOT NULL,
      remark TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );
  `
  );
  await run(db, `CREATE INDEX IF NOT EXISTS idx_pcl_project ON project_country_links(project_id);`);

  // BILLING
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS billing (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      total_completes INTEGER NOT NULL DEFAULT 0,
      cpi_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      billing_status TEXT NOT NULL CHECK (billing_status IN ('hold','received')) DEFAULT 'hold',
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMPTZ NOT NULL
    );
  `
  );

  // CLICK SESSIONS
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS click_sessions (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      project_uid TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('live','test')),
      user_id TEXT NOT NULL,
      masked_id TEXT NOT NULL UNIQUE,
      entry_time TIMESTAMPTZ NOT NULL,
      entry_ip TEXT,
      entry_country TEXT,
      exit_time TIMESTAMPTZ,
      exit_ip TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending','complete','terminate','quotafull','securityTerminate')) DEFAULT 'pending'
    );
  `
  );

  await run(db, `CREATE INDEX IF NOT EXISTS idx_click_project_entry ON click_sessions(project_id, entry_time);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_click_project_user ON click_sessions(project_id, user_id);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);`);

  // Seed admin if not exists
  const admin = await get(db, `SELECT id FROM users WHERE email = $1`, ["admin@investniiq.local"]);
  if (!admin) {
    const now = new Date(); // Postgres stores TZ

    const seeds = [
      { name: "Admin", email: "admin@investniiq.local", role: "admin", pass: "Admin@123" },
      { name: "Manager", email: "manager@investniiq.local", role: "manager", pass: "Manager@123" },
      { name: "User", email: "user@investniiq.local", role: "user", pass: "User@123" },
    ];

    for (const u of seeds) {
      const hash = bcrypt.hashSync(u.pass, 10);
      await run(
        db,
        `INSERT INTO users (name,email,role,status,password_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [u.name, u.email, u.role, "enabled", hash, now]
      );
    }
  }
}

module.exports = {
  openDb,
  run,
  get,
  all,
  migrateAndSeed,
  // exporting helper so you can convert old sqlite queries easily
  toPgParams,
};
