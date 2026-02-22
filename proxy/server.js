const http = require("http");

const DERIVE_API_KEY = process.env.DERIVE_API_KEY;
const PORT = process.env.PORT || 4444;

if (!DERIVE_API_KEY) {
  console.error("DERIVE_API_KEY env var required");
  process.exit(1);
}

const ROUTES = {
  "/api/public/create-account": "https://app.derive.xyz/api/public/create-account",
  "/api/public/paymaster": "https://app.derive.xyz/api/public/paymaster",
};

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const target = ROUTES[req.url];
  if (!target || req.method !== "POST") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();

    console.log(`[proxy] ${req.url} -> ${target}`);

    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DERIVE_API_KEY}`,
      },
      body,
    });

    const text = await upstream.text();
    console.log(`[proxy] ${upstream.status} ${text.slice(0, 200)}`);

    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(text);
  } catch (err) {
    console.error("[proxy] error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Derive proxy running on http://localhost:${PORT}`);
  console.log("Waiting for ngrok tunnel...");
});
