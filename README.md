# conversion-sync

**When a deal closes in HubSpot, Meta hears about the sale.**

Your ads optimize for the people who click. Your money comes from the people who buy, and that happens later, in your CRM, after a call or an invoice. Meta never sees it. So it keeps finding more clickers.

conversion-sync closes that gap. It is a small Cloudflare Worker. When a deal in HubSpot moves to "Closed won", it sends Meta a `Purchase` event with the deal's value, through the Conversions API. Meta can then learn from real sales.

## What it does today (v0)

- **Listens to HubSpot.** A HubSpot webhook calls the Worker when a deal's stage changes. The Worker checks HubSpot's v3 signature and rejects anything older than 5 minutes.
- **Picks out real sales.** Only a move into a won stage counts. You choose which stages count.
- **Finds the buyer.** It reads the deal's amount, close date and currency, and the email and phone of its first contact.
- **Protects personal data.** Email and phone are normalized and SHA-256 hashed before they leave, as Meta requires. Raw identifiers are never sent or stored.
- **Sends each sale once.** Every deal gets a fixed `event_id`. A small D1 table remembers what was sent, so HubSpot's retries never double-count a sale. Meta also drops duplicates by `event_id`.
- **Keeps a record.** Each deal is logged as `sent`, `failed` (with the reason) or `skipped_no_email`. A failed deal is sent again on HubSpot's next retry.

## What it does not do yet

- Google Ads offline conversions. That is the next destination.
- Replay of failed deals on a schedule.
- A setup screen. Today you set it up with Wrangler and three secrets.

## How it is built

- TypeScript on Cloudflare Workers, with D1 for the sync log.
- Written test-first with Vitest. The tests cover the signature check, the won-stage filter, the hashing rules, the event shape and the no-double-send rule.
- No AI model sits in the path. A sale is plain data, so the sync stays cheap and predictable.

```
src/hubspot.ts   verify the webhook, filter won deals, read deal + contact
src/meta.ts      normalize, hash, build and send the Purchase event
src/sync.ts      one won deal → one event, logged once
src/store.ts     the D1 sync log
src/index.ts     the Worker: POST /webhooks/hubspot
```

## Run it

```sh
bun install
bun run test

npx wrangler d1 create conversion-sync        # put the id in wrangler.toml
bun run db:migrate --remote
npx wrangler secret put HUBSPOT_CLIENT_SECRET  # your HubSpot app's client secret
npx wrangler secret put HUBSPOT_TOKEN          # private app: crm.objects.deals.read, crm.objects.contacts.read
npx wrangler secret put META_PIXEL_ID
npx wrangler secret put META_ACCESS_TOKEN
bun run deploy
```

Then, in your HubSpot app, subscribe to `deal.propertyChange` for `dealstage` and point the webhook at `https://<your-worker>/webhooks/hubspot`.

To test without touching live data, set `META_TEST_EVENT_CODE`. The events then show up under **Test events** in Meta's Events Manager.

## Want this on your account?

I set this up for teams that run HubSpot and Meta ads: your won stages, your fields, your pixel. Find me on Upwork as **Tan Khoi L.**, "AI Agent Builds | Claude Code Setup | CRM to Ads Sync".

