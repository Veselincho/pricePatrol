import * as storage from "./storage.js";
import { closeCamoufox } from "./browser.js";
import { runMonitorOnce } from "./monitor.js";

function summarize(results) {
  const summary = {
    total: results.length,
    baseline: 0,
    changed: 0,
    unchanged: 0,
    error: 0,
  };

  for (const result of results) {
    if (!result?.status) continue;
    if (Object.prototype.hasOwnProperty.call(summary, result.status)) {
      summary[result.status] += 1;
    }
  }

  return summary;
}

async function main() {
  await storage.init();

  const results = await runMonitorOnce();
  const summary = summarize(results);

  console.log(JSON.stringify({ ok: true, summary, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await closeCamoufox().catch(() => {});
});
