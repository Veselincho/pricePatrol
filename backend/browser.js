import fs from "node:fs/promises";
import path from "node:path";
import { Camoufox } from "camoufox-js";

let browserPromise = null;
let browserInstance = null;
let launchedAt = null;
let lastError = null;

function isHeadless() {
  // Default to visible for local debugging; set CAMOUFOX_HEADLESS=true in cloud.
  return process.env.CAMOUFOX_HEADLESS === "true";
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function normalizeViewport(viewport) {
  const width = Number(viewport?.width ?? 1440);
  const height = Number(viewport?.height ?? 1800);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1440, height: 1800 };
  }
  return { width, height };
}

function attachLifecycle(browser) {
  browser.once("disconnected", () => {
    console.warn("Camoufox disconnected");
    browserInstance = null;
    launchedAt = null;
  });
}

async function launchBrowser() {
  const headless = isHeadless();
  console.log(`Camoufox starting (headless=${headless})`);
  const browser = await Camoufox({
    headless,
  });

  browserInstance = browser;
  launchedAt = new Date().toISOString();
  lastError = null;
  attachLifecycle(browser);
  console.log(`Camoufox started at ${launchedAt}`);
  return browser;
}

export async function ensureCamoufox() {
  if (browserInstance) return browserInstance;
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      lastError = error?.message || String(error);
      console.error("Camoufox failed to start:", error);
      throw error;
    }).finally(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

export async function getCamoufoxHealth() {
  return {
    ready: Boolean(browserInstance),
    launching: Boolean(browserPromise),
    headless: isHeadless(),
    launchedAt,
    executablePathSet: true,
    lastError,
  };
}

export async function closeCamoufox() {
  const browser = browserInstance;
  browserInstance = null;
  launchedAt = null;
  if (browser) {
    await browser.close().catch(() => {});
  }
}

export async function captureScreenshot({
  url,
  screenshotPath,
  selector = null,
  timeoutMs = 60000,
  viewport = { width: 1440, height: 1800 },
}) {
  await ensureDir(screenshotPath);
  const browser = await ensureCamoufox();
  const context = await browser.newContext({ viewport: normalizeViewport(viewport) });
  const page = await context.newPage();

  try {
    console.log(`Camoufox screenshot: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15000) }).catch(() => {});

    if (selector) {
      await page.locator(selector).first().waitFor({ state: "visible", timeout: Math.min(timeoutMs, 15000) }).catch(() => {});
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}
