# conversion-sync

**When a deal closes in HubSpot, Meta and Google Ads hear about the sale.**

Your ads optimize for the people who click. Your money comes from the people who buy, and that happens later, in your CRM, after a call or an invoice. The ad platforms never see it. So they keep finding more clickers.

conversion-sync closes that gap. It is a small Cloudflare Worker. When a deal in HubSpot moves to a won stage, it sends Meta a `Purchase` event with the deal's value, through the Conversions API. When Google Ads is set up, it also sends Google Ads an offline conversion with the same value, through Google's Data Manager API. Both platforms can then learn from real sales.

## What it does today

- **Listens to HubSpot.** A HubSpot webhook calls the Worker when a deal's stage changes. The Worker checks HubSpot's v3 signature and rejects a request dated more than 5 minutes from now.
- **Picks out real sales.** Only a move into a won stage counts. You choose which stages count.
- **Finds the buyer.** It reads the deal's amount, close date and currency (`DEFAULT_CURRENCY` when the deal has none), and the email, phone and Google click id (gclid) of the first contact HubSpot lists on the deal.
- **Protects personal data.** Email and phone are normalized and SHA-256 hashed before they leave, as Meta and Google require. A phone saved without a country code gets `DEFAULT_PHONE_COUNTRY_CODE`; Google gets it in E.164 form, with a `+` before the country code; a phone with no country code and no default is left out for Google. Raw identifiers are never sent or stored.
- **Sends Google Ads the sale, matched to the ad click.** Google gets the deal's amount and currency, the contact's gclid when HubSpot saved one, and the hashed email and phone. The gclid ties the sale to the exact click; the email and phone still match a contact that has no gclid. Google's `requestId` for each send is kept in the sync log, so you can look up later how Google matched the sale.
- **Sends each sale once.** Every deal gets a fixed conversion id (`hubspot-deal-<deal id>`, see ADR 0002): Meta's `event_id` and Google's `transactionId`. Before sending, the Worker claims the deal in a small D1 table in one atomic step, so two deliveries of the same deal cannot both send. Meta does not remove repeat server events for you, so this table is the guard.
- **Tracks each ad platform on its own.** Each ad platform is a destination: Meta always, Google Ads when its settings are present. The D1 table keeps one row per deal and destination. When a sale reaches one platform and fails for another, only the failed one is tried again.
- **Retries failures.** The Worker syncs before it answers HubSpot. If HubSpot or any destination fails, it answers `503`, and HubSpot delivers the webhook again later. A destination that already has the deal is skipped on the redelivery. A deal another attempt is still sending also gets `503`, and an attempt that died mid-send is taken over after 5 minutes.
- **Skips what a platform would reject, and says why.** Each deal is logged per destination as `sent`, `failed` (with the reason), `skipped_no_email`, `skipped_no_amount`, `skipped_too_old` or `rejected`. A sale whose ad click is older than the Google conversion action's window is refused by Google for good; it is logged as `rejected` and not retried. Any other Google error, such as a wrong account or conversion action id, stays `failed` and is retried. Each destination sets its own age limit. Meta skips a deal that closed more than 7 days ago, because Meta refuses older events. Google skips a deal that closed more than 90 days ago, because a Google Ads conversion action counts a sale at most 90 days after the click. So a sale 8 to 90 days old still goes to Google. A close date in the future is sent as today.

## What it does not do yet

- Consent signals for Google. Google recommends sending whether the buyer consented to ad use of their data. Which value to send is a legal call for the operator, so no consent fields are sent until that is decided. Google says conversions without consent may not be attributed.
- Checking how Google matched a sale. Google matches a sale after it accepts it, and the result can be looked up 30 minutes to 24 hours later. The Worker keeps the `requestId` but does not ask Google for the result.
- A live Google Ads test. The Google request follows Google's Data Manager documentation and is tested against fake Google answers; it has not yet run against a real Google Ads account.
- A screen that shows the sync log. Today you read it with a D1 query.
- Large batches. HubSpot expects an answer within about 5 seconds, and the Worker syncs each deal in a batch before answering.

## How it is built

- TypeScript on Cloudflare Workers, with D1 for the sync log.
- Written test-first with Vitest. The tests cover the signature check, the won-stage filter, the HubSpot read, the hashing rules, the Meta event and the Google request, the Google sign-in (the token's header and payload checked against values encoded with `openssl`, the signature verified with a key made for each run), the send-once rule per destination and the Worker's answers to HubSpot. The D1 claim query and the migrations were checked by hand against real SQLite; no automated test runs that SQL yet.
- No AI model sits in the path. A sale is plain data, so the sync stays cheap and predictable.

```
src/hubspot.ts      verify the webhook, filter won deals, read deal + contact
src/destination.ts  the destination seam and the conversion id
src/meta.ts         the Meta destination: normalize, hash, build and send the Purchase event
src/google.ts       the Google Ads destination: build and send the Data Manager conversion event
src/google-auth.ts  the Google service-account sign-in: a signed JWT traded for an access token
src/sync.ts         one won deal → each destination, at most once each
src/store.ts        the D1 sync log, one row per deal and destination
src/index.ts        the Worker: POST /webhooks/hubspot
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

## Add Google Ads (optional, one time)

Google Ads stays off until `GOOGLE_ADS_ACCOUNT_ID`, `GOOGLE_CONVERSION_ACTION_ID` and `GOOGLE_SERVICE_ACCOUNT_KEY` are all set. The Worker signs in as a Google Cloud service account and gets a fresh access token for each send, so there is no refresh token that expires after 7 days and no OAuth app review.

1. **Make a Google Cloud project**, or pick one, and turn on the **Data Manager API** in it.
2. **Make a service account** in that project and download a JSON key for it. Store the whole file as a secret, then delete the download:
   `npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY < service-account-key.json`
3. **Give the service account access to Google Ads.** Add the service account's email as a user of the Google Ads account that will own the conversions. If you add it to a manager account instead, set `GOOGLE_LOGIN_ACCOUNT_ID` to that manager account's id.
4. **Make the conversion action** in Google Ads: a Website conversion of the type "Import from clicks", and keep it enabled. Wait 4 to 6 hours before the first sale is sent; Google rejects uploads to a conversion action that new.
5. **Set the settings** in `wrangler.toml` under `[vars]`: `GOOGLE_ADS_ACCOUNT_ID` (the Google Ads account id; the hyphens are fine) and `GOOGLE_CONVERSION_ACTION_ID` (the conversion action's id). Then `bun run deploy`.

The gclid is read from the HubSpot contact property `hs_google_click_id` ("Google ad click ID"). That internal name comes from community posts, not HubSpot's documentation. Check it in your portal with `GET /crm/v3/properties/contacts/hs_google_click_id`, and set `GOOGLE_GCLID_PROPERTY` if yours differs.

## Resend failed sales

HubSpot stops redelivering a webhook after about a day. To resend deals that stayed `failed` after that, for example after fixing a setting, clear their rows and move the deals out of and back into the won stage:

```sh
npx wrangler d1 execute conversion-sync --remote --command "DELETE FROM sync_log WHERE status = 'failed'"
```

## Want this on your account?

I set this up for teams that run HubSpot with Meta or Google ads: your won stages, your fields, your pixel and conversion action. Find me on Upwork as **Tan Khoi L.**, "AI Agent Builds | Claude Code Setup | CRM to Ads Sync".
