# CLAUDE.md — refueler-darwin-bridge
> **Version:** 1.0 | **Initialised:** CC-64 · 8 July 2026
> Load `README.md` alongside this file. For full project context load `claude.md` and `Refueler_MasterContext_CC64.md` from `refueler-io`.

---

## Purpose

Always-on Node.js bridge: Network Rail Darwin Push Port (STOMP) → Supabase `darwin-webhook` Edge Function.

Subscribes to live train movement events for c2c corridor (operator `HJ`). On departure from a trigger station, calculates lead time to Fenchurch Street Terminal and fires a Supabase webhook to update order queue timing.

**Status:** Infrastructure-ready. Not in production. Gated on Darwin Push Port planning session (see session queue below).

---

## Architecture position

This bridge is complementary to — not a replacement for — `rail-signal-poll` in `refueler-io`:

- `rail-signal-poll` — pg_cron Edge Function, polls RDM departure board feeds every 2 min. Provides schedule and service-level data.
- `darwin_bridge.js` — persistent STOMP connection to Darwin Push Port. Provides train movement granularity (actual departures, not scheduled).

Both feed into order timing logic. Darwin Push Port is higher fidelity; RDM feeds are the current live data source.

---

## Key file

| File | Role |
|------|------|
| `darwin_bridge/darwin_bridge.js` | Main bridge process — STOMP connection, movement filtering, Supabase POST |
| `darwin_bridge/package.json` | Node dependencies: `stompit`, `node-fetch` |
| `railway.toml` | Railway.app deployment config |

---

## Environment variables (Railway dashboard)

| Variable | Description |
|----------|-------------|
| `DARWIN_USERNAME` | Network Rail datafeeds.networkrail.co.uk login |
| `DARWIN_PASSWORD` | Network Rail datafeeds.networkrail.co.uk password |
| `SUPABASE_WEBHOOK_URL` | `https://tihgvdokeofnjxjkenmm.supabase.co/functions/v1/darwin-webhook` |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |

---

## Trigger CRS codes and lead times

These constants are in `darwin_bridge.js`. Tune these when field-validating actual journey times.

```js
const LEAD_TIMES = {
  'LIM': 4,   // Limehouse
  'WHA': 8,   // West Ham
  'GRY': 38,  // Grays
  'PFL': 32,  // Pitsea
  'UPM': 22,  // Upminster
  'SOC': 65,  // Shoeburyness
};
```

---

## What is NOT yet built

- `darwin-webhook` Edge Function in `refueler-io` — the Supabase endpoint this bridge POSTs to. Must be built in the Darwin Push Port planning session before this bridge goes live.
- Railway deployment has not been provisioned.
- Credentials not yet obtained from Network Rail (separate registration required at datafeeds.networkrail.co.uk).

---

## Session queue

| Session | Item |
|---------|------|
| Darwin Push Port session (future) | Build `darwin-webhook` Edge Function, provision Railway, wire end-to-end, field-validate lead times |

---

## Locked decisions

- C2C operator code: `HJ`. Never `CC` — that is an ATOC code, not the Darwin operator code.
- Topic subscription: `/topic/TRAIN_MVT_ALL_TOC` (all TOC movements, filtered by operator in bridge logic).
- Deploy target: Railway.app. Not Supabase Edge Functions — this must be always-on with no cold starts.
- STOMP version: 1.1/1.2 (Darwin requirement).
