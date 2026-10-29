import fs from "node:fs/promises";
import path from "node:path";
import { firefox } from "playwright-core";

let browserPromise = null;
let browserInstance = null;
let launchedAt = null;
let lastError = null;

function getHeadlessMode() {
  const value = process.env.PRICEPATROL_HEADLESS;
  if (typeof value === "string" && value.trim() !== "") {
    const normalized = value.toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }

  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
    return true;
  }

  return false;
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
    console.warn("Browser disconnected");
    browserInstance = null;
    launchedAt = null;
  });
}

async function launchBrowser() {
  const headless = getHeadlessMode();
  console.log(`Firefox starting (headless=${headless})`);
  const browser = await firefox.launch({
    headless,
  });

  browserInstance = browser;
  launchedAt = new Date().toISOString();
  lastError = null;
  attachLifecycle(browser);
  console.log(`Firefox started at ${launchedAt}`);
  return browser;
}

export async function ensureCamoufox() {
  if (browserInstance) return browserInstance;
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      lastError = error?.message || String(error);
      console.error("Firefox failed to start:", error);
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
    headless: getHeadlessMode(),
    launchedAt,
    executablePathSet: false,
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
    console.log(`Firefox screenshot: ${url}`);
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
