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
function nowIST() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
}

function formatIST(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

module.exports = {
  randomProjectUid,
  toMoney,
  safeAppendParam,
  replacePlaceholders
};

function formatIST(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false
  });
}
module.exports = {
  randomProjectUid,
  toMoney,
  safeAppendParam,
  replacePlaceholders,
  nowIST,
  formatIST
};
