function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ message: 'Not authenticated.' });
  }
  res.redirect('/login');
}

module.exports = { isAuthenticated };
