
// Cloudflare Worker — /api proxy to Google Apps Script Web App
// Usage: /api?path=/products (GET), /api?path=/price-changes (GET/POST), /api?path=/itn (POST)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only handle /api
    if (!url.pathname.startsWith('/api')) {
      return new Response('Not Found', { status: 404 });
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*', // tighten to your domains in prod
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Apps Script Web App deployment ID (set in wrangler.toml [vars])
    const targetBase = `https://script.google.com/macros/s/${env.APPS_SCRIPT_DEPLOYMENT_ID}/exec`;

    // Forward querystring intact (expects ?path=/products etc)
    const upstreamUrl = new URL(targetBase);
    upstreamUrl.search = url.search;

    // Prepare request to Apps Script (passthrough body for non-GET)
    const init = {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body:
        request.method !== 'GET' && request.method !== 'HEAD'
          ? await request.text()
          : undefined,
    };

    // Forward upstream
    let res;
    try {
      res = await fetch(upstreamUrl.toString(), init);
    } catch (err) {
      // Network/Upstream error
      return json({ ok: false, error: String(err) }, 502);
    }

    // Build response and apply permissive CORS (tighten in prod)
    const body = await res.arrayBuffer();
    const headers = {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
      'Access-Control-Allow-Origin': '*', // e.g. 'https://wykiesautomation.co.za'
    };

    return new Response(body, { status: res.status, headers });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
