# Google Ads offline conversions from a Cloudflare Worker (checked 2026-10-25)

**Bottom line:** build on the **Data Manager API** (`POST https://datamanager.googleapis.com/v1/events:ingest`). It needs no developer token. The Google Ads API upload path is closed to new integrations.

## 1. Which API

- **Google Ads API `UploadClickConversions`** (the current version is v26, released 2026-10-14 [R1]). "Starting June 15, 2026, UploadClickConversions requests will fail if the developer token hasn't previously sent requests… Use the Data Manager API instead" [R2]. Tokens with no uploads between 2025-12-17 and 2026-06-15 get `CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE` [R3]. The REST URL `POST /v26/customers/{id}:uploadClickConversions` is **UNVERIFIED**.
- **Enhanced conversions for leads** uses the same call with hashed `user_identifiers`. It is also moving to the Data Manager API [R4].
- **Data Manager API:** it became generally available in v1.3 (2025-10-06), and the latest release is v1.8 (2026-07-30) [R5]. Google calls it "the new standard… All future functionalities… will be launched exclusively on this platform" [R6]. **This is Google's recommendation.**

## 2. Payload (Data Manager)

- **Destination:** set `operatingAccount {accountType: GOOGLE_ADS, accountId}` to the conversion customer, with no hyphens. Set `loginAccount` to the account the credential is a user of. Set `productDestinationId` to the ID of the conversion action [R7]. A parent or child account does not work as the operating account [R8].
- **Conversion action:** create it first, with type `UPLOAD_CLICKS` ("Website (Import from clicks)") [R7], and keep it ENABLED [R2]. Wait 4-6h before the first upload [R9]. Otherwise you get `CONVERSION_ACTION_TOO_RECENTLY_CREATED` [R10].
- **Identifiers:** an event needs at least one of `adIdentifiers.gclid`, `gbraid`/`wbraid`, `userData` or an IP address [R7]. Google recommends that you send the gclid and the hashed email or phone together [R2]. The gclid is case sensitive [R9].
- **Hashing:** SHA-256, encoded as the request's `encoding` says (`HEX` or Base64). Trim and lowercase an email. Write a phone in E.164 (`+18005550199`) [R7]. The Google samples also remove dots before `@gmail.com` [R2].
- **Required fields:** `eventTimestamp` in RFC 3339 with an offset (`2025-06-10T15:07:01-05:00`), and `eventSource` (for example `WEB`) [R7][R8].
- **Value:** `conversionValue` in currency units, not micros, and `currency` as ISO 4217 [R8].
- **Dedup:** `transactionId` replaces `order_id`. A second event with the same ID on the same action counts as an **adjustment**, not as an error [R8].
- **Lookback:** each conversion action has a click-through window of up to 90 days [R11]. An older click fails with `EVENT_TIME_INVALID` [R10] (`EXPIRED_EVENT` in the Google Ads API [R12]).
- **Batch:** up to 2,000 events per request. `validateOnly: true` checks a request without saving it [R13][R14].

## 3. Auth

- **Developer token:** "We sunset developer tokens on September 9, 2026." Google Ads API access now belongs to the Cloud project (Test, Explorer, Basic and Standard levels). Test works on test accounts only [R15]. Data Manager lists the token as "Not required" [R8].
- **OAuth from a Worker:** turn on the Data Manager API in the Cloud project. Use the scope `https://www.googleapis.com/auth/datamanager`, which is sensitive [R16]. The refresh is a plain form POST (`grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`) to `https://www.googleapis.com/oauth2/v3/token`, so `fetch` can do it [R17]. Two catches: an app still in "Testing" gets refresh tokens that expire in 7 days [R18], and user credentials need OAuth verification in the end [R16]. A service account needs no verification, but the Worker must then sign a JWT. Add the email of the user or service account to the Ads account or its manager [R16].
- **`login-customer-id`:** the Google Ads API needs this header only when you sign in through a manager account [R19]. In Data Manager, `loginAccount` does this job [R7].
- **Consent:** `consent {adUserData, adPersonalization}` goes on the request or on each event [R13]. Google "highly" recommends it, because conversions without it may not be attributed [R2]. A rule that consent is **required** for EEA users on this path is **UNVERIFIED**.

## 4. HubSpot

- "Google ad click ID" is a **contact** property, "automatically set by HubSpot based on a Google Click identifier (GCLID)" [R20]. HubSpot's own Google Ads sync reads it from the contact [R21].
- The internal name `hs_google_click_id` is **UNVERIFIED**, because only community posts give it. Check it with `GET /crm/v3/properties/contacts/hs_google_click_id`. A deal-level gclid property is **UNVERIFIED**, so read the gclid from the deal's associated contact. HubSpot's own sync cannot send the deal amount ("The Use the Deal amount option is no longer available") [R21].

## 5. Errors and limits

- **Data Manager is fast-fail.** If a required field fails, Google rejects the whole request and processes none of it [R22]. Matching runs later: save the `requestId` and call `requestStatus:retrieve` from 30min up to 24h later. Each destination returns SUCCESS, PARTIAL_SUCCESS or FAILURE [R23].
- **The Google Ads API** requires `partial_failure: true`, and row errors come back in `partial_failure_error` [R2].
- **Quota:** 300 requests a minute per project; above that, `RESOURCE_EXHAUSTED` [R14]. A few deals a day is far below the limit.

## Sources
R1 developers.google.com/google-ads/api/docs/release-notes · R2 …/google-ads/api/docs/conversions/upload-offline · R3 …/google-ads/api/docs/deprecations · R4 support.google.com/google-ads/answer/2998031 · R5 developers.google.com/data-manager/api/reference · R6 …/data-manager/api · R7 …/data-manager/api/devguides/events/google-ads/offline/send-events · R8 …/offline/upgrade and …/offline/upgrade/field-mappings · R9 support.google.com/google-ads/answer/7012522 · R10 …/data-manager/api/reference/rest/v1/ErrorReason · R11 support.google.com/google-ads/answer/3123169 · R12 …/google-ads/api/reference/rpc/v26/ConversionUploadErrorEnum.ConversionUploadError · R13 …/data-manager/api/reference/rest/v1/events/ingest · R14 …/data-manager/api/devguides/limits · R15 …/google-ads/api/docs/api-policy/developer-token · R16 …/data-manager/api/devguides/quickstart/set-up-access · R17 …/google-ads/api/rest/auth · R18 developers.google.com/identity/protocols/oauth2 · R19 …/google-ads/api/docs/concepts/call-structure · R20 knowledge.hubspot.com/properties/hubspots-default-contact-properties · R21 knowledge.hubspot.com/ads/create-and-sync-ad-conversion-events-with-your-google-ads-account · R22 …/data-manager/api/devguides/concepts/understand-errors · R23 …/data-manager/api/devguides/diagnostics (search snippet only)
