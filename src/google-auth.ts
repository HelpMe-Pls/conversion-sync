// Google service-account auth with plain fetch + WebCrypto: sign a JWT (RS256) with the key from
// the service account's JSON key file and trade it for an access token.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datamanager";
const TOKEN_LIFETIME_S = 3600;

interface ServiceAccountKey {
  client_email: string;
  // PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----").
  private_key: string;
}

export async function serviceAccountAccessToken(keyFile: string, now: Date): Promise<string> {
  const key = JSON.parse(keyFile) as ServiceAccountKey;
  const iat = Math.floor(now.getTime() / 1000);
  const jwt = await signJwt(
    { iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + TOKEN_LIFETIME_S },
    key.private_key,
  );

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

async function signJwt(claims: Record<string, string | number>, pem: string): Promise<string> {
  const encode = (part: object) => base64url(new TextEncoder().encode(JSON.stringify(part)));
  const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}`;
  const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
