// Supabase Edge Function — Pluggy Proxy
// Deploy: supabase functions deploy pluggy-proxy
//
// Esta função age como proxy seguro entre o browser e a Pluggy API.
// O client secret nunca é exposto ao browser.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const PLUGGY_CLIENT_ID     = Deno.env.get("PLUGGY_CLIENT_ID")!;
const PLUGGY_CLIENT_SECRET = Deno.env.get("PLUGGY_CLIENT_SECRET")!;
const PLUGGY_API           = "https://api.pluggy.ai";

// Token cache (em memória, válido por 2h)
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getPluggyToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;
  const res  = await fetch(`${PLUGGY_API}/auth`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ clientId: PLUGGY_CLIENT_ID, clientSecret: PLUGGY_CLIENT_SECRET }),
  });
  const data = await res.json();
  if (!data.apiKey) throw new Error("Pluggy auth failed: " + JSON.stringify(data));
  cachedToken = data.apiKey;
  tokenExpiry = Date.now() + 2 * 60 * 60 * 1000;
  return cachedToken;
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const url      = new URL(req.url);
    const path     = url.searchParams.get("path") || "";
    const apiToken = await getPluggyToken();

    // Forward query string (remove our ?path= param)
    const qs = url.search.replace(/[?&]path=[^&]*/g, "").replace(/^&/, "?");
    const targetUrl = `${PLUGGY_API}${path}${qs}`;

    const body = req.method !== "GET" && req.method !== "DELETE"
      ? await req.text()
      : undefined;

    const pluggyRes = await fetch(targetUrl, {
      method:  req.method,
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY":    apiToken,
      },
      body,
    });

    const responseBody = await pluggyRes.text();

    return new Response(responseBody, {
      status:  pluggyRes.status,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: true, message: err.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
