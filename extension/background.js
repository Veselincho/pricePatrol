import { dispatchWorkflow, saveWatchTargetFromPayload } from "./github.js";

const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "PRICE_PICKED") return;

  (async () => {
    try {
      const saved = await saveWatchTargetFromPayload(msg.payload);
      await dispatchWorkflow();
      sendResponse({ ok: true, saved });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();

  return true;
});
