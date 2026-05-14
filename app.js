const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcrypt');
const dotenv   = require('dotenv');
const path     = require('path');
// mysql2 is used in db.js — no direct import needed here

dotenv.config({ override: true });

const pool              = require('./db');
const { isAuthenticated } = require('./middleware');

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/signup', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }
  if (username.length < 3) {
    return res.status(400).json({ message: 'Username must be at least 3 characters.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    pool.query('INSERT INTO logins (username, password) VALUES (?, ?)', [username, hash], (err, results) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'Username already taken.' });
        }
        console.error('Signup error:', err);
        return res.status(500).json({ message: 'Failed to create account. Please try again.' });
      }
      req.session.regenerate((regenErr) => {
        if (regenErr) return res.status(500).json({ message: 'Session error. Please try again.' });
        req.session.user = { id: results.insertId, username };
        return res.redirect('/dashboard');
      });
    });
  } catch (err) {
    console.error('Bcrypt error:', err);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  pool.query('SELECT * FROM logins WHERE username = ?', [username], async (err, results) => {
    if (err) {
      console.error('Login error:', err);
      return res.status(500).json({ message: 'Failed to login. Please try again.' });
    }
    if (results.length === 0) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const user  = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    // Regenerate session ID to prevent session fixation
    req.session.regenerate((regenErr) => {
      if (regenErr) return res.status(500).json({ message: 'Session error. Please try again.' });
      req.session.user = { id: user.id, username: user.username };
      return res.status(200).json({ message: 'Login successful!', redirect: '/dashboard' });
    });
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ── Routes ────────────────────────────────────────────────────────────────────

const uploadRouter = require('./routes/upload');
const apiRouter    = require('./routes/api');
app.use('/upload', uploadRouter);
app.use('/api',    apiRouter);

// ── Static pages ──────────────────────────────────────────────────────────────

app.get('/signup', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/login',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.get('/dashboard', isAuthenticated, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/tests',     isAuthenticated, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'tests.html')));
app.get('/trends',    isAuthenticated, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'trends.html')));
app.get('/profile',   isAuthenticated, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));

// ── Server ────────────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

if (require.main === module) {
  const PORT = process.env.PORT || 5500;
  app.listen(PORT, () => console.log(`BloodReview running on port ${PORT}`));
}

module.exports = app;
