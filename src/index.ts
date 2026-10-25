import { fetchWonDeal, verifySignatureV3, wonDealIds, type WebhookEvent } from "./hubspot";
import { sendEvents } from "./meta";
import { d1Log } from "./store";
import { syncWonDeal } from "./sync";

export interface Env {
  DB: D1Database;
  HUBSPOT_CLIENT_SECRET: string;
  HUBSPOT_TOKEN: string;
  META_PIXEL_ID: string;
  META_ACCESS_TOKEN: string;
  META_API_VERSION: string;
  META_TEST_EVENT_CODE?: string;
  WON_STAGES: string;
  DEFAULT_CURRENCY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/webhooks/hubspot") {
      return new Response("Not found", { status: 404 });
    }

    const body = await request.text();
    const ok = await verifySignatureV3({
      secret: env.HUBSPOT_CLIENT_SECRET,
      method: request.method,
      uri: request.url,
      body,
      timestamp: request.headers.get("X-HubSpot-Request-Timestamp"),
      signature: request.headers.get("X-HubSpot-Signature-v3"),
      now: Date.now(),
    });
    if (!ok) return new Response("Invalid signature", { status: 401 });

    let events: WebhookEvent[];
    try {
      events = JSON.parse(body);
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    const deps = {
      log: d1Log(env.DB),
      fetchDeal: (id: string) => fetchWonDeal(id, env.HUBSPOT_TOKEN, env.DEFAULT_CURRENCY),
      sendToMeta: (e: Parameters<typeof sendEvents>[0]) =>
        sendEvents(e, {
          pixelId: env.META_PIXEL_ID,
          accessToken: env.META_ACCESS_TOKEN,
          apiVersion: env.META_API_VERSION,
          testEventCode: env.META_TEST_EVENT_CODE,
        }),
    };
    const wonStages = env.WON_STAGES.split(",").map((s) => s.trim());

    // Answer HubSpot fast; the sync runs after the response.
    ctx.waitUntil(Promise.all(wonDealIds(events, wonStages).map((id) => syncWonDeal(id, deps))));
    return new Response(null, { status: 204 });
  },
};
