const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "data.sqlite");

function openDb() {
  const db = new sqlite3.Database(DB_PATH);
  return db;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function migrateAndSeed() {
  const db = openDb();

  await run(db, "PRAGMA foreign_keys = ON;");

  // Users
  await run(db, `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      role TEXT NOT NULL CHECK(role IN ('admin','manager','user','sales')),
      status TEXT NOT NULL CHECK(status IN ('enabled','disabled')) DEFAULT 'enabled',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Clients
  await run(db, `
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      currency TEXT NOT NULL,
      masked_panelist_prefix TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
  `);

  // Projects
  await run(db, `
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_number INTEGER NOT NULL UNIQUE,
      project_uid TEXT NOT NULL UNIQUE, -- 8 chars
      project_link_uid TEXT NOT NULL UNIQUE, -- 8 chars (changes when client links updated)
      project_name TEXT NOT NULL,
      client_id INTEGER,
      project_manager_id INTEGER,
      sales_rep_id INTEGER,
      status TEXT NOT NULL CHECK(status IN ('live','pending','paused')) DEFAULT 'pending',
      currency TEXT NOT NULL DEFAULT 'USD',
      po_number TEXT,
      study_type TEXT,
      loi INTEGER,
      bid_target REAL,
      time_frame INTEGER,
      -- Client survey links (stored internally)
      client_live_link TEXT,
      client_test_link TEXT,
      -- Redirect URLs (editable per project)
      redirect_complete_url TEXT,
      redirect_terminate_url TEXT,
      redirect_quotafull_url TEXT,
      redirect_securityterminate_url TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(client_id) REFERENCES clients(id),
      FOREIGN KEY(project_manager_id) REFERENCES users(id),
      FOREIGN KEY(sales_rep_id) REFERENCES users(id)
    );
  `);


  // Project Country Entry Links (multi-country per project)
  await run(db, `
    CREATE TABLE IF NOT EXISTS project_country_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      country_name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('live','test')),
      link_url TEXT NOT NULL,
      remark TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
  `);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_pcl_project ON project_country_links(project_id);`);

  // Billing (per project)
  await run(db, `
    CREATE TABLE IF NOT EXISTS billing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE,
      total_completes INTEGER NOT NULL DEFAULT 0,
      cpi_usd REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      billing_status TEXT NOT NULL CHECK(billing_status IN ('hold','received')) DEFAULT 'hold',
      updated_by INTEGER,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(updated_by) REFERENCES users(id)
    );
  `);

  // Click sessions (entry + exit)
  await run(db, `
    CREATE TABLE IF NOT EXISTS click_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      project_uid TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('live','test')),
      user_id TEXT NOT NULL,
      masked_id TEXT NOT NULL UNIQUE, -- 36 chars UUID
      entry_time TEXT NOT NULL,
      entry_ip TEXT,
      entry_country TEXT,
      exit_time TEXT,
      exit_ip TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending','complete','terminate','quotafull','securityTerminate')) DEFAULT 'pending',
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
  `);

  // Helpful indexes
  await run(db, `CREATE INDEX IF NOT EXISTS idx_click_project_entry ON click_sessions(project_id, entry_time);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_click_project_user ON click_sessions(project_id, user_id);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);`);

  // Seed default users if not exists
  const admin = await get(db, "SELECT id FROM users WHERE email = ?", ["admin@investniiq.local"]);
  if (!admin) {
    const now = new Date().toISOString();

    const seeds = [
      { name: "Admin", email: "admin@investniiq.local", role: "admin", pass: "Admin@123" },
      { name: "Manager", email: "manager@investniiq.local", role: "manager", pass: "Manager@123" },
      { name: "User", email: "user@investniiq.local", role: "user", pass: "User@123" },
    ];

    for (const u of seeds) {
      const hash = bcrypt.hashSync(u.pass, 10);
      await run(db,
        "INSERT INTO users (name,email,role,status,password_hash,created_at) VALUES (?,?,?,?,?,?)",
        [u.name, u.email, u.role, "enabled", hash, now]
      );
    }
  }

  db.close();
}

module.exports = {
  DB_PATH,
  openDb,
  run,
  get,
  all,
  migrateAndSeed
};
