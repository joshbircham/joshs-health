const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /api/symptoms — upsert a symptom entry (one per date)
router.post('/', (req, res) => {
  const s = req.body;
  if (!s.date) return res.status(400).json({ error: 'date required' });

  db.prepare(`
    INSERT OR REPLACE INTO symptoms (
      date, pain_hands, pain_shoulders, pain_neck, pain_upper_back, pain_arms,
      morning_stiffness_minutes, swelling_level, grip_strength_left,
      grip_strength_right, fatigue_level, notes, auto_saved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    s.date,
    s.pain_hands, s.pain_shoulders, s.pain_neck, s.pain_upper_back, s.pain_arms,
    s.morning_stiffness_minutes, s.swelling_level,
    s.grip_strength_left, s.grip_strength_right,
    s.fatigue_level, s.notes,
    s.auto_saved || 0
  );

  res.json({ ok: true });
});

// PUT /api/symptoms/:id — update an entry
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM symptoms WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const updated = { ...existing, ...req.body, id };
  db.prepare(`
    UPDATE symptoms SET
      date = @date, pain_hands = @pain_hands, pain_shoulders = @pain_shoulders,
      pain_neck = @pain_neck, pain_upper_back = @pain_upper_back, pain_arms = @pain_arms,
      morning_stiffness_minutes = @morning_stiffness_minutes, swelling_level = @swelling_level,
      grip_strength_left = @grip_strength_left, grip_strength_right = @grip_strength_right,
      fatigue_level = @fatigue_level, notes = @notes
    WHERE id = @id
  `).run(updated);

  res.json({ ok: true });
});

// GET /api/symptoms?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/', (req, res) => {
  const { start, end } = req.query;
  let rows;
  if (start && end) {
    rows = db.prepare(
      'SELECT * FROM symptoms WHERE date >= ? AND date <= ? ORDER BY date'
    ).all(start, end);
  } else {
    rows = db.prepare('SELECT * FROM symptoms ORDER BY date DESC LIMIT 90').all();
  }
  res.json(rows);
});

// GET /api/symptoms/:date — get entry for a specific date
router.get('/:date', (req, res) => {
  const row = db.prepare('SELECT * FROM symptoms WHERE date = ?').get(req.params.date);
  res.json(row || null);
});

module.exports = router;
