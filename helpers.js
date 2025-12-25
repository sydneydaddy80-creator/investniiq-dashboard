function randomProjectUid() {
  // 8-char alphanumeric uppercase
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function toMoney(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

function safeAppendParam(url, key, value) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return url + sep + encodeURIComponent(key) + "=" + encodeURIComponent(value);
}

function replacePlaceholders(url, vars = {}) {
  if (!url) return url;
  const map = {
    USER_ID: vars.USER_ID ?? "",
    UID: vars.USER_ID ?? "",
    ID: vars.USER_ID ?? "",
    MASKED_ID: vars.MASKED_ID ?? "",
    MID: vars.MASKED_ID ?? "",
    PROJECT_UID: vars.PROJECT_UID ?? "",
    PID: vars.PROJECT_UID ?? "",
  };

  let out = url;
  for (const [k, v] of Object.entries(map)) {
    out = out.replaceAll(`{${k}}`, String(v));
    out = out.replaceAll(`{${k.toLowerCase()}}`, String(v));
  }
  return out;
}

module.exports = {
  randomProjectUid,
  toMoney,
  safeAppendParam,
  replacePlaceholders
};
function nowIST() {
  return new Date().toLocaleString("sv-SE", {
    timeZone: "Asia/Kolkata"
  }).replace(" ", "T");
}

function formatIST(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false
  });
}

module.exports = {
  ...module.exports,
  nowIST,
  formatIST
};
