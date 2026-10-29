const api = globalThis.browser ?? globalThis.chrome;
const API = "http://localhost:3001";

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "PRICE_PICKED") return;

  (async () => {
    try {
      const res = await fetch(`${API}/api/prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg.payload),
      });
      if (!res.ok) throw new Error(`Backend ${res.status}: ${await res.text()}`);

      sendResponse({ ok: true, saved: await res.json() });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();

  return true; // asynchronous response
});
