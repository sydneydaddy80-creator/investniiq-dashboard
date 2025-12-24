const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const morgan = require("morgan");
const methodOverride = require("method-override");
const { v4: uuidv4 } = require("uuid");

const { openDb, run, get, all, migrateAndSeed } = require("./db");
const { requireLogin, requireRole, canEditProject } = require("./auth");
const { randomProjectUid, toMoney, safeAppendParam, replacePlaceholders } = require("./helpers");

const app = express();
app.set("view engine", "ejs");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan("dev"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));

app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: __dirname }),
  secret: "investniiq-prod-2025-super-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// --- Auth
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const db = openDb();
  const user = await get(db, "SELECT * FROM users WHERE email = ?", [email]);
  db.close();

  if (!user || user.status !== "enabled") {
    return res.render("login", { error: "Invalid login or user disabled." });
  }
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.render("login", { error: "Invalid login." });

  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.redirect("/");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// --- Dashboard Home (4 columns summary)
app.get("/", requireLogin, async (req, res) => {
  const db = openDb();

    const studyType = (req.query.study_type || "").trim();
  
    const where = [];
    const params = [];
    if (studyType) {
      where.push("LOWER(COALESCE(p.study_type, '')) = LOWER(?)");
      params.push(studyType);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  
    const projects = await all(db, `
      SELECT p.*, c.name as client_name, u.name as manager_name, s.name as sales_name,
        (SELECT COUNT(*) FROM click_sessions cs WHERE cs.project_id = p.id) as total_clicks,
        (SELECT COUNT(*) FROM click_sessions cs WHERE cs.project_id = p.id AND cs.status='complete') as completes
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN users u ON u.id = p.project_manager_id
      LEFT JOIN users s ON s.id = p.sales_rep_id
      ${whereSql}
      ORDER BY p.created_at DESC;
    `, params);

  const clients = await all(db, `SELECT * FROM clients ORDER BY created_at DESC LIMIT 20;`);

  const users = await all(db, `SELECT id, name, email, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 20;`);

  // Billing totals (column 4)
  const totals = await get(db, `
    SELECT 
      COUNT(*) as total_projects,
      SUM(CASE WHEN b.billing_status='hold' THEN 1 ELSE 0 END) as hold_count,
      SUM(CASE WHEN b.billing_status='hold' THEN b.total_amount ELSE 0 END) as hold_amount,
      SUM(CASE WHEN b.billing_status='received' THEN 1 ELSE 0 END) as received_count,
      SUM(CASE WHEN b.billing_status='received' THEN b.total_amount ELSE 0 END) as received_amount
    FROM projects p
    LEFT JOIN billing b ON b.project_id = p.id;
  `);

  db.close();

  res.render("dashboard", { projects, clients, users, totals: totals || {} });
});

// --- Projects
app.get("/projects", requireLogin, async (req, res) => {
  const db = openDb();

  // Filters (persist via query params)
  // UI sends: study_type, status, client_id, manager_id, q
  const studyType = (req.query.study_type || "").toString().trim();
  const statusFilter = (req.query.status || "").toString().trim();
  const clientId = (req.query.client_id || "").toString().trim();
  const managerId = (req.query.manager_id || "").toString().trim();
  const q = (req.query.q || "").toString().trim();

  const whereParts = [];
  const params = [];

  if (studyType) {
    whereParts.push("p.study_type = ?");
    params.push(studyType);
  }
  if (statusFilter) {
    whereParts.push("p.status = ?");
    params.push(statusFilter);
  }
  if (clientId) {
    whereParts.push("p.client_id = ?");
    params.push(Number(clientId));
  }
  if (managerId) {
    whereParts.push("p.project_manager_id = ?");
    params.push(Number(managerId));
  }
  if (q) {
    whereParts.push("(p.project_name LIKE ? OR CAST(p.project_number AS TEXT) LIKE ? OR p.project_uid LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const projects = await all(db, `
    SELECT p.*, c.name as client_name, u.name as manager_name, s.name as sales_name,
      (SELECT COUNT(*) FROM click_sessions cs WHERE cs.project_id = p.id) as total_clicks,
      (SELECT COUNT(*) FROM click_sessions cs WHERE cs.project_id = p.id AND cs.status='complete') as completes
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN users u ON u.id = p.project_manager_id
    LEFT JOIN users s ON s.id = p.sales_rep_id
    ${where}
    ORDER BY p.created_at DESC;
  `, params);
  const clients = await all(db, `SELECT * FROM clients ORDER BY name ASC;`);
  const managers = await all(db, `SELECT id, name FROM users WHERE role IN ('manager','admin') AND status='enabled' ORDER BY name ASC;`);
  const sales = await all(db, `SELECT id, name FROM users WHERE role IN ('sales','admin') AND status='enabled' ORDER BY name ASC;`);
  db.close();
  res.render("projects", {
    projects,
    clients,
    managers,
    sales,
    filters: { studyType, statusFilter, clientId, managerId, q },
    error: null,
  });
});

app.post("/projects", requireRole(["admin", "manager"]), async (req, res) => {
  const db = openDb();
  try {
    const {
      project_name, client_id, project_manager_id, sales_rep_id, currency, po_number,
      study_type, loi, bid_target, time_frame, cpi_usd, status
    } = req.body;

    // Project number = max + 1
    const row = await get(db, "SELECT COALESCE(MAX(project_number), 100) as mx FROM projects;");
    const project_number = (row.mx || 100) + 1;

    // Unique project_uid (identity) + project_link_uid (current active company link)
    let project_uid = randomProjectUid();
    while (await get(db, "SELECT id FROM projects WHERE project_uid = ?", [project_uid])) {
      project_uid = randomProjectUid();
    }

    let project_link_uid = randomProjectUid();
    while (await get(db, "SELECT id FROM projects WHERE project_link_uid = ?", [project_link_uid])) {
      project_link_uid = randomProjectUid();
    }

    const now = new Date().toISOString();

    const r = await run(db, `
      INSERT INTO projects (
        project_number, project_uid, project_link_uid, project_name, client_id, project_manager_id, sales_rep_id,
        status, currency, po_number, study_type, loi, bid_target, time_frame,
        redirect_complete_url, redirect_terminate_url, redirect_quotafull_url, redirect_securityterminate_url,
        created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      project_number, project_uid, project_link_uid, project_name,
      client_id || null, project_manager_id || null, sales_rep_id || null,
      (status || "pending"), currency || "USD", po_number || null,
      study_type || null, loi ? Number(loi) : null, bid_target ? Number(bid_target) : null, time_frame ? Number(time_frame) : null,
      // default redirects (can be edited later)
      `${req.protocol}://${req.get("host")}/redirect/complete?mid={MASKED_ID}`,
      `${req.protocol}://${req.get("host")}/redirect/terminate?mid={MASKED_ID}`,
      `${req.protocol}://${req.get("host")}/redirect/quotafull?mid={MASKED_ID}`,
      `${req.protocol}://${req.get("host")}/redirect/securityTerminate?mid={MASKED_ID}`,
      now
    ]);

    // Create default billing row
    const cpi = cpi_usd ? Number(cpi_usd) : 0;
    await run(db, `
      INSERT INTO billing (project_id, total_completes, cpi_usd, total_amount, billing_status, updated_by, updated_at)
      VALUES (?,?,?,?,?,?,?)
    `, [r.lastID, 0, cpi, 0, "hold", req.session.user.id, now]);

    db.close();
    res.redirect("/projects");
  } catch (e) {
    db.close();
    // Re-render with error
    const db2 = openDb();
    const projects = await all(db2, `
      SELECT p.*, c.name as client_name, u.name as manager_name, s.name as sales_name,
        (SELECT COUNT(*) FROM click_sessions cs WHERE cs.project_id = p.id) as total_clicks,
        (SELECT COUNT(*) FROM click_sessions cs WHERE cs.project_id = p.id AND cs.status='complete') as completes
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN users u ON u.id = p.project_manager_id
      LEFT JOIN users s ON s.id = p.sales_rep_id
      ORDER BY p.created_at DESC;
    `);
    const clients = await all(db2, `SELECT * FROM clients ORDER BY name ASC;`);
    const managers = await all(db2, `SELECT id, name FROM users WHERE role IN ('manager','admin') AND status='enabled' ORDER BY name ASC;`);
    const sales = await all(db2, `SELECT id, name FROM users WHERE role IN ('sales','admin') AND status='enabled' ORDER BY name ASC;`);
    db2.close();
    res.status(400).render("projects", { projects, clients, managers, sales, error: e.message });
  }
});

// Project details tabs
app.get("/projects/:id", requireLogin, async (req, res) => {
  const tab = req.query.tab || "entrylinks";
  const id = Number(req.params.id);
  const db = openDb();

  const project = await get(db, `
    SELECT p.*, c.name as client_name, u.name as manager_name
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN users u ON u.id = p.project_manager_id
    WHERE p.id = ?;
  `, [id]);

  if (!project) {
    db.close();
    return res.status(404).send("Project not found");
  }

  const clients = await all(db, `SELECT id, name FROM clients ORDER BY name ASC;`);
  const managers = await all(db, `SELECT id, name FROM users WHERE role IN ('manager','admin') AND status='enabled' ORDER BY name ASC;`);

  const billing = await get(db, `SELECT * FROM billing WHERE project_id = ?`, [id]);

  // click results
  const clicksRaw = await all(db, `
    SELECT * FROM click_sessions
    WHERE project_id = ?
    ORDER BY entry_time DESC
    LIMIT 200;
  `, [id]);

  const msToHms = (ms) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  const clicks = clicksRaw.map((c) => {
    let total_time = "-";
    if (c.entry_time && c.exit_time) {
      const a = Date.parse(c.entry_time);
      const b = Date.parse(c.exit_time);
      if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) {
        total_time = msToHms(b - a);
      }
    }
    return { ...c, total_time };
  });

  const countryLinks = await all(db, `
    SELECT * FROM project_country_links
    WHERE project_id = ?
    ORDER BY created_at DESC, id DESC;
  `, [id]);

  db.close();

  // Generated Investniiq links (changes when client links updated)
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const investLive = `${baseUrl}/entry/${project.project_link_uid}/live?id={USER_ID}`;
  const investTest = `${baseUrl}/entry/${project.project_link_uid}/test?id={USER_ID}`;

  // Redirect URLs (editable per project)
  const redirects = {
    complete: project.redirect_complete_url || `${baseUrl}/redirect/complete?mid={MASKED_ID}`,
    terminate: project.redirect_terminate_url || `${baseUrl}/redirect/terminate?mid={MASKED_ID}`,
    quotafull: project.redirect_quotafull_url || `${baseUrl}/redirect/quotafull?mid={MASKED_ID}`,
    securityTerminate: project.redirect_securityterminate_url || `${baseUrl}/redirect/securityTerminate?mid={MASKED_ID}`,
  };

  res.render("project_detail", {
    tab,
    project,
    clients,
    managers,
    billing,
    clicks,
    countryLinks,
    investLive,
    investTest,
    redirects,
    canEdit: canEditProject(req)
  });
});

// Update project details (admin/manager)
app.put("/projects/:id", requireRole(["admin","manager"]), async (req, res) => {
  const id = Number(req.params.id);
  const {
    project_name, client_id, project_manager_id, status, currency, po_number,
    study_type, loi, bid_target, time_frame
  } = req.body;

  const db = openDb();
  await run(db, `
    UPDATE projects
    SET project_name=?, client_id=?, project_manager_id=?, status=?, currency=?, po_number=?,
        study_type=?, loi=?, bid_target=?, time_frame=?
    WHERE id=?;
  `, [
    project_name,
    client_id || null,
    project_manager_id || null,
    status,
    currency,
    po_number || null,
    study_type || null,
    loi ? Number(loi) : null,
    bid_target ? Number(bid_target) : null,
    time_frame ? Number(time_frame) : null,
    id
  ]);
  db.close();
  res.redirect(`/projects/${id}?tab=details`);
});

// Update client survey links (admin/manager)
app.put("/projects/:id/links", requireRole(["admin","manager"]), async (req, res) => {
  const id = Number(req.params.id);
  const { client_live_link, client_test_link } = req.body;
  const db = openDb();
  // Each time links are updated, generate a NEW company project link uid
  let project_link_uid = randomProjectUid();
  while (await get(db, "SELECT id FROM projects WHERE project_link_uid = ?", [project_link_uid])) {
    project_link_uid = randomProjectUid();
  }

  await run(db, `
    UPDATE projects
    SET client_live_link=?, client_test_link=?, project_link_uid=?
    WHERE id=?;
  `, [client_live_link || null, client_test_link || null, project_link_uid, id]);
  db.close();
  res.redirect(`/projects/${id}?tab=entrylinks`);
});


// Add country-specific entry link (admin/manager)
app.post("/projects/:id/country-links", requireRole(["admin","manager"]), async (req, res) => {
  const projectId = Number(req.params.id);
  const { country_name, mode, link_url, remark } = req.body;
  const db = openDb();
  try {
    if (!country_name || !mode || !link_url) {
      db.close();
      return res.redirect(`/projects/${projectId}?tab=entrylinks`);
    }
    const now = new Date().toISOString();
    await run(db, `
      INSERT INTO project_country_links (project_id, country_name, mode, link_url, remark, created_at)
      VALUES (?, ?, ?, ?, ?, ?);
    `, [projectId, country_name.trim(), mode, link_url.trim(), (remark || '').trim() || null, now]);
    db.close();
    return res.redirect(`/projects/${projectId}?tab=entrylinks`);
  } catch (e) {
    db.close();
    return res.redirect(`/projects/${projectId}?tab=entrylinks`);
  }
});

// Delete country-specific entry link (admin/manager)
app.delete("/projects/:id/country-links/:linkId", requireRole(["admin","manager"]), async (req, res) => {
  const projectId = Number(req.params.id);
  const linkId = Number(req.params.linkId);
  const db = openDb();
  await run(db, `DELETE FROM project_country_links WHERE id=? AND project_id=?;`, [linkId, projectId]);
  db.close();
  res.redirect(`/projects/${projectId}?tab=entrylinks`);
});



// Update redirects templates (admin/manager)
app.put("/projects/:id/redirects", requireRole(["admin","manager"]), async (req, res) => {
  const id = Number(req.params.id);
  const {
    redirect_complete_url,
    redirect_terminate_url,
    redirect_quotafull_url,
    redirect_securityterminate_url
  } = req.body;

  // IMPORTANT: Redirect endpoints must hit OUR server so we can update click status.
  // We normalize saved URLs to always point to: /redirect/<status>?mid={MASKED_ID}
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const base = new URL(baseUrl);

  const normalizeRedirect = (status, raw) => {
    const fallback = `${baseUrl}/redirect/${status}?mid={MASKED_ID}`;
    const s = (raw || "").toString().trim();
    if (!s) return null;
    try {
      const u = new URL(s, baseUrl);
      // Force to our host so status updates work
      u.protocol = base.protocol;
      u.host = base.host;
      u.pathname = `/redirect/${status}`;
      if (!u.searchParams.has("mid")) {
        u.searchParams.set("mid", "{MASKED_ID}");
      } else {
        const v = u.searchParams.get("mid");
        if (!v) u.searchParams.set("mid", "{MASKED_ID}");
      }
      return u.toString();
    } catch {
      return fallback;
    }
  };

  const completeUrl = normalizeRedirect("complete", redirect_complete_url);
  const terminateUrl = normalizeRedirect("terminate", redirect_terminate_url);
  const quotaUrl = normalizeRedirect("quotafull", redirect_quotafull_url);
  const securityUrl = normalizeRedirect("securityTerminate", redirect_securityterminate_url);
  const db = openDb();
  await run(db, `
    UPDATE projects
    SET redirect_complete_url=?, redirect_terminate_url=?, redirect_quotafull_url=?, redirect_securityterminate_url=?
    WHERE id=?;
  `, [
    completeUrl,
    terminateUrl,
    quotaUrl,
    securityUrl,
    id
  ]);
  db.close();
  res.redirect(`/projects/${id}?tab=entrylinks`);
});

// Update billing (admin/manager; manager cannot set received)
app.put("/projects/:id/billing", requireRole(["admin","manager"]), async (req, res) => {
  const id = Number(req.params.id);
  const { total_completes, cpi_usd, billing_status } = req.body;

  const role = req.session.user.role;
  if (role === "manager" && billing_status === "received") {
    return res.status(403).send("Manager cannot mark RECEIVED.");
  }

  const completes = Number(total_completes || 0);
  const cpi = Number(cpi_usd || 0);
  const total = completes * cpi;

  const db = openDb();
  const now = new Date().toISOString();
  await run(db, `
    UPDATE billing
    SET total_completes=?, cpi_usd=?, total_amount=?, billing_status=?, updated_by=?, updated_at=?
    WHERE project_id=?;
  `, [completes, cpi, total, billing_status, req.session.user.id, now, id]);
  db.close();

  res.redirect(`/projects/${id}?tab=billing`);
});

// --- Clients
app.get("/clients", requireLogin, async (req, res) => {
  const db = openDb();
  const clients = await all(db, `
    SELECT c.*, u.name as created_by_name
    FROM clients c
    LEFT JOIN users u ON u.id = c.created_by
    ORDER BY c.created_at DESC;
  `);
  db.close();
  res.render("clients", { clients, error: null });
});

app.post("/clients", requireRole(["admin","manager"]), async (req, res) => {
  const { name, email, phone, currency, masked_panelist_prefix } = req.body;
  const db = openDb();
  try {
    const now = new Date().toISOString();
    await run(db, `
      INSERT INTO clients (name,email,phone,currency,masked_panelist_prefix,created_by,created_at)
      VALUES (?,?,?,?,?,?,?)
    `, [name, email || null, phone || null, currency, masked_panelist_prefix || null, req.session.user.id, now]);
    db.close();
    res.redirect("/clients");
  } catch (e) {
    db.close();
    const db2 = openDb();
    const clients = await all(db2, `
      SELECT c.*, u.name as created_by_name
      FROM clients c
      LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.created_at DESC;
    `);
    db2.close();
    res.status(400).render("clients", { clients, error: e.message });
  }
});

// --- Users (admin only create + reset)
app.get("/users", requireLogin, async (req, res) => {
  const db = openDb();
  const users = await all(db, `SELECT id, name, email, phone, role, status, created_at FROM users ORDER BY created_at DESC;`);
  db.close();
  res.render("users", { users, error: null });
});

app.post("/users", requireRole(["admin"]), async (req, res) => {
  const { name, email, phone, role, status, password } = req.body;
  const db = openDb();
  try {
    const now = new Date().toISOString();
    const hash = bcrypt.hashSync(password, 10);
    await run(db, `
      INSERT INTO users (name,email,phone,role,status,password_hash,created_at)
      VALUES (?,?,?,?,?,?,?)
    `, [name, email, phone || null, role, status || "enabled", hash, now]);
    db.close();
    res.redirect("/users");
  } catch (e) {
    db.close();
    const db2 = openDb();
    const users = await all(db2, `SELECT id, name, email, phone, role, status, created_at FROM users ORDER BY created_at DESC;`);
    db2.close();
    res.status(400).render("users", { users, error: e.message });
  }
});
app.post("/users/:id/reset-password", requireRole(["admin"]), async (req, res) => {
  const id = Number(req.params.id);
  const { new_password } = req.body;
  const hash = bcrypt.hashSync(new_password, 10);
  const db = openDb();
  await run(db, `UPDATE users SET password_hash=? WHERE id=?`, [hash, id]);
  db.close();
  res.redirect("/users");
});
// Enable/Disable user (admin only)
app.post("/users/:id/status", requireRole(["admin"]), async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;   // ✅ dropdown se aayega

  if (!["enabled", "disabled"].includes(status)) {
    return res.status(400).send("Invalid status");
  }

  const db = openDb();
  await run(db, "UPDATE users SET status=? WHERE id=?", [status, id]);
  db.close();

  return res.redirect("/users");
});

// --- Entry endpoint (Investniiq branded link)
app.get("/entry/:projectLinkUid/:mode", async (req, res) => {
  const { projectLinkUid, mode } = req.params;
  const userId = (req.query.id || "").toString().trim();

  if (!["live","test"].includes(mode)) return res.status(400).send("Invalid mode");
  if (!userId) return res.status(400).send("Missing id (user id)");

  const db = openDb();
  const project = await get(db, `SELECT * FROM projects WHERE project_link_uid=?`, [projectLinkUid]);
  if (!project) { db.close(); return res.status(404).send("Project not found"); }

  // Block runs if project is not LIVE (pending/paused)
  if (project.status !== "live") {
    db.close();
    return res.status(403).send("Project is not LIVE. Ask admin/manager to set status LIVE.");
  }

  const maskedId = uuidv4(); // 36 chars
  const entryIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString();
  const entryCountry = "Unknown"; // offline demo
  const now = new Date().toISOString();

  await run(db, `
    INSERT INTO click_sessions (project_id, project_uid, mode, user_id, masked_id, entry_time, entry_ip, entry_country, status)
    VALUES (?,?,?,?,?,?,?,?,?)
  `, [project.id, project.project_uid, mode, userId, maskedId, now, entryIp, entryCountry, "pending"]);

  // Redirect to client link
  let dest = mode === "live" ? project.client_live_link : project.client_test_link;

  // If not set, show a demo page with masked id
  if (!dest) {
    db.close();
    return res.render("entry_demo", { project, mode, userId, maskedId });
  }

  // IMPORTANT: Do NOT send internal USER_ID to the client.
  // Replace common placeholders with MASKED_ID instead.
  dest = replacePlaceholders(dest, { MASKED_ID: maskedId, PROJECT_UID: project.project_uid });
  // Also append masked id (if client wants it as query param too)
  dest = safeAppendParam(dest, "mid", maskedId);

  db.close();
  return res.redirect(dest);
});

// --- Redirect endpoints (survey ends here)
app.get("/redirect/:status", async (req, res) => {
  const status = req.params.status;
  const mid = (req.query.mid || "").toString().trim();
  const userId = (req.query.id || "").toString().trim();
  const projectUid = (req.query.project || "").toString().trim();

  const allowed = ["complete","terminate","quotafull","securityTerminate"];
  if (!allowed.includes(status)) return res.status(400).send("Invalid status");

  const db = openDb();

  let sessionRow = null;

  if (mid) {
    sessionRow = await get(db, `SELECT * FROM click_sessions WHERE masked_id=?`, [mid]);
  } else if (projectUid && userId) {
    // fallback: latest pending for projectUid + userId
    sessionRow = await get(db, `
      SELECT * FROM click_sessions 
      WHERE project_uid=? AND user_id=? AND status='pending'
      ORDER BY entry_time DESC
      LIMIT 1
    `, [projectUid, userId]);
  }

  if (!sessionRow) {
    db.close();
    return res.status(404).send("Session not found. Pass mid parameter for accurate matching.");
  }

  const exitIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString();
  const now = new Date().toISOString();

  await run(db, `
    UPDATE click_sessions
    SET status=?, exit_time=?, exit_ip=?
    WHERE id=?;
  `, [status, now, exitIp, sessionRow.id]);

  db.close();

  // show a small page (or redirect to thank you)
  res.render("redirect_done", { status, mid: sessionRow.masked_id });
});

app.get("/dashboard", requireLogin, (req, res) => {
  return res.redirect("/");
});
// --- Start app
(async () => {
  await migrateAndSeed();
  const port = process.env.PORT || 3000;
  app.listen(port, () =>
    console.log(`Investniiq Dashboard running on http://localhost:${port}`)
  );
})();
