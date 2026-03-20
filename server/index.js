require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const sax = require('sax');
const multer = require('multer');

const app = express();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Long timeout for XML upload route
app.use('/api/health/import-xml', (req, res, next) => {
  res.setTimeout(300000);
  next();
});

// Routes
app.use('/api/symptoms', require('./routes/symptoms'));
app.use('/api/medications', require('./routes/medications'));
app.use('/api/oura', require('./routes/oura'));
app.use('/api/health', require('./routes/health'));

// Medications config CRUD
const db = require('./db');

app.get('/api/medications/config', (req, res) => {
  const rows = db.prepare('SELECT * FROM medications_config ORDER BY category, name').all();
  res.json(rows);
});

app.post('/api/medications/config', (req, res) => {
  const { name, category, frequency, doses_per_day, dose_labels, notes } = req.body;
  const result = db.prepare(
    'INSERT INTO medications_config (name, category, frequency, doses_per_day, dose_labels, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, category, frequency || 'daily', doses_per_day || 1, dose_labels || '', notes || '');
  res.json({ id: result.lastInsertRowid });
});

app.patch('/api/medications/config/:id', (req, res) => {
  const { active, archived, stopped_at, name, category, frequency, doses_per_day, dose_labels, notes } = req.body;
  const fields = [], values = [];
  if (active !== undefined)      { fields.push('active = ?');      values.push(active); }
  if (archived !== undefined)    { fields.push('archived = ?');    values.push(archived); }
  if (stopped_at !== undefined)  { fields.push('stopped_at = ?'); values.push(stopped_at); }
  if (name !== undefined)        { fields.push('name = ?');        values.push(name); }
  if (category !== undefined)    { fields.push('category = ?');    values.push(category); }
  if (frequency !== undefined)   { fields.push('frequency = ?');   values.push(frequency); }
  if (doses_per_day !== undefined){ fields.push('doses_per_day = ?'); values.push(doses_per_day); }
  if (dose_labels !== undefined) { fields.push('dose_labels = ?'); values.push(dose_labels); }
  if (notes !== undefined)       { fields.push('notes = ?');       values.push(notes); }
  values.push(req.params.id);
  db.prepare(`UPDATE medications_config SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

app.delete('/api/medications/config/:id', (req, res) => {
  db.prepare('DELETE FROM medications_config WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Apple Health XML — server-side streaming parser
app.post('/api/health/import-xml', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  const parser = sax.createStream(true, { lowercase: false });
  let inserted = 0;
  let processed = 0;

  const insertRun = db.prepare(`
    INSERT OR REPLACE INTO runs (date, distance_km, duration_minutes, avg_hr, max_hr, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  parser.on('opentag', node => {
    if (node.name !== 'Workout') return;
    const type = node.attributes.workoutActivityType || '';
    if (!type.includes('Running')) return;

    processed++;
    try {
      const startDate = node.attributes.startDate || '';
      const date = startDate.split(' ')[0];
      const duration = node.attributes.duration ? parseFloat(node.attributes.duration) : null;
      const distance = node.attributes.totalDistance ? parseFloat(node.attributes.totalDistance) : null;
      if (!date) return;
      insertRun.run(date, distance, duration, null, null, 'apple_health_xml');
      inserted++;
    } catch (err) {
      console.error('Row error:', err.message);
    }
  });

  parser.on('end', () => {
    fs.unlink(filePath, () => {});
    res.json({ inserted, processed });
  });

  parser.on('error', err => {
    console.error('Parse error:', err.message);
    parser._parser.error = null;
    parser._parser.resume();
  });

  fs.createReadStream(filePath).pipe(parser);
});

// Insights — calls Claude API
app.post('/api/insights', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: `You are a concise health assistant for Josh, a 32-year-old with suspected inflammatory arthritis (positive Anti-CCP at 83 U/ml, pending rheumatology referral). He runs 2-4x per week and uses an Oura ring. His main symptoms are stiff and swollen hands, shoulder, neck and upper back joint pain.

Format your response using these exact section headers with a line break between each section:
OVERALL
SLEEP + RECOVERY
RUNNING IMPACT
MEDICATIONS
WATCH OUT FOR
THIS WEEK

Keep each section to 2-3 sentences maximum. For MEDICATIONS: note whether Josh has been consistent with his Diclofenac (key anti-inflammatory, 3 doses/day) and flag any days he missed doses alongside pain levels on those days. Only include the MEDICATIONS section if medication data is present. Be warm and direct. No bullet points. No em dashes. Use plain hyphens if needed.`,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json({ analysis: data.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Josh's Health running at http://localhost:${PORT}`);
  if (!process.env.OURA_PERSONAL_ACCESS_TOKEN) {
    console.warn('  Warning: OURA_PERSONAL_ACCESS_TOKEN not set. Copy .env.example to .env and add your token.');
  }
});
