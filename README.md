# Investniiq Dashboard (Beginner-Friendly)

This is a small full-stack app you can **download, run, and edit**.
Tech: **Node.js + Express + SQLite + EJS (server-rendered HTML)**

## 1) Install
1. Install **Node.js (LTS)** from the official website.
2. Extract this project folder.
3. Open terminal in the project folder and run:

```bash
npm install
npm start
```

App will run at:
- Dashboard: http://localhost:3000

## 2) Login (seeded)
Default users (created automatically on first run):
- **Admin**
  - Email: admin@investniiq.local
  - Password: Admin@123
- **Manager**
  - Email: manager@investniiq.local
  - Password: Manager@123
- **User**
  - Email: user@investniiq.local
  - Password: User@123

## 3) How to test survey tracking (local demo)
1. Create a project in **Projects → Add Project**
2. Open the project → **Entry Links** tab
3. Copy the generated link like:
   - http://localhost:3000/entry/ABCDEFGH/live?id=78654
4. Open it in your browser:
   - This logs an **Entry** + generates a **Masked ID (UUID)** per run
   - Then redirects to the stored Client Live/Test link (if set), otherwise shows a demo page
5. Simulate survey end by opening:
   - http://localhost:3000/redirect/complete?mid=<MASKED_ID>
   - or terminate/quotafull/securityTerminate

## 4) Role Rules (as you requested)
- **Users module**: Only Admin can create users and reset/change passwords.
- **Clients module**: Admin/Manager can create/edit; User view-only.
- **Project Details**: Admin/Manager editable; User view-only.
- **Billing**:
  - Admin: HOLD + RECEIVED
  - Manager: can set HOLD only (cannot set RECEIVED)
  - User: view-only
- **Dashboard Billing totals**:
  - Admin sees HOLD + RECEIVED totals
  - Manager sees only HOLD totals

## Notes
- IP Country is shown as "Unknown" in this offline demo (no geo DB/API). You can integrate an IP-to-country DB later.
- This app is an MVP you can extend (UI styling, more validations, exports, etc.).

Enjoy.
