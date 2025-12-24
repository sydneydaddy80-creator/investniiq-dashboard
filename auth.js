function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireRole(roles = []) {
  return function (req, res, next) {
    if (!req.session.user) return res.redirect("/login");
    if (!roles.includes(req.session.user.role)) return res.status(403).send("Forbidden");
    next();
  };
}

function canEditProject(req) {
  return req.session.user && (req.session.user.role === "admin" || req.session.user.role === "manager");
}

module.exports = {
  requireLogin,
  requireRole,
  canEditProject
};
