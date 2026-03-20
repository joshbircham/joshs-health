const axios = require('axios');

const BASE_URL = 'https://api.ouraring.com/v2';

function getClient() {
  const token = process.env.OURA_PERSONAL_ACCESS_TOKEN;
  if (!token) throw new Error('OURA_PERSONAL_ACCESS_TOKEN not set in .env');

  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Format a Date object or date string as YYYY-MM-DD
function toISODate(d) {
  return new Date(d).toISOString().split('T')[0];
}

/**
 * Fetch daily sleep summaries for a date range.
 * Returns an array of { date, score, contributors } objects.
 */
async function fetchSleep(startDate, endDate) {
  const client = getClient();
  const { data } = await client.get('/usercollection/daily_sleep', {
    params: { start_date: toISODate(startDate), end_date: toISODate(endDate) },
  });
  return data.data || [];
}

/**
 * Fetch detailed sleep sessions (includes HRV, resting HR) for a date range.
 */
async function fetchSleepSessions(startDate, endDate) {
  const client = getClient();
  const { data } = await client.get('/usercollection/sleep', {
    params: { start_date: toISODate(startDate), end_date: toISODate(endDate) },
  });
  return data.data || [];
}

/**
 * Fetch daily readiness scores for a date range.
 */
async function fetchReadiness(startDate, endDate) {
  const client = getClient();
  const { data } = await client.get('/usercollection/daily_readiness', {
    params: { start_date: toISODate(startDate), end_date: toISODate(endDate) },
  });
  return data.data || [];
}

/**
 * Fetch daily activity scores for a date range.
 */
async function fetchActivity(startDate, endDate) {
  const client = getClient();
  const { data } = await client.get('/usercollection/daily_activity', {
    params: { start_date: toISODate(startDate), end_date: toISODate(endDate) },
  });
  return data.data || [];
}

/**
 * Pull all relevant Oura data for a date range and return merged daily records.
 * Each record: { date, sleep_score, hrv_average, resting_hr, total_sleep_minutes,
 *                deep_sleep_minutes, rem_sleep_minutes, sleep_efficiency,
 *                readiness_score, activity_score }
 */
async function fetchAllForRange(startDate, endDate) {
  const [sleepSummaries, sleepSessions, readiness, activity] = await Promise.all([
    fetchSleep(startDate, endDate),
    fetchSleepSessions(startDate, endDate),
    fetchReadiness(startDate, endDate),
    fetchActivity(startDate, endDate),
  ]);

  // Index by date
  const byDate = {};

  for (const s of sleepSummaries) {
    const d = s.day;
    byDate[d] = byDate[d] || { date: d };
    byDate[d].sleep_score = s.score;
  }

  // Sleep sessions may have multiple entries per night — use the "long sleep" type
  for (const s of sleepSessions) {
    const d = s.day;
    if (s.type !== 'long_sleep' && s.type !== 'sleep') continue;
    byDate[d] = byDate[d] || { date: d };
    // Average HRV is in average_hrv field
    if (s.average_hrv != null) byDate[d].hrv_average = s.average_hrv;
    if (s.lowest_heart_rate != null) byDate[d].resting_hr = s.lowest_heart_rate;
    if (s.total_sleep_duration != null)
      byDate[d].total_sleep_minutes = Math.round(s.total_sleep_duration / 60);
    if (s.deep_sleep_duration != null)
      byDate[d].deep_sleep_minutes = Math.round(s.deep_sleep_duration / 60);
    if (s.rem_sleep_duration != null)
      byDate[d].rem_sleep_minutes = Math.round(s.rem_sleep_duration / 60);
    if (s.efficiency != null) byDate[d].sleep_efficiency = s.efficiency;
    byDate[d]._session_raw = s;
  }

  for (const r of readiness) {
    const d = r.day;
    byDate[d] = byDate[d] || { date: d };
    byDate[d].readiness_score = r.score;
  }

  for (const a of activity) {
    const d = a.day;
    byDate[d] = byDate[d] || { date: d };
    byDate[d].activity_score = a.score;
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Quick connection test — fetches personal info endpoint.
 */
async function testConnection() {
  const client = getClient();
  const { data } = await client.get('/usercollection/personal_info');
  return data;
}

module.exports = { fetchAllForRange, fetchSleep, fetchSleepSessions, fetchReadiness, fetchActivity, testConnection };
