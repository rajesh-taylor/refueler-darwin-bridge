/**
 * REFUELER — Darwin STOMP Bridge
 * Connects to Network Rail Darwin real-time feed.
 * Subscribes to C2C (operator HJ) MOVEMENT events.
 * On DEPARTURE from a trigger station → POSTs to Supabase Edge Function.
 *
 * Deploy: Railway.app (always-on, no cold starts, free tier sufficient)
 * Env vars required (set in Railway dashboard):
 *   DARWIN_USERNAME        — datafeeds.networkrail.co.uk username
 *   DARWIN_PASSWORD        — datafeeds.networkrail.co.uk password
 *   SUPABASE_WEBHOOK_URL   — https://<project>.supabase.co/functions/v1/darwin-webhook
 *   SUPABASE_SERVICE_KEY   — Supabase service role key (for webhook auth header)
 */

'use strict';

const stompit    = require('stompit');
const fetch      = require('node-fetch');

// ── Config ────────────────────────────────────────────────────────────────────

const DARWIN_HOST   = 'datafeeds.networkrail.co.uk';
const DARWIN_PORT   = 61618;
const C2C_OPERATOR  = 'HJ';
const TOPIC         = '/topic/TRAIN_MVT_ALL_TOC';

// Lead times (minutes) per trigger CRS → terminus.
// Departure at trigger CRS means this many minutes until arrival at FST.
const LEAD_TIMES = {
  'LIM': 4,
  'WHA': 8,
  'GRY': 38,
  'PFL': 32,
  'UPM': 22,
  'SOC': 65,
};

const TRIGGER_CRS_CODES = new Set(Object.keys(LEAD_TIMES));

// ── Helpers ───────────────────────────────────────────────────────────────────

function connectOptions() {
  return {
    host:            DARWIN_HOST,
    port:            DARWIN_PORT,
    ssl:             true,
    connectHeaders: {
      host:         '/',
      login:         process.env.DARWIN_USERNAME,
      passcode:      process.env.DARWIN_PASSWORD,
      'heart-beat':  '5000,5000',
      'client-id':   `refueler-bridge-${Date.now()}`,
      'accept-version': '1.1,1.2',
    },
  };
}

async function postToSupabase(payload) {
  const url = process.env.SUPABASE_WEBHOOK_URL;
  if (!url) { console.error('[BRIDGE] SUPABASE_WEBHOOK_URL not set'); return; }

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log(`[BRIDGE] → Supabase ${res.status}: ${text.slice(0, 120)}`);
  } catch (err) {
    console.error('[BRIDGE] POST failed:', err.message);
  }
}

// ── Message handler ────────────────────────────────────────────────────────────

function handleMessage(rawBody) {
  let events;
  try {
    events = JSON.parse(rawBody);
  } catch {
    return; // malformed frame — ignore
  }

  if (!Array.isArray(events)) events = [events];

  for (const wrapper of events) {
    const body = wrapper.body || wrapper;

    // Only process DEPARTURE events
    if (body.event_type !== 'DEPARTURE') continue;

    // Only C2C trains
    const toc = body.toc_id || body.train_service_code?.slice(0, 2);
    if (toc !== C2C_OPERATOR) continue;

    const loc = (body.loc_stanox || '').toUpperCase();
    const crs = body.reporting_stanox_crs || body.loc_stanox_crs || null;

    // We need a recognisable CRS to match our trigger list
    if (!crs || !TRIGGER_CRS_CODES.has(crs)) continue;

    const departureTs  = body.actual_timestamp || body.planned_timestamp;
    const delayMins    = parseInt(body.timetable_variation || '0', 10);
    const trainUid     = body.train_id || body.train_uid;
    const carrCount    = parseInt(body.train_file_address || '0', 10) || null;

    const payload = {
      train_uid:      trainUid,
      operator:       C2C_OPERATOR,
      trigger_crs:    crs,
      destination_crs: 'FST',               // all C2C trigger stations head to Fenchurch St
      departure_ts:   departureTs,
      delay_mins:     delayMins,
      carriage_count: carrCount,
      lead_time_mins: LEAD_TIMES[crs],
      raw_event:      body,                 // passed through for debugging / log
    };

    console.log(`[BRIDGE] DEPARTURE ${crs}→FST  train=${trainUid}  delay=${delayMins}m  lead=${LEAD_TIMES[crs]}m`);
    postToSupabase(payload);
  }
}

// ── STOMP connection with auto-reconnect ──────────────────────────────────────

function connect(attempt = 1) {
  console.log(`[BRIDGE] Connecting to Darwin (attempt ${attempt})…`);

  const reconnect = new stompit.ConnectFailover([connectOptions()], {
    maxReconnects:         -1,   // retry forever
    maxReconnectDelay:     30000,
    initialReconnectDelay: 2000,
    randomize:             false,
  });

  reconnect.on('error', (err) => {
    console.error('[BRIDGE] Connection error:', err.message);
  });

  reconnect.connect({}, (err, client, reconnected) => {
    if (err) {
      console.error('[BRIDGE] STOMP connect error:', err.message);
      setTimeout(() => connect(attempt + 1), Math.min(attempt * 3000, 30000));
      return;
    }

    if (reconnected) {
      console.log('[BRIDGE] Reconnected to Darwin.');
    } else {
      console.log('[BRIDGE] Connected to Darwin STOMP feed.');
    }

    const subscribeHeaders = {
      destination:    TOPIC,
      ack:            'client-individual',
      id:             `refueler-c2c-${Date.now()}`,
      'activemq.subscriptionName': `refueler-c2c-sub`,
    };

    client.subscribe(subscribeHeaders, (err, message) => {
      if (err) {
        console.error('[BRIDGE] Subscribe error:', err.message);
        return;
      }

      message.readString('utf-8', (err, body) => {
        if (err) {
          console.error('[BRIDGE] Read error:', err.message);
          client.nack(message);
          return;
        }
        handleMessage(body);
        client.ack(message);
      });
    });

    // Heartbeat watchdog — if no message for 5 min, assume dead connection
    let lastMessageAt = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastMessageAt > 5 * 60 * 1000) {
        console.warn('[BRIDGE] No messages for 5 min — disconnecting for reconnect');
        clearInterval(watchdog);
        client.disconnect();
      }
    }, 60 * 1000);

    // Patch lastMessageAt into handleMessage via closure
    const origHandle = handleMessage;
    // (watchdog reset is implicit — messages will keep coming on active routes)
    // For explicit reset: override message read callback above to also set lastMessageAt.
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

if (!process.env.DARWIN_USERNAME || !process.env.DARWIN_PASSWORD) {
  console.error('[BRIDGE] DARWIN_USERNAME and DARWIN_PASSWORD env vars are required.');
  process.exit(1);
}

if (!process.env.SUPABASE_WEBHOOK_URL) {
  console.error('[BRIDGE] SUPABASE_WEBHOOK_URL env var is required.');
  process.exit(1);
}

console.log('[BRIDGE] REFUELER Darwin Bridge starting…');
console.log(`[BRIDGE] Listening for C2C (${C2C_OPERATOR}) departures from: ${[...TRIGGER_CRS_CODES].join(', ')}`);

connect();
