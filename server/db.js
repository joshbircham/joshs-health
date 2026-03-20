const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'health.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS symptoms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    pain_hands INTEGER,
    pain_shoulders INTEGER,
    pain_neck INTEGER,
    pain_upper_back INTEGER,
    pain_arms INTEGER,
    morning_stiffness_minutes INTEGER,
    swelling_level INTEGER,
    grip_strength_left INTEGER,
    grip_strength_right INTEGER,
    fatigue_level INTEGER,
    notes TEXT,
    auto_saved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    medication TEXT NOT NULL,  -- diclofenac, elvanse, inhaler, paracetamol
    dose_number INTEGER,       -- e.g. 1st, 2nd, 3rd dose of the day
    taken INTEGER DEFAULT 1,   -- 1=taken, 0=skipped
    time_taken TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS oura_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    sleep_score INTEGER,
    hrv_average REAL,
    resting_hr INTEGER,
    total_sleep_minutes INTEGER,
    deep_sleep_minutes INTEGER,
    rem_sleep_minutes INTEGER,
    sleep_efficiency REAL,
    readiness_score INTEGER,
    activity_score INTEGER,
    raw_json TEXT,
    synced_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    distance_km REAL,
    duration_minutes REAL,
    avg_hr INTEGER,
    max_hr INTEGER,
    source TEXT DEFAULT 'apple_health',  -- apple_health, manual
    raw_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS medications_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'prescribed',
    frequency TEXT NOT NULL DEFAULT 'daily',
    doses_per_day INTEGER NOT NULL DEFAULT 1,
    dose_labels TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (date('now')),
    stopped_at TEXT
  );
`);

// Migrations — add columns that may not exist in older DBs
const ouraColumns = db.prepare("PRAGMA table_info(oura_data)").all().map(c => c.name);
if (!ouraColumns.includes('efficiency')) {
  db.exec('ALTER TABLE oura_data ADD COLUMN efficiency INTEGER');
}
const symptomColumns = db.prepare("PRAGMA table_info(symptoms)").all().map(c => c.name);
if (!symptomColumns.includes('auto_saved')) {
  db.exec('ALTER TABLE symptoms ADD COLUMN auto_saved INTEGER DEFAULT 0');
}

// Seed medications config if empty
const medCount = db.prepare('SELECT COUNT(*) as n FROM medications_config').get().n;
if (medCount === 0) {
  const seedMeds = [
    { name: 'Diclofenac',   category: 'prescribed',  frequency: 'daily',     doses_per_day: 3, dose_labels: 'Morning,Midday,Evening', active: 1, notes: '' },
    { name: 'Elvanse',      category: 'prescribed',  frequency: 'daily',     doses_per_day: 1, dose_labels: 'Morning',               active: 1, notes: '' },
    { name: 'Inhaler',      category: 'prescribed',  frequency: 'daily',     doses_per_day: 2, dose_labels: 'Morning,Evening',        active: 1, notes: '' },
    { name: 'Paracetamol',  category: 'prn',         frequency: 'as_needed', doses_per_day: 4, dose_labels: 'Dose 1,Dose 2,Dose 3,Dose 4', active: 1, notes: '' },
    { name: 'Vitamin D3',   category: 'supplement',  frequency: 'daily',     doses_per_day: 1, dose_labels: 'Morning',               active: 1, notes: '' },
    { name: 'Vitamin B',    category: 'supplement',  frequency: 'daily',     doses_per_day: 1, dose_labels: 'Morning',               active: 1, notes: '' },
    { name: "Lion's Mane",  category: 'supplement',  frequency: 'daily',     doses_per_day: 1, dose_labels: 'Morning',               active: 1, notes: '' },
    { name: 'Melatonin',    category: 'supplement',  frequency: 'as_needed', doses_per_day: 1, dose_labels: 'Pre-bed',               active: 1, notes: '' },
    { name: 'Turmeric',     category: 'supplement',  frequency: 'daily',     doses_per_day: 1, dose_labels: 'Morning',               active: 0, notes: 'Paused - potential interaction' },
    { name: 'Krill Oil',    category: 'supplement',  frequency: 'daily',     doses_per_day: 1, dose_labels: 'Morning',               active: 0, notes: 'Paused - potential interaction' },
    { name: 'Magnesium',    category: 'supplement',  frequency: 'daily',     doses_per_day: 1, dose_labels: 'Morning',               active: 0, notes: 'Paused - potential interaction' },
  ];
  const ins = db.prepare(
    'INSERT INTO medications_config (name, category, frequency, doses_per_day, dose_labels, active, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertAll = db.transaction(meds => { for (const m of meds) ins.run(m.name, m.category, m.frequency, m.doses_per_day, m.dose_labels, m.active, m.notes); });
  insertAll(seedMeds);
}

module.exports = db;
