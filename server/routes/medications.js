const express = require('express');
const router = express.Router();
const db = require('../db');

const MEDICATIONS = ['diclofenac', 'elvanse', 'inhaler', 'paracetamol'];

// POST /api/medications — log a medication dose
router.post('/', (req, res) => {
  const { date, medication, dose_number, taken = 1, time_taken, notes } = req.body;
  if (!date || !medication) return res.status(400).json({ error: 'date and medication required' });
  if (!MEDICATIONS.includes(medication.toLowerCase())) {
    return res.status(400).json({ error: `medication must be one of: ${MEDICATIONS.join(', ')}` });
  }

  const result = db.prepare(`
    INSERT INTO medications (date, medication, dose_number, taken, time_taken, notes)
    VALUES (@date, @medication, @dose_number, @taken, @time_taken, @notes)
  `).run({ date, medication: medication.toLowerCase(), dose_number, taken, time_taken, notes });

  res.json({ ok: true, id: result.lastInsertRowid });
});

// GET /api/medications?date=YYYY-MM-DD or ?start=...&end=...
router.get('/', (req, res) => {
  const { date, start, end } = req.query;
  let rows;
  if (date) {
    rows = db.prepare('SELECT * FROM medications WHERE date = ? ORDER BY medication, dose_number').all(date);
  } else if (start && end) {
    rows = db.prepare(
      'SELECT * FROM medications WHERE date >= ? AND date <= ? ORDER BY date, medication, dose_number'
    ).all(start, end);
  } else {
    rows = db.prepare('SELECT * FROM medications ORDER BY date DESC, medication LIMIT 200').all();
  }
  res.json(rows);
});

// DELETE /api/medications/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM medications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
