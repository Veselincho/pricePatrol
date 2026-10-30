import fs from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import { createBrowser, torEnabled } from "./create-browser.js";

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
  const browser = await createBrowser({ headless });

  browserInstance = browser;
  launchedAt = new Date().toISOString();
  lastError = null;
  attachLifecycle(browser);
  console.log(`Firefox started at ${launchedAt}`);
  return browser;
}

export async function ensureBrowser() {
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

export async function getBrowserHealth() {
  return {
    ready: Boolean(browserInstance),
    launching: Boolean(browserPromise),
    headless: getHeadlessMode(),
    launchedAt,
    executablePathSet: false,
    lastError,
  };
}

export async function closeBrowser() {
  const browser = browserInstance;
  browserInstance = null;
  launchedAt = null;
  if (browser) {
    await browser.close().catch(() => {});
  }
}

export async function getNetworkInfo() {
  const network = {
    route: process.env.BROWSER_ENGINE === "playwright" ? "playwright-http"
      : torEnabled() ? "tor" : process.env.PROXY_URL ? "proxy" : "direct",
    ip: null,
    isTor: null,
    checkedAt: new Date().toISOString(),
    error: null,
  };
  if (network.route === "playwright-http") {
    network.error = "Browser IP does not describe the HTTP-fetch rollback path";
    return network;
  }

  let context;
  try {
    const browser = await ensureBrowser();
    context = await browser.newContext({ viewport: normalizeViewport() });
    const page = await context.newPage();
    const response = await page.goto("https://check.torproject.org/api/ip", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    if (!response?.ok()) throw new Error("IP probe returned a non-2xx response");
    const result = await response.json();
    if (!isIP(result.IP) || typeof result.IsTor !== "boolean") {
      throw new Error("IP probe returned an invalid response");
    }
    network.ip = result.IP;
    network.isTor = result.IsTor;
    if (network.route === "tor" && !network.isTor) {
      network.error = "Tor proxy configured, but the IP probe did not confirm a Tor exit";
    }
  } catch {
    network.error = "Could not verify browser exit IP";
  } finally {
    if (context) await context.close().catch(() => {});
  }
  console.log("Browser network probe:", JSON.stringify(network));
  return network;
}

export async function loadPageHtml({ url, selectors = [], timeoutMs = 60000 }) {
  const browser = await ensureBrowser();
  const context = await browser.newContext({ viewport: normalizeViewport() });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (!response || !response.ok()) {
      throw new Error(`HTTP ${response?.status() ?? "no response"} when loading ${url}`);
    }
    await page.waitForFunction((selectors) => selectors.some((selector) => {
      const el = document.querySelector(selector);
      return /\d/.test(el?.textContent || el?.getAttribute("content") || "");
    }), selectors, { timeout: Math.min(timeoutMs, 5000) }).catch(() => {});
    return { html: await page.content(), finalUrl: page.url() };
  } finally {
    await context.close().catch(() => {});
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
  const browser = await ensureBrowser();
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
