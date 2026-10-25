// Google side: send a won deal to Google Ads as an offline click conversion through the
// Data Manager API (docs/research-google-ads-offline.md).
import { conversionIdFor, type Destination, type SendableDeal } from "./destination";
import { serviceAccountAccessToken } from "./google-auth";
import { normalizeEmail, normalizePhone, sha256Hex } from "./meta";

const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";

export interface GoogleConfig {
  // The Google Ads account that owns the conversion action; hyphens are allowed.
  accountId: string;
  // A manager account the service account was added to, when it was not added to accountId itself.
  loginAccountId?: string;
  conversionActionId: string;
  // The service account's JSON key file, as Google downloads it.
  serviceAccountKey: string;
  // Country code added to a phone saved without one, e.g. "1" for the US.
  defaultPhoneCountryCode?: string;
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface AccountRef {
  accountType: "GOOGLE_ADS";
  accountId: string;
}

interface IngestRequest {
  destinations: { operatingAccount: AccountRef; loginAccount?: AccountRef; productDestinationId: string }[];
  encoding: "HEX";
  events: {
    transactionId: string;
    eventTimestamp: string;
    eventSource: "WEB";
    conversionValue: number;
    currency: string;
    adIdentifiers?: { gclid: string };
    userData: { userIdentifiers: ({ emailAddress: string } | { phoneNumber: string })[] };
  }[];
}

// Google wants account ids as digits only, without the hyphens Google Ads shows.
const account = (id: string): AccountRef => ({ accountType: "GOOGLE_ADS", accountId: id.replace(/-/g, "") });

// No consent fields: which to send is the operator's call (Issue #7).
async function buildIngestRequest(deal: SendableDeal, cfg: GoogleConfig): Promise<IngestRequest> {
  const destination: IngestRequest["destinations"][number] = {
    operatingAccount: account(cfg.accountId),
    productDestinationId: cfg.conversionActionId,
  };
  if (cfg.loginAccountId) destination.loginAccount = account(cfg.loginAccountId);

  const userIdentifiers: IngestRequest["events"][number]["userData"]["userIdentifiers"] = [
    { emailAddress: await sha256Hex(normalizeEmail(deal.email)) },
  ];
  // E.164: the digits with their country code, after a "+".
  const phone = deal.phone ? normalizePhone(deal.phone, cfg.defaultPhoneCountryCode) : "";
  if (phone) userIdentifiers.push({ phoneNumber: await sha256Hex(`+${phone}`) });

  const event: IngestRequest["events"][number] = {
    transactionId: conversionIdFor(deal.dealId),
    // RFC 3339 in UTC ("Z" is the offset), whole seconds.
    eventTimestamp: deal.closedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    eventSource: "WEB",
    conversionValue: deal.amount,
    currency: deal.currency,
    userData: { userIdentifiers },
  };
  if (deal.gclid) event.adIdentifiers = { gclid: deal.gclid };

  return { destinations: [destination], encoding: "HEX", events: [event] };
}

export function googleDestination(cfg: GoogleConfig): Destination {
  const now = cfg.now ?? (() => new Date());
  return {
    name: "google",
    maxAgeMs: 90 * DAY_MS,
    async send(deal) {
      const body = await buildIngestRequest(deal, cfg);
      const token = await serviceAccountAccessToken(cfg.serviceAccountKey, now());
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Google Data Manager ${res.status}: ${await res.text()}`);
      // Matching runs later at Google; this id looks up the outcome (requestStatus:retrieve).
      const { requestId } = (await res.json()) as { requestId?: string };
      return requestId;
    },
  };
}
