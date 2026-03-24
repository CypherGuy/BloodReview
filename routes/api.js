const express    = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const pool                = require('../db');
const { isAuthenticated } = require('../middleware');

const router  = express.Router();
const client  = new Anthropic();

// ── Shared AI system prompt ───────────────────────────────────────────────────
const ANALYSIS_SYSTEM_PROMPT = `You are a warm, knowledgeable health guide writing for non-medical patients who want to understand their blood test results.

Formatting rules you must follow:
- Always write units with a space before the symbol: write "28 µg/L" not "28µg/L", "42 nmol/L" not "42nmol/L"
- Use bullet points for lists of options or facts — never use "Step 1 / Step 2 / Step 3" numbering unless the steps are genuinely sequential
- Use these emoji sparingly and purposefully: 🔴 for out-of-range or concerning results, 🟡 for borderline results worth watching, ✅ for healthy results, 📋 to introduce an action list
- Tone must be warm, calm, and encouraging — never alarming or overly clinical
- Spell all medical terms correctly and consistently (ferritin, haemoglobin, eGFR, nmol/L, µg/L)

Structure every response in this exact order:
- Open with one or two sentences leading with what looks healthy (e.g. "Most of your results are within the normal range")
- Then cover any out-of-range or borderline markers, most clinically significant first — for each: (a) plain-English explanation of what the marker measures, (b) why it matters for health, (c) specific practical actions they can take (e.g. "eat leafy greens and red meat to raise iron", "spend 15–20 minutes outdoors daily for vitamin D")
- Close with a "Next Steps" section listing which issues are worth discussing with a GP, and which can be addressed through diet and lifestyle alone`;


// ── Manual entry ──────────────────────────────────────────────────────────────

// POST /api/tests/manual  – create a test from manually entered markers
router.post('/tests/manual', isAuthenticated, (req, res) => {
  const { testDate, markers } = req.body;

  if (!testDate || !/^\d{4}-\d{2}-\d{2}$/.test(testDate)) {
    return res.status(400).json({ message: 'A valid test date (YYYY-MM-DD) is required.' });
  }
  if (!Array.isArray(markers) || markers.length === 0) {
    return res.status(400).json({ message: 'At least one marker is required.' });
  }

  const valid = markers.filter(m => m.marker_name && m.marker_name.trim() && !isNaN(parseFloat(m.value)));
  if (valid.length === 0) {
    return res.status(400).json({ message: 'No valid markers found. Each marker needs a name and a numeric value.' });
  }

  const userId = req.session.user.id;

  pool.getConnection((connErr, conn) => {
    if (connErr) return res.status(500).json({ message: 'Database connection failed.' });

    conn.beginTransaction(txErr => {
      if (txErr) { conn.release(); return res.status(500).json({ message: 'Transaction error.' }); }

      conn.query(
        'INSERT INTO blood_tests (user_id, test_date) VALUES (?, ?)',
        [userId, testDate],
        (err, result) => {
          if (err) {
            return conn.rollback(() => { conn.release(); res.status(500).json({ message: 'Failed to save test.' }); });
          }

          const testId     = result.insertId;
          const markerRows = valid.map(m => [
            testId,
            m.marker_name.trim(),
            parseFloat(m.value),
            m.unit    || null,
            m.reference_low  !== '' && m.reference_low  != null ? parseFloat(m.reference_low)  : null,
            m.reference_high !== '' && m.reference_high != null ? parseFloat(m.reference_high) : null,
          ]);

          conn.query(
            'INSERT INTO blood_markers (test_id, marker_name, value, unit, reference_low, reference_high) VALUES ?',
            [markerRows],
            (err2) => {
              if (err2) {
                return conn.rollback(() => { conn.release(); res.status(500).json({ message: 'Failed to save markers.' }); });
              }
              conn.commit(commitErr => {
                conn.release();
                if (commitErr) return res.status(500).json({ message: 'Commit failed.' });
                // Invalidate overview cache — new data means old summary is stale
                pool.query('UPDATE user_profiles SET overview_analysis = NULL WHERE user_id = ?', [userId], () => {});
                res.status(200).json({ message: 'Test saved.', testId, markersStored: valid.length });
              });
            }
          );
        }
      );
    });
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

// GET /api/tests  – list all tests for the logged-in user
router.get('/tests', isAuthenticated, (req, res) => {
  pool.query(
    'SELECT id, test_date, source_file_key, analysis FROM blood_tests WHERE user_id = ? ORDER BY test_date DESC',
    [req.session.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Failed to fetch tests.' });
      res.json(rows);
    }
  );
});

// GET /api/tests/:testId/markers
router.get('/tests/:testId/markers', isAuthenticated, (req, res) => {
  // Verify the test belongs to this user before returning data
  pool.query(
    'SELECT bt.id FROM blood_tests bt WHERE bt.id = ? AND bt.user_id = ?',
    [req.params.testId, req.session.user.id],
    (err, rows) => {
      if (err || rows.length === 0) return res.status(404).json({ message: 'Test not found.' });

      pool.query(
        'SELECT marker_name, value, unit, reference_low, reference_high FROM blood_markers WHERE test_id = ? ORDER BY marker_name',
        [req.params.testId],
        (err2, markers) => {
          if (err2) return res.status(500).json({ message: 'Failed to fetch markers.' });
          res.json(markers);
        }
      );
    }
  );
});

// ── Trends ────────────────────────────────────────────────────────────────────

// GET /api/trends  – returns { markerName: [{test_date, value, reference_low, reference_high}] }
router.get('/trends', isAuthenticated, (req, res) => {
  pool.query(
    `SELECT bm.marker_name, bt.test_date, bm.value, bm.unit, bm.reference_low, bm.reference_high
     FROM blood_markers bm
     JOIN blood_tests bt ON bt.id = bm.test_id
     WHERE bt.user_id = ?
     ORDER BY bm.marker_name, bt.test_date ASC`,
    [req.session.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Failed to fetch trends.' });

      // Group by marker name
      const grouped = {};
      rows.forEach(r => {
        if (!grouped[r.marker_name]) grouped[r.marker_name] = [];
        grouped[r.marker_name].push({
          test_date:     r.test_date,
          value:         parseFloat(r.value),
          unit:          r.unit,
          reference_low: r.reference_low  != null ? parseFloat(r.reference_low)  : null,
          reference_high:r.reference_high != null ? parseFloat(r.reference_high) : null,
        });
      });

      res.json(grouped);
    }
  );
});

// ── Profile ───────────────────────────────────────────────────────────────────

router.get('/profile', isAuthenticated, (req, res) => {
  pool.query(
    'SELECT * FROM user_profiles WHERE user_id = ?',
    [req.session.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Failed to fetch profile.' });
      res.json(rows[0] || {});
    }
  );
});

router.put('/profile', isAuthenticated, (req, res) => {
  const { display_name, age, sex, exercise_frequency, medications, notes,
          ai_can_see_age, ai_can_see_sex, ai_can_see_exercise, ai_can_see_medications } = req.body;

  const data = {
    user_id:               req.session.user.id,
    display_name:          display_name          || null,
    age:                   age                   || null,
    sex:                   sex                   || null,
    exercise_frequency:    exercise_frequency    || null,
    medications:           medications           || null,
    notes:                 notes                 || null,
    ai_can_see_age:        ai_can_see_age        != null ? (ai_can_see_age        ? 1 : 0) : 1,
    ai_can_see_sex:        ai_can_see_sex        != null ? (ai_can_see_sex        ? 1 : 0) : 1,
    ai_can_see_exercise:   ai_can_see_exercise   != null ? (ai_can_see_exercise   ? 1 : 0) : 1,
    ai_can_see_medications:ai_can_see_medications!= null ? (ai_can_see_medications? 1 : 0) : 0,
  };

  pool.query(
    `INSERT INTO user_profiles SET ? ON DUPLICATE KEY UPDATE
      display_name=VALUES(display_name), age=VALUES(age), sex=VALUES(sex),
      exercise_frequency=VALUES(exercise_frequency), medications=VALUES(medications),
      notes=VALUES(notes), ai_can_see_age=VALUES(ai_can_see_age),
      ai_can_see_sex=VALUES(ai_can_see_sex), ai_can_see_exercise=VALUES(ai_can_see_exercise),
      ai_can_see_medications=VALUES(ai_can_see_medications)`,
    data,
    (err) => {
      if (err) { console.error(err); return res.status(500).json({ message: 'Failed to save profile.' }); }
      res.json({ message: 'Profile saved.' });
    }
  );
});

// ── AI Analysis ───────────────────────────────────────────────────────────────

// POST /api/tests/:testId/analyse
router.post('/tests/:testId/analyse', isAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const testId = req.params.testId;

  // 1. Verify ownership + check for cached analysis
  pool.query(
    'SELECT id, test_date, analysis FROM blood_tests WHERE id = ? AND user_id = ?',
    [testId, userId],
    (err, tests) => {
      if (err || tests.length === 0) return res.status(404).json({ message: 'Test not found.' });

      if (tests[0].analysis) {
        return res.json({ analysis: tests[0].analysis, cached: true });
      }

      // 2. Fetch markers
      pool.query(
        'SELECT marker_name, value, unit, reference_low, reference_high FROM blood_markers WHERE test_id = ?',
        [testId],
        (err2, markers) => {
          if (err2) return res.status(500).json({ message: 'Failed to fetch markers.' });

          // 3. Fetch profile + privacy settings
          pool.query(
            'SELECT * FROM user_profiles WHERE user_id = ?',
            [userId],
            async (err3, profiles) => {
              if (err3) return res.status(500).json({ message: 'Failed to fetch profile.' });

              const profile = profiles[0] || {};

              // 4. Build context string (respecting privacy flags)
              const contextParts = [];
              if (profile.age          && profile.ai_can_see_age)        contextParts.push(`Age: ${profile.age}`);
              if (profile.sex          && profile.ai_can_see_sex)        contextParts.push(`Sex: ${profile.sex}`);
              if (profile.exercise_frequency && profile.ai_can_see_exercise) contextParts.push(`Exercise: ${profile.exercise_frequency}`);
              if (profile.medications  && profile.ai_can_see_medications) contextParts.push(`Medications: ${profile.medications}`);

              const contextSent = contextParts.length ? contextParts.join(', ') : null;

              // 5. Build prompt — only include out-of-range markers if > 50 total (budget guard)
              let markerList = markers;
              if (markers.length > 50) {
                markerList = markers.filter(m =>
                  (m.reference_low  != null && m.value < m.reference_low) ||
                  (m.reference_high != null && m.value > m.reference_high)
                );
              }

              const markerText = markerList.map(m => {
                const range = (m.reference_low != null && m.reference_high != null)
                  ? ` (normal: ${m.reference_low}–${m.reference_high} ${m.unit})`
                  : '';
                return `- ${m.marker_name}: ${m.value} ${m.unit}${range}`;
              }).join('\n');

              const prompt = [
                contextSent ? `Patient context: ${contextSent}.` : 'No patient context provided.',
                '',
                `Blood test from ${tests[0].test_date}:`,
                markerText,
                '',
                'Summarise these results. Lead with what looks healthy, then address any out-of-range or borderline markers with a plain-English explanation, why each matters, and specific practical advice. Close with a "Next Steps" section.',
              ].join('\n');

              // 6. Call Claude
              try {
                const message = await client.messages.create({
                  model:      'claude-haiku-4-5-20251001',
                  max_tokens: 800,
                  system:     ANALYSIS_SYSTEM_PROMPT,
                  messages:   [{ role: 'user', content: prompt }],
                });

                const analysis = message.content[0].text;

                // 7. Cache the result
                pool.query(
                  'UPDATE blood_tests SET analysis = ? WHERE id = ?',
                  [analysis, testId],
                  () => {}
                );

                return res.json({ analysis, cached: false, contextSent: contextSent || 'none' });
              } catch (aiErr) {
                console.error('Anthropic error:', aiErr);
                return res.status(500).json({ message: 'AI analysis failed. Check your API key.' });
              }
            }
          );
        }
      );
    }
  );
});

// ── Latest markers (for dashboard summary) ────────────────────────────────────

// GET /api/latest-markers
router.get('/latest-markers', isAuthenticated, (req, res) => {
  // Step 1: get the most recent test id
  pool.query(
    'SELECT id, test_date FROM blood_tests WHERE user_id = ? ORDER BY test_date DESC LIMIT 1',
    [req.session.user.id],
    (err, tests) => {
      if (err) return res.status(500).json({ message: 'Failed to fetch tests.' });
      if (!tests.length) return res.json([]);

      const { id: testId, test_date } = tests[0];

      // Step 2: get its markers (test_id is indexed)
      pool.query(
        `SELECT ? AS test_date, marker_name, value, unit, reference_low, reference_high
         FROM blood_markers WHERE test_id = ? ORDER BY marker_name`,
        [test_date, testId],
        (err2, rows) => {
          if (err2) return res.status(500).json({ message: 'Failed to fetch markers.' });
          res.json(rows);
        }
      );
    }
  );
});

// ── Overview analysis (multi-year trend + actionable advice) ─────────────────

// POST /api/analyse/overview
router.post('/analyse/overview', isAuthenticated, async (req, res) => {
  const userId    = req.session.user.id;
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const cutoff = threeYearsAgo.toISOString().split('T')[0];

  // 1. Fetch all markers across all tests in the past 3 years
  pool.query(
    `SELECT bm.marker_name, bm.value, bm.unit, bm.reference_low, bm.reference_high, bt.test_date
     FROM blood_markers bm
     JOIN blood_tests bt ON bt.id = bm.test_id
     WHERE bt.user_id = ? AND bt.test_date >= ?
     ORDER BY bm.marker_name, bt.test_date ASC`,
    [userId, cutoff],
    async (err, rows) => {
      if (err) return res.status(500).json({ message: 'Failed to fetch data.' });
      if (rows.length === 0) return res.status(400).json({ message: 'No blood test data found in the past 3 years.' });

      // 2. Fetch profile + privacy settings (also check cached overview)
      pool.query('SELECT * FROM user_profiles WHERE user_id = ?', [userId], async (err2, profiles) => {
        if (err2) return res.status(500).json({ message: 'Failed to fetch profile.' });

        const profile = profiles[0] || {};

        // Return cached overview if available
        if (profile.overview_analysis) {
          return res.json({ analysis: profile.overview_analysis, cached: true });
        }

        const contextParts = [];
        if (profile.age               && profile.ai_can_see_age)         contextParts.push(`Age: ${profile.age}`);
        if (profile.sex               && profile.ai_can_see_sex)         contextParts.push(`Sex: ${profile.sex}`);
        if (profile.exercise_frequency && profile.ai_can_see_exercise)   contextParts.push(`Exercise: ${profile.exercise_frequency}`);
        if (profile.medications       && profile.ai_can_see_medications) contextParts.push(`Medications: ${profile.medications}`);

        // 3. Group by marker name, summarise trend
        const grouped = {};
        rows.forEach(r => {
          if (!grouped[r.marker_name]) grouped[r.marker_name] = [];
          grouped[r.marker_name].push({
            date:  r.test_date,
            value: parseFloat(r.value),
            unit:  r.unit,
            low:   r.reference_low  != null ? parseFloat(r.reference_low)  : null,
            high:  r.reference_high != null ? parseFloat(r.reference_high) : null,
          });
        });

        const markerSummaries = Object.entries(grouped).map(([name, pts]) => {
          const latest = pts[pts.length - 1];
          const range  = (latest.low != null && latest.high != null)
            ? `normal range ${latest.low}–${latest.high} ${latest.unit}`
            : 'no reference range';
          const readings = pts.map(p => `${p.date}: ${p.value}`).join(', ');
          const status = (latest.low != null && latest.value < latest.low)   ? 'LOW'
                       : (latest.high != null && latest.value > latest.high) ? 'HIGH'
                       : 'normal';
          return `${name} (${range}): ${readings} → currently ${status}`;
        }).join('\n');

        const context = contextParts.length ? `Patient context: ${contextParts.join(', ')}.` : '';

        const prompt = `${context}

Here is a summary of blood test results over the past 3 years:

${markerSummaries}

Give a clear, friendly overview. Lead with what looks healthy across the past three years. Then for each marker that is out of range or showing a concerning trend, explain in plain English what the marker measures and why it matters, note whether the issue has been persistent or worsening, and give specific practical lifestyle advice (e.g. "spend 20 minutes outside daily for vitamin D", "eat leafy greens and red meat to raise iron", "reduce processed food intake for better glucose control"). Close with a "Next Steps" section covering which issues are worth discussing with a GP and which can be addressed through diet and lifestyle alone.`;

        try {
          const message = await client.messages.create({
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 1200,
            system:     ANALYSIS_SYSTEM_PROMPT,
            messages:   [{ role: 'user', content: prompt }],
          });
          const analysis = message.content[0].text;

          // Cache it — insert row if none exists, otherwise update
          pool.query(
            `INSERT INTO user_profiles (user_id, overview_analysis)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE overview_analysis = VALUES(overview_analysis)`,
            [userId, analysis],
            () => {}
          );

          return res.json({ analysis, cached: false });
        } catch (aiErr) {
          console.error('Anthropic error:', aiErr);
          return res.status(500).json({ message: 'AI analysis failed. Check your API key.' });
        }
      });
    }
  );
});

// ── Data export / account delete ──────────────────────────────────────────────

router.get('/export', isAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  pool.query(
    `SELECT bt.id, bt.test_date,
            JSON_ARRAYAGG(JSON_OBJECT(
              'marker_name',   bm.marker_name,
              'value',         bm.value,
              'unit',          bm.unit,
              'reference_low', bm.reference_low,
              'reference_high',bm.reference_high
            )) AS markers
     FROM blood_tests bt
     LEFT JOIN blood_markers bm ON bm.test_id = bt.id
     WHERE bt.user_id = ?
     GROUP BY bt.id
     ORDER BY bt.test_date DESC`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Export failed.' });
      res.setHeader('Content-Disposition', 'attachment; filename="bloodreview-export.json"');
      res.json({ exported_at: new Date().toISOString(), tests: rows });
    }
  );
});

router.delete('/account', isAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  pool.query('DELETE FROM logins WHERE id = ?', [userId], (err) => {
    if (err) return res.status(500).json({ message: 'Failed to delete account.' });
    req.session.destroy(() => res.json({ message: 'Account deleted.' }));
  });
});

module.exports = router;
