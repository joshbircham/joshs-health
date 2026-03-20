const express = require('express');
const router = express.Router();
const ouraClient = require('../oura');
const db = require('../db');

// GET /api/oura/test — verify token works
router.get('/test', async (req, res) => {
  try {
    const info = await ouraClient.testConnection();
    res.json({ ok: true, user: info });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /api/oura/sync — sync a date range into the local DB
// Body: { start_date: "YYYY-MM-DD", end_date: "YYYY-MM-DD" }
router.post('/sync', async (req, res) => {
  const { start_date, end_date } = req.body;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date required' });
  }

  const token = process.env.OURA_PERSONAL_ACCESS_TOKEN;
  if (!token) return res.status(400).json({ error: 'OURA_PERSONAL_ACCESS_TOKEN not set' });

  try {
    const headers = { Authorization: `Bearer ${token}` };
    const params = `start_date=${start_date}&end_date=${end_date}`;

    const [sleepRes, readinessRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?${params}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?${params}`, { headers }),
    ]);

    const sleepData = await sleepRes.json();
    const readinessData = await readinessRes.json();

    // Index readiness by date
    const readinessByDate = {};
    (readinessData.data || []).forEach(r => { readinessByDate[r.day] = r; });

    // Keep only the best sleep session per night (prefer long_sleep type)
    const sleepByDate = {};
    (sleepData.data || []).forEach(s => {
      const day = s.day;
      if (!sleepByDate[day] || s.type === 'long_sleep') {
        sleepByDate[day] = s;
      }
    });

    const upsert = db.prepare(`
      INSERT INTO oura_data (date, sleep_score, readiness_score, hrv_average,
        resting_hr, total_sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, efficiency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        sleep_score      = excluded.sleep_score,
        readiness_score  = excluded.readiness_score,
        hrv_average      = excluded.hrv_average,
        resting_hr       = excluded.resting_hr,
        total_sleep_minutes = excluded.total_sleep_minutes,
        deep_sleep_minutes  = excluded.deep_sleep_minutes,
        rem_sleep_minutes   = excluded.rem_sleep_minutes,
        efficiency       = excluded.efficiency
    `);

    const syncAll = db.transaction(entries => {
      for (const [day, s] of entries) {
        const readiness = readinessByDate[day];
        upsert.run(
          day,
          s.score ?? null,
          readiness?.score ?? null,
          s.average_hrv ?? null,
          s.lowest_heart_rate ?? null,
          s.total_sleep_duration ? Math.round(s.total_sleep_duration / 60) : null,
          s.deep_sleep_duration  ? Math.round(s.deep_sleep_duration  / 60) : null,
          s.rem_sleep_duration   ? Math.round(s.rem_sleep_duration   / 60) : null,
          s.efficiency ?? null
        );
      }
    });

    syncAll(Object.entries(sleepByDate));
    res.json({ ok: true, synced: Object.keys(sleepByDate).length });
  } catch (err) {
    console.error('Oura sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/oura/import — bulk import a single row (for data migration)
router.post('/import', (req, res) => {
  const o = req.body;
  if (!o.date) return res.status(400).json({ error: 'date required' });
  db.prepare(`
    INSERT INTO oura_data (date, sleep_score, readiness_score, hrv_average,
      resting_hr, total_sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, efficiency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      sleep_score      = excluded.sleep_score,
      readiness_score  = excluded.readiness_score,
      hrv_average      = excluded.hrv_average,
      resting_hr       = excluded.resting_hr,
      total_sleep_minutes = excluded.total_sleep_minutes,
      deep_sleep_minutes  = excluded.deep_sleep_minutes,
      rem_sleep_minutes   = excluded.rem_sleep_minutes,
      efficiency       = excluded.efficiency
  `).run(
    o.date, o.sleep_score ?? null, o.readiness_score ?? null, o.hrv_average ?? null,
    o.resting_hr ?? null, o.total_sleep_minutes ?? null, o.deep_sleep_minutes ?? null,
    o.rem_sleep_minutes ?? null, o.efficiency ?? null
  );
  res.json({ ok: true });
});

// GET /api/oura/data?start=YYYY-MM-DD&end=YYYY-MM-DD — fetch from local DB
router.get('/data', (req, res) => {
  const { start, end } = req.query;
  let rows;
  if (start && end) {
    rows = db.prepare(
      'SELECT * FROM oura_data WHERE date >= ? AND date <= ? ORDER BY date'
    ).all(start, end);
  } else {
    rows = db.prepare('SELECT * FROM oura_data ORDER BY date DESC LIMIT 90').all();
  }
  res.json(rows);
});

module.exports = router;
