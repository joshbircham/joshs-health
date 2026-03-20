const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /api/health/runs — manually add or bulk import runs
// Body: single run object OR array of runs
// Run: { date, distance_km, duration_minutes, avg_hr, max_hr, source }
router.post('/runs', (req, res) => {
  const runs = Array.isArray(req.body) ? req.body : [req.body];

  const insert = db.prepare(`
    INSERT INTO runs (date, distance_km, duration_minutes, avg_hr, max_hr, source, raw_json)
    VALUES (@date, @distance_km, @duration_minutes, @avg_hr, @max_hr, @source, @raw_json)
  `);

  const insertMany = db.transaction((rows) => {
    const ids = [];
    for (const r of rows) {
      const result = insert.run({
        date: r.date,
        distance_km: r.distance_km ?? null,
        duration_minutes: r.duration_minutes ?? null,
        avg_hr: r.avg_hr ?? null,
        max_hr: r.max_hr ?? null,
        source: r.source ?? 'manual',
        raw_json: r.raw_json ? JSON.stringify(r.raw_json) : null,
      });
      ids.push(result.lastInsertRowid);
    }
    return ids;
  });

  const ids = insertMany(runs);
  res.json({ ok: true, inserted: ids.length, ids });
});

// GET /api/health/runs?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/runs', (req, res) => {
  const { start, end } = req.query;
  let rows;
  if (start && end) {
    rows = db.prepare(
      'SELECT * FROM runs WHERE date >= ? AND date <= ? ORDER BY date'
    ).all(start, end);
  } else {
    rows = db.prepare('SELECT * FROM runs ORDER BY date DESC LIMIT 100').all();
  }
  res.json(rows);
});

// GET /api/health/summary?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns joined symptom + oura + run data by date for dashboard charts
router.get('/summary', (req, res) => {
  const { start, end } = req.query;
  const startDate = start || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const endDate = end || new Date().toISOString().split('T')[0];

  const symptoms = db.prepare(
    'SELECT * FROM symptoms WHERE date >= ? AND date <= ? ORDER BY date'
  ).all(startDate, endDate);

  const oura = db.prepare(
    'SELECT * FROM oura_data WHERE date >= ? AND date <= ? ORDER BY date'
  ).all(startDate, endDate);

  const runs = db.prepare(
    'SELECT * FROM runs WHERE date >= ? AND date <= ? ORDER BY date'
  ).all(startDate, endDate);

  const medications = db.prepare(
    'SELECT date, medication, dose_number, taken FROM medications WHERE date >= ? AND date <= ? ORDER BY date, medication, dose_number'
  ).all(startDate, endDate);

  // Build a merged timeline keyed by date
  const timeline = {};

  for (const s of symptoms) {
    timeline[s.date] = timeline[s.date] || { date: s.date };
    timeline[s.date].symptoms = s;
  }
  for (const o of oura) {
    timeline[o.date] = timeline[o.date] || { date: o.date };
    timeline[o.date].oura = o;
  }
  for (const r of runs) {
    timeline[r.date] = timeline[r.date] || { date: r.date };
    timeline[r.date].runs = timeline[r.date].runs || [];
    timeline[r.date].runs.push(r);
  }
  for (const m of medications) {
    timeline[m.date] = timeline[m.date] || { date: m.date };
    timeline[m.date].medications = timeline[m.date].medications || [];
    timeline[m.date].medications.push({ medication: m.medication, dose_number: m.dose_number, taken: m.taken });
  }

  const sorted = Object.values(timeline).sort((a, b) => a.date.localeCompare(b.date));
  res.json(sorted);
});

module.exports = router;
