const mysql  = require('mysql2');
const dotenv = require('dotenv');
dotenv.config();

const pool = mysql.createPool({
  connectionLimit: 10,
  host:     process.env.DB_HOST || 'localhost',
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'bloodreview',
});

module.exports = pool;
