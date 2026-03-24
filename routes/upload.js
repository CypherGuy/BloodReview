const express  = require('express');
const multer   = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { parse } = require('csv-parse/sync');
const pool                = require('../db');
const { isAuthenticated } = require('../middleware');

const router = express.Router();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Please upload a .csv file.'));
    }
  },
});

// POST /upload
// Expects: multipart/form-data with fields: bloodtest (file), testDate (YYYY-MM-DD)
// CSV columns: marker_name, value, unit, reference_low, reference_high
router.post('/', isAuthenticated, upload.single('bloodtest'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  const { testDate } = req.body;
  if (!testDate || !/^\d{4}-\d{2}-\d{2}$/.test(testDate)) {
    return res.status(400).json({ message: 'A valid test date (YYYY-MM-DD) is required.' });
  }

  // ── 1. Parse CSV ────────────────────────────────────────────────────────────
  let rows;
  try {
    rows = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    return res.status(400).json({ message: `CSV parse error: ${err.message}` });
  }

  const required = ['marker_name', 'value', 'unit', 'reference_low', 'reference_high'];
  const cols = Object.keys(rows[0] || {});
  const missing = required.filter(c => !cols.includes(c));
  if (missing.length) {
    return res.status(400).json({ message: `CSV is missing columns: ${missing.join(', ')}` });
  }

  const markers = rows.map(r => ({
    name:  r.marker_name,
    value: parseFloat(r.value),
    unit:  r.unit,
    low:   parseFloat(r.reference_low)  || null,
    high:  parseFloat(r.reference_high) || null,
  })).filter(m => m.name && !isNaN(m.value));

  if (markers.length === 0) {
    return res.status(400).json({ message: 'No valid marker rows found in CSV.' });
  }

  // ── 2. Upload original file to S3 ───────────────────────────────────────────
  const userId = req.session.user.id;
  const key    = `${userId}/${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket:      process.env.S3_BUCKET_NAME,
      Key:         key,
      Body:        req.file.buffer,
      ContentType: 'text/csv',
    }));
  } catch (err) {
    console.error('S3 upload error:', err);
    return res.status(500).json({ message: 'File storage failed. Check your AWS credentials.' });
  }

  // ── 3. Store in DB (blood_tests + blood_markers) ────────────────────────────
  pool.getConnection((connErr, conn) => {
    if (connErr) {
      console.error('DB connection error:', connErr);
      return res.status(500).json({ message: 'Database connection failed.' });
    }

    conn.beginTransaction(txErr => {
      if (txErr) { conn.release(); return res.status(500).json({ message: 'Transaction error.' }); }

      conn.query(
        'INSERT INTO blood_tests (user_id, test_date, source_file_key) VALUES (?, ?, ?)',
        [userId, testDate, key],
        (err, result) => {
          if (err) {
            return conn.rollback(() => {
              conn.release();
              console.error('Insert blood_tests error:', err);
              res.status(500).json({ message: 'Failed to save test.' });
            });
          }

          const testId = result.insertId;
          const markerRows = markers.map(m => [testId, m.name, m.value, m.unit, m.low, m.high]);

          conn.query(
            'INSERT INTO blood_markers (test_id, marker_name, value, unit, reference_low, reference_high) VALUES ?',
            [markerRows],
            (err2) => {
              if (err2) {
                return conn.rollback(() => {
                  conn.release();
                  console.error('Insert blood_markers error:', err2);
                  res.status(500).json({ message: 'Failed to save markers.' });
                });
              }

              conn.commit(commitErr => {
                conn.release();
                if (commitErr) {
                  return res.status(500).json({ message: 'Commit failed.' });
                }
                // Invalidate overview cache — new data means old summary is stale
                pool.query('UPDATE user_profiles SET overview_analysis = NULL WHERE user_id = ?', [userId], () => {});
                return res.status(200).json({
                  message:      'Blood test uploaded successfully.',
                  testId,
                  markersStored: markers.length,
                });
              });
            }
          );
        }
      );
    });
  });
});

// Multer error handler
router.use((err, _req, res, _next) => {
  return res.status(400).json({ message: err.message });
});

module.exports = router;
