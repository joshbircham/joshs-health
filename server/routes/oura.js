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

    const [sleepRes, dailySleepRes, readinessRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?${params}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?${params}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?${params}`, { headers }),
    ]);

    const sleepData = await sleepRes.json();
    const dailySleepData = await dailySleepRes.json();
    const readinessData = await readinessRes.json();

    // Index readiness and daily sleep scores by date
    const readinessByDate = {};
    (readinessData.data || []).forEach(r => { readinessByDate[r.day] = r; });

    const dailySleepByDate = {};
    (dailySleepData.data || []).forEach(s => { dailySleepByDate[s.day] = s; });

    // Keep only the best sleep session per night (prefer long_sleep type)
    const sleepByDate = {};
    (sleepData.data || []).forEach(s => {
      const day = s.day;
      if (!sleepByDate[day] || s.type === 'long_sleep') {
        sleepByDate[day] = s;
      }
    });

    // Merge all dates from both sleep sessions and daily sleep summaries
    const allDays = new Set([...Object.keys(sleepByDate), ...Object.keys(dailySleepByDate)]);

    const upsert = db.prepare(`
      INSERT INTO oura_data (date, sleep_score, readiness_score, hrv_average,
        resting_hr, total_sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, efficiency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        sleep_score      = COALESCE(excluded.sleep_score, sleep_score),
        readiness_score  = COALESCE(excluded.readiness_score, readiness_score),
        hrv_average      = COALESCE(excluded.hrv_average, hrv_average),
        resting_hr       = COALESCE(excluded.resting_hr, resting_hr),
        total_sleep_minutes = COALESCE(excluded.total_sleep_minutes, total_sleep_minutes),
        deep_sleep_minutes  = COALESCE(excluded.deep_sleep_minutes, deep_sleep_minutes),
        rem_sleep_minutes   = COALESCE(excluded.rem_sleep_minutes, rem_sleep_minutes),
        efficiency       = COALESCE(excluded.efficiency, efficiency)
    `);

    const syncAll = db.transaction(days => {
      for (const day of days) {
        const s = sleepByDate[day];
        const ds = dailySleepByDate[day];
        const readiness = readinessByDate[day];
        upsert.run(
          day,
          ds?.score ?? null,
          readiness?.score ?? null,
          s?.average_hrv ?? null,
          s?.lowest_heart_rate ?? null,
          s?.total_sleep_duration ? Math.round(s.total_sleep_duration / 60) : null,
          s?.deep_sleep_duration  ? Math.round(s.deep_sleep_duration  / 60) : null,
          s?.rem_sleep_duration   ? Math.round(s.rem_sleep_duration   / 60) : null,
          s?.efficiency ?? null
        );
      }
    });

    syncAll([...allDays]);
    res.json({ ok: true, synced: allDays.size });
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
      sleep_score      = COALESCE(excluded.sleep_score, sleep_score),
      readiness_score  = COALESCE(excluded.readiness_score, readiness_score),
      hrv_average      = COALESCE(excluded.hrv_average, hrv_average),
      resting_hr       = COALESCE(excluded.resting_hr, resting_hr),
      total_sleep_minutes = COALESCE(excluded.total_sleep_minutes, total_sleep_minutes),
      deep_sleep_minutes  = COALESCE(excluded.deep_sleep_minutes, deep_sleep_minutes),
      rem_sleep_minutes   = COALESCE(excluded.rem_sleep_minutes, rem_sleep_minutes),
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
