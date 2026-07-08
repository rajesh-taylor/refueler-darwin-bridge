# refueler-darwin-bridge

> Darwin Push Port → Supabase bridge for Refueler's real-time train movement intelligence.

Part of the [Refueler](https://refueler.io) infrastructure — a Bitcoin-native pre-order platform for Fenchurch Street line commuters.

---

## What it does

Connects to Network Rail's Darwin Push Port feed via STOMP. Subscribes to live train movement events for the c2c corridor (operator `HJ`). When a train departs a trigger station, it calculates the lead time to Fenchurch Street and fires a webhook to a Supabase Edge Function — which updates the order queue timing in real time.

This is the always-on companion to `rail-signal-poll` (the RDM-based departure board poller in `refueler-io`). Darwin Push Port provides movement-level granularity; `rail-signal-poll` provides schedule and service-level data. They are complementary, not redundant.

---

## Trigger stations and lead times

| CRS | Station | Lead time to FST |
|-----|---------|-----------------|
| LIM | Limehouse | 4 min |
| WHA | West Ham | 8 min |
| GRY | Grays | 38 min |
| PFL | Pitsea | 32 min |
| UPM | Upminster | 22 min |
| SOC | Shoeburyness | 65 min |

These constants live in `darwin_bridge.js` and are the primary tuning parameters for order queue timing.

---

## Stack

- **Node.js ≥ 18** — runtime
- **stompit** — STOMP 1.1/1.2 client for Darwin's ActiveMQ feed
- **node-fetch** — webhook POST to Supabase
- **Railway.app** — deployment target (always-on, no cold starts)

---

## Environment variables

Set these in Railway dashboard. Never commit values.

| Variable | Description |
|----------|-------------|
| `DARWIN_USERNAME` | Network Rail Darwin datafeeds username |
| `DARWIN_PASSWORD` | Network Rail Darwin datafeeds password |
| `SUPABASE_WEBHOOK_URL` | `https://tihgvdokeofnjxjkenmm.supabase.co/functions/v1/darwin-webhook` |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (for webhook auth header) |

> **Note:** The `darwin-webhook` Supabase Edge Function is not yet deployed. This bridge is infrastructure-ready but gated on the Darwin Push Port planning session. See `CLAUDE.md` for session queue.

---

## Local development

```bash
npm install
DARWIN_USERNAME=your_user DARWIN_PASSWORD=your_pass \
SUPABASE_WEBHOOK_URL=https://... SUPABASE_SERVICE_KEY=eyJ... \
node darwin_bridge/darwin_bridge.js
```

---

## Deployment (Railway)

A `railway.toml` is included. Connect this repo to Railway, set the four environment variables above, and deploy. The process runs persistently — no serverless cold start concerns.

---

## Relationship to other Refueler repos

| Repo | Role |
|------|------|
| [`refueler-io`](https://github.com/rajesh-taylor/refueler-io) | Web, Command Centre, Supabase Edge Functions — including `rail-signal-poll` (RDM-based poller) |
| [`refueler-app`](https://github.com/rajesh-taylor/refueler-app) | React Native consumer app |
| [`refueler-mint`](https://github.com/rajesh-taylor/refueler-mint) | CDK Rust loyalty stamp mint |
| [`refueler-share`](https://github.com/rajesh-taylor/refueler-share) | BLAKE3 + Cashu anonymous file transfer |
| [`refueler-multi-core`](https://github.com/rajesh-taylor/refueler-multi-core) | BLAKE3-accelerated ARM Bitcoin indexer |
| `refueler-darwin-bridge` (this repo) | Darwin Push Port → Supabase movement bridge |

---

## Status

**Infrastructure-ready. Not yet in production.** The `darwin-webhook` Edge Function in `refueler-io` is pending the Darwin Push Port planning session. This repo holds the bridge process and will be wired end-to-end in that session.

---

*"Nothing stops this train."*
