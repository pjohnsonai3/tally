// CLAIRE cloud store — Supabase is the source of truth, mirroring STEVE's pattern.
// Rows live in one table: claire_state(key text primary key, data jsonb, updated_by uuid, updated_at timestamptz).
// Collections are pulled on sign-in, pushed debounced on change, and kept live via realtime.
//
// ┌─────────────────────────────────────────────────────────────────────┐
// │ PASTE YOUR SUPABASE PROJECT CREDENTIALS HERE                        │
// │ Supabase dashboard → Project Settings → API                          │
// └─────────────────────────────────────────────────────────────────────┘
const SB_CONFIG = {
  url: 'https://ypmdlmscfjrgkesuifzz.supabase.co',
  key: 'sb_publishable_-eSiFv6P98QvoZIxkQ-4jw_1UrVUVbE'
};

// Gate level 1 — full access (owner views: schedule, projects, staff, reports).
// Anyone signing in with an address NOT on this list gets level 2 (their own timesheet only).
const ADMIN_EMAILS = [
  'lajohnson@ai3online.com',
  'dmaas@ai3online.com',
  'pjohnson@ai3online.com'
];

const STATE_KEYS = ['staff', 'projects', 'assign', 'assignDetail', 'entries', 'submitted'];
const SB_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

let client = null, user = null, ready = false, initError = '';
let pushTimer = null, channel = null;
const hashes = {};
const listeners = { change: [], auth: [] };

const configured = () => SB_CONFIG.url.indexOf('http') === 0 && SB_CONFIG.key.indexOf('PASTE') < 0;
const hash = (v) => JSON.stringify(v).length + ':' + JSON.stringify(v).slice(0, 400);
const emit = (evt, payload) => listeners[evt].forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });

function loadLib() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SB_LIB;
    s.onload = res;
    s.onerror = () => rej(new Error('Could not load the Supabase library.'));
    document.head.appendChild(s);
  });
}

export function isConfigured() { return configured(); }
export function getInitError() { return initError; }
export function currentUser() { return user; }
export function accessLevel(u) {
  const e = ((u || user || {}).email || '').toLowerCase().trim();
  if (!e) return null;
  return ADMIN_EMAILS.map(x => x.toLowerCase()).indexOf(e) >= 0 ? 'admin' : 'staff';
}
export function onChange(fn) { listeners.change.push(fn); }
export function onAuth(fn) { listeners.auth.push(fn); }

export async function init() {
  if (!configured()) { initError = 'Supabase credentials have not been filled in yet (see claire-cloud.js).'; return null; }
  try { await loadLib(); } catch (e) { initError = e.message; return null; }
  try { client = window.supabase.createClient(SB_CONFIG.url, SB_CONFIG.key); }
  catch (e) { initError = 'createClient failed: ' + (e.message || e); return null; }
  try {
    const { data } = await client.auth.getSession();
    user = data && data.session ? data.session.user : null;
  } catch (e) { console.error(e); }
  client.auth.onAuthStateChange((_e, sess) => { user = sess ? sess.user : null; emit('auth', user); });
  return user;
}

export async function signIn(email, password) {
  if (!client) return { error: initError || 'Cloud not available.' };
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { error: error.message || 'Sign-in failed.' };
  user = data.user;
  return { user };
}

export async function signOut() {
  if (client) await client.auth.signOut();
  user = null; ready = false;
  if (channel) { try { client.removeChannel(channel); } catch (e) {} channel = null; }
}

// Pull every collection. Returns a {key: value} map of whatever the cloud holds;
// keys absent from the cloud are omitted so the caller keeps its seeded defaults.
export async function pull() {
  if (!client) return {};
  const { data, error } = await client.from('claire_state').select('key,data');
  if (error) { console.error('[claire] cloud pull failed', error); throw error; }
  const out = {};
  (data || []).forEach(r => { if (STATE_KEYS.indexOf(r.key) >= 0) { out[r.key] = r.data; hashes[r.key] = hash(r.data); } });
  ready = true;
  return out;
}

// Seed the cloud from local state — only writes keys that do not exist yet.
export async function seed(state) {
  if (!client || !user) return;
  const rows = STATE_KEYS.filter(k => hashes[k] === undefined && state[k] !== undefined)
    .map(k => ({ key: k, data: state[k], updated_by: user.id }));
  if (!rows.length) return;
  const { error } = await client.from('claire_state').upsert(rows, { onConflict: 'key' });
  if (error) console.error('[claire] cloud seed failed', error);
  else rows.forEach(r => { hashes[r.key] = hash(r.data); });
}

export function schedulePush(getState) {
  if (!client || !user || !ready) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push(getState()), 800);
}

export async function push(state) {
  if (!client || !user || !ready) return;
  const rows = [];
  STATE_KEYS.forEach(k => {
    if (state[k] === undefined) return;
    const h = hash(state[k]);
    if (h !== hashes[k]) rows.push({ key: k, data: state[k], updated_by: user.id, updated_at: new Date().toISOString() });
  });
  if (!rows.length) return;
  const { error } = await client.from('claire_state').upsert(rows, { onConflict: 'key' });
  if (error) { console.error('[claire] cloud save failed', error); return { error }; }
  rows.forEach(r => { hashes[r.key] = hash(r.data); });
  return { saved: rows.map(r => r.key) };
}

export function subscribe() {
  if (!client || channel) return;
  channel = client.channel('claire_state-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'claire_state' }, (payload) => {
      const row = payload.new || {};
      if (!row.key || STATE_KEYS.indexOf(row.key) < 0) return;
      if (row.updated_by && user && row.updated_by === user.id) return; // our own write echoing back
      const h = hash(row.data);
      if (h === hashes[row.key]) return;
      hashes[row.key] = h;
      emit('change', { key: row.key, data: row.data });
    })
    .subscribe();
}

export const stateKeys = STATE_KEYS;
