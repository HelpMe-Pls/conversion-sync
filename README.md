# conversion-sync

**When a deal closes in HubSpot, Meta hears about the sale.**

Your ads optimize for the people who click. Your money comes from the people who buy, and that happens later, in your CRM, after a call or an invoice. Meta never sees it. So it keeps finding more clickers.

conversion-sync closes that gap. It is a small Cloudflare Worker. When a deal in HubSpot moves to a won stage, it sends Meta a `Purchase` event with the deal's value, through the Conversions API. Meta can then learn from real sales.

## What it does today (v0)

- **Listens to HubSpot.** A HubSpot webhook calls the Worker when a deal's stage changes. The Worker checks HubSpot's v3 signature and rejects a request dated more than 5 minutes from now.
- **Picks out real sales.** Only a move into a won stage counts. You choose which stages count.
- **Finds the buyer.** It reads the deal's amount, close date and currency (`DEFAULT_CURRENCY` when the deal has none), and the email and phone of the first contact HubSpot lists on the deal.
- **Protects personal data.** Email and phone are normalized and SHA-256 hashed before they leave, as Meta requires. A phone saved without a country code gets `DEFAULT_PHONE_COUNTRY_CODE`. Raw identifiers are never sent or stored.
- **Sends each sale once.** Every deal gets a fixed `event_id` (`hubspot-deal-<deal id>`). Before sending, the Worker claims the deal in a small D1 table in one atomic step, so two deliveries of the same deal cannot both send. Meta does not remove repeat server events for you, so this table is the guard.
- **Retries failures.** The Worker syncs before it answers HubSpot. If HubSpot or Meta fails, it answers `503`, and HubSpot delivers the webhook again later. Deals already sent are skipped on the redelivery. A deal another attempt is still sending also gets `503`, and an attempt that died mid-send is taken over after 5 minutes.
- **Skips what Meta would reject, and says why.** Each deal is logged as `sent`, `failed` (with the reason), `skipped_no_email`, `skipped_no_amount` or `skipped_too_old`. A deal that closed more than 7 days ago is skipped, because Meta refuses older events. A close date in the future is sent as today.

## What it does not do yet

- Google Ads offline conversions. That is the next destination.
- A screen that shows the sync log. Today you read it with a D1 query.
- Large batches. HubSpot expects an answer within about 5 seconds, and the Worker syncs each deal in a batch before answering.

## How it is built

- TypeScript on Cloudflare Workers, with D1 for the sync log.
- Written test-first with Vitest. The tests cover the signature check, the won-stage filter, the HubSpot read, the hashing rules, the event shape, the send-once rule and the Worker's answers to HubSpot.
- No AI model sits in the path. A sale is plain data, so the sync stays cheap and predictable.

```
src/hubspot.ts   verify the webhook, filter won deals, read deal + contact
src/meta.ts      normalize, hash, build and send the Purchase event
src/sync.ts      one won deal → one event, sent at most once
src/store.ts     the D1 sync log
src/index.ts     the Worker: POST /webhooks/hubspot
```

## Run it

```sh
bun install
bun run test

npx wrangler d1 create conversion-sync        # put the id in wrangler.toml
npx wrangler d1 migrations apply conversion-sync --remote
npx wrangler secret put HUBSPOT_CLIENT_SECRET  # the client secret of the app that owns the webhook
npx wrangler secret put HUBSPOT_TOKEN          # that app's access token: crm.objects.deals.read, crm.objects.contacts.read
npx wrangler secret put META_PIXEL_ID
npx wrangler secret put META_ACCESS_TOKEN
bun run deploy
```

Use one HubSpot private app for both secrets. In its **Webhooks** tab, set the target URL to `https://<your-worker>/webhooks/hubspot` and subscribe to deal property changes on `dealstage`. Set `WON_STAGES` to your won stage IDs; custom pipelines use numeric IDs.

`META_TEST_EVENT_CODE` shows events under **Test events** in Meta's Events Manager. Meta still keeps them and uses them for ads, and the sync log marks those deals as sent. Use it only with test deals.

## Want this on your account?

I set this up for teams that run HubSpot and Meta ads: your won stages, your fields, your pixel. Find me on Upwork as **Tan Khoi L.**, "AI Agent Builds | Claude Code Setup | CRM to Ads Sync".
