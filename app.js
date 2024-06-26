// Import required modules
const express = require('express');
const session = require('express-session');
const mysql = require('mysql');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config();

// Create an Express application
const app = express();

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Set up middleware to parse request bodies as JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware to initialize session
app.use(session({
  secret: 'your_secret_key', // Change this to a random string
  resave: false,
  saveUninitialized: true
}));

// Create a connection pool to the MySQL server
const pool = mysql.createPool({
  connectionLimit: 10,
  host: 'localhost',
  user: 'root',
  password: process.env.DATABASE_PASSWORD,
  database: 'users'
});

// Handle POST requests to '/signup'
app.post('/signup', (req, res) => {
  const { username, password } = req.body;

  // Insert user into MySQL database
  const query = 'INSERT INTO logins (username, password) VALUES (?, ?)';
  const values = [username, password];

  pool.query(query, values, (error, results) => {
    if (error) {
      console.error('Failed to insert user:', error);
      return res.status(500).json({ message: 'Failed to create account. Please try again.' });
    }

    req.session.user = { username: results[0].username, id: results[0].id }; // Storing user ID if needed
    console.log('User inserted successfully');
    return res.redirect('/dashboard');
  });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  // Check if user exists in MySQL database
  const query = 'SELECT * FROM logins WHERE username = ? AND password = ?';
  const values = [username, password];

  pool.query(query, values, (error, results) => {
    if (error) {
      console.error('Failed to query database:', error);
      return res.status(500).json({ message: 'Failed to login. Please try again.'});
    }

    if (results.length === 0) {
      console.log('User not found');
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    req.session.user = { username: results[0].username, id: results[0].id }; // Storing user ID if needed
    console.log('User logged in successfully');
    return res.status(200).json({ message: 'Login Successful!', redirect: "/dashboard"});
    
  });
}
);

// Handle GET requests
app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});


app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
      // User is authenticated
      next();
  } else {
      // User is not authenticated
      res.redirect('/login'); // Redirect to login page
  }
}

app.get('/dashboard', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Start the server
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});
