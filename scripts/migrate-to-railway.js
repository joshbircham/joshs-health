const BASE = 'https://joshs-health.up.railway.app';

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function run() {
  const symptoms  = require('/tmp/symptoms.json');
  const meds      = require('/tmp/medications.json');
  const oura      = require('/tmp/oura.json');
  const runs      = require('/tmp/runs.json');

  console.log(`Migrating: ${symptoms.length} symptoms, ${meds.length} medications, ${oura.length} oura rows, ${runs.length} runs`);

  // Symptoms — upsert by date
  for (const s of symptoms) {
    await post('/api/symptoms', s);
    process.stdout.write('.');
  }
  console.log(`\n✓ symptoms`);

  // Medications log
  for (const m of meds) {
    await post('/api/medications', {
      date: m.date,
      medication: m.medication,
      dose_number: m.dose_number,
      taken: m.taken,
      time_taken: m.time_taken,
      notes: m.notes,
    });
    process.stdout.write('.');
  }
  console.log(`\n✓ medications`);

  // Oura data — POST via sync isn't ideal, so use a bulk-insert endpoint if available
  // We'll add a temporary import endpoint
  for (const o of oura) {
    await post('/api/oura/import', o);
    process.stdout.write('.');
  }
  console.log(`\n✓ oura`);

  // Runs
  for (const r of runs) {
    await post('/api/health/runs', {
      date: r.date,
      distance_km: r.distance_km,
      duration_minutes: r.duration_minutes,
      avg_hr: r.avg_hr,
      max_hr: r.max_hr,
      source: r.source,
    });
    process.stdout.write('.');
  }
  console.log(`\n✓ runs`);

  console.log('\nMigration complete.');
}

run().catch(console.error);
