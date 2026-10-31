import crypto from "node:crypto";
import * as cheerio from "cheerio";
import * as storage from "./storage.js";
import { captureScreenshot, getNetworkInfo, loadPageHtml } from "./browser.js";
import { buildPriceKey, normalizePriceText, toAmountObject, toIsoFileStamp } from "./price.js";

function pickFirstText($, selectors) {
  for (const selector of selectors) {
    if (!selector) continue;
    const el = $(selector).first();
    if (!el.length) continue;
    const text = normalizePriceText(el.text());
    if (text) return { text, selectorUsed: selector };

    const content = normalizePriceText(el.attr("content"));
    if (content) return { text: content, selectorUsed: selector };
  }
  return null;
}

function isXPathSelector(selector) {
  return typeof selector === "string" && selector.startsWith("xpath=");
}

function extractPriceFromHtml(html, target) {
  const $ = cheerio.load(html);
  const title = normalizePriceText($("title").text());
  const selectors = [
    target.selector,
    ...(Array.isArray(target.fallbackSelectors) ? target.fallbackSelectors : []),
    "meta[property='product:price:amount']",
    "meta[property='og:price:amount']",
    "meta[itemprop='price']",
    "[data-price]",
  ].filter(Boolean).filter((selector) => !isXPathSelector(selector));

  let result = pickFirstText($, selectors);
  if (!result) {
    const fallbackMeta = $("meta[property='product:price:amount'], meta[property='og:price:amount'], meta[itemprop='price']").first();
    const content = normalizePriceText(fallbackMeta.attr("content") || fallbackMeta.attr("value") || fallbackMeta.text());
    if (content) {
      result = { text: content, selectorUsed: fallbackMeta.get(0) ? fallbackMeta.get(0).tagName : "meta" };
    }
  }

  return {
    pageTitle: title,
    priceText: result?.text ?? null,
    selectorUsed: result?.selectorUsed ?? (isXPathSelector(target.selector) ? null : target.selector ?? null),
  };
}

function selectorCandidatesForTarget(target) {
  return [
    target.selector,
    ...(Array.isArray(target.fallbackSelectors) ? target.fallbackSelectors : []),
  ].filter(Boolean);
}

async function fetchTargetSnapshot(target) {
  let html;
  let finalUrl;
  let pageTitle = "";
  let bodyText = "";
  let selectorMatched = false;
  let selectorResult = null;
  const selectorCandidates = selectorCandidatesForTarget(target);
  const shouldUseBrowserForSelector = isXPathSelector(target.selector);

  if (shouldUseBrowserForSelector || process.env.BROWSER_ENGINE !== "playwright") {
    selectorResult = await loadPageHtml({
      url: target.productUrl,
      selectors: selectorCandidates,
    });
    ({ html, finalUrl, pageTitle = "", bodyText = "", selectorMatched = false } = selectorResult);
  } else {
    const response = await fetch(target.productUrl, {
      headers: {
        "user-agent": "pricePatrol/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} when loading ${target.productUrl}`);
    }

    finalUrl = response.url || target.productUrl;
    html = await response.text();
  }

  const $ = cheerio.load(html);
  pageTitle = pageTitle || normalizePriceText($("title").text());
  bodyText = bodyText || normalizePriceText($("body").text()).slice(0, 500);
  selectorMatched = selectorMatched || Boolean(target.selector && !isXPathSelector(target.selector) && $(target.selector).length);
  const heading = normalizePriceText($("title, h1").text());
  if (/just a moment|access denied|attention required|verify (?:that )?you are human|security check|robot check|captcha|достъпът е отказан/i.test(heading)
    || $("#challenge-running, #cf-challenge-running, #challenge-form, form[action*='/cdn-cgi/challenge-platform/']").length
    || /verify (?:that )?you are (?:a )?human|checking your browser|unusual traffic from your computer network/i.test($("body").clone().find("script, style").remove().end().text())) {
    throw new Error(`Anti-bot challenge when loading ${target.productUrl}`);
  }

  const extracted = extractPriceFromHtml(html, target);
  let priceText = extracted.priceText;
  let selectorUsed = extracted.selectorUsed;

  if (!priceText && selectorResult?.selectedText) {
    const matchedText = normalizePriceText(selectorResult.selectedText);
    if (matchedText) {
      priceText = matchedText;
      selectorUsed = selectorResult.selectorUsed ?? selectorUsed;
    }
  }

  if (!priceText) {
    console.warn(JSON.stringify({
      type: "price-extract-failed",
      url: finalUrl || target.productUrl,
      pageTitle: pageTitle || extracted.pageTitle || "",
      bodyText: bodyText || "",
      selectorMatched: selectorMatched,
    }));
  }

  const hostname = new URL(finalUrl).hostname;
  const priceKey = priceText ? buildPriceKey(priceText, target.currency) : null;
  const price = priceText ? toAmountObject(priceText, target.currency) : null;

  return {
    finalUrl,
    hostname,
    pageTitle: extracted.pageTitle || pageTitle,
    priceText,
    priceKey,
    price,
    selectorUsed,
  };
}

function createScreenshotName(targetId, capturedAt) {
  // Short, informative filename to avoid overly long UUID names while preventing collisions.
  // Format: <targetShort>-YYYYMMDD_HHMMSS.png e.g. 9f8b7c6a-20261029_032138.png
  const d = new Date(capturedAt);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const shortId = String(targetId || '').slice(0, 8);
  return `${shortId}-${stamp}.png`;
}

async function writeChangeScreenshot(target, capturedAt, selector) {
  const fileName = createScreenshotName(target.id, capturedAt);
  const screenshotPath = `${storage.screenshotsDir}/${fileName}`;
  await captureScreenshot({
    url: target.productUrl,
    screenshotPath,
    selector,
  });
  return fileName;
}

async function processTarget(target, network) {
  const checkedAt = new Date().toISOString();
  const current = await fetchTargetSnapshot(target);
  if (!current.priceText || !current.price) {
    throw new Error(`Could not extract a price from ${target.productUrl}`);
  }

  const hasReference = Boolean(target.lastKnownPriceKey || target.lastKnownPriceText);
  const isBaselineRequested = target.baselineRequested === true;
  const isFirstSnapshot = isBaselineRequested || !hasReference;
  const isChanged = hasReference && current.priceKey && current.priceKey !== target.lastKnownPriceKey;
  // Always capture a snapshot for every check (baseline/changed/unchanged). This will create a full time-series.
  const shouldCapture = true;
  const status = isFirstSnapshot ? "baseline" : isChanged ? "changed" : "unchanged";

  let snapshot = null;

  const screenshotName = await writeChangeScreenshot(target, checkedAt, selectorCandidatesForTarget(target));
  const screenshotUrl = `/data/screenshots/${screenshotName}`;

  // Always insert a snapshot row so the dashboard can plot every check.
  snapshot = await storage.insertSnapshot({
      id: crypto.randomUUID(),
      watchTargetId: target.id,
      productUrl: target.productUrl,
      hostname: current.hostname,
      pageTitle: current.pageTitle,
      productName: target.productName,
      selector: target.selector,
      priceText: current.priceText,
      selectedText: current.priceText,
      currency: target.currency ?? current.price?.currency ?? null,
      price: current.price,
      capturedAt: checkedAt,
      viewport: null,
      screenshotUrl,
      status,
      errorMessage: null,
      changeType: status,
      priceKey: current.priceKey,
      network,
    });

  // Keep lastChangedAt only when there is an actual change or baseline.
  const lastChangedAtValue = (isFirstSnapshot || isChanged) ? checkedAt : target.lastChangedAt ?? null;

  await storage.updateWatchTarget(target.id, {
    hostname: current.hostname,
    pageTitle: current.pageTitle,
    lastKnownPriceText: current.priceText,
    lastKnownPriceKey: current.priceKey,
    lastKnownPriceAmount: current.price?.amount ?? null,
    lastKnownCurrency: current.price?.currency ?? target.currency ?? null,
    lastKnownScreenshotUrl: screenshotUrl,
    lastCheckedAt: checkedAt,
    lastChangedAt: lastChangedAtValue,
    lastStatus: status,
    active: target.active !== false,
    baselineRequested: isBaselineRequested ? false : target.baselineRequested ?? false,
  });

  return {
    status,
    targetId: target.id,
    changed: isChanged,
    snapshot,
    error: null,
  };
}

export async function runMonitorOnce() {
  const targets = await storage.listWatchTargets();
  const activeTargets = targets.filter((target) => target.active !== false);
  const network = activeTargets.length ? await getNetworkInfo() : null;

  const results = [];
  for (const target of activeTargets) {
    try {
      try {
        results.push(await processTarget(target, network));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        results.push(await processTarget(target, network));
      }
    } catch (error) {
      const checkedAt = new Date().toISOString();
      const message = error?.message || String(error);
      results.push(await storage.insertSnapshot({
        id: crypto.randomUUID(),
        watchTargetId: target.id,
        productUrl: target.productUrl,
        hostname: target.hostname,
        pageTitle: target.pageTitle,
        productName: target.productName,
        selector: target.selector,
        priceText: null,
        selectedText: null,
        currency: target.currency ?? null,
        price: null,
        capturedAt: checkedAt,
        viewport: null,
        screenshotUrl: null,
        status: "error",
        errorMessage: message,
        changeType: "error",
        priceKey: null,
        network,
      }));

      await storage.updateWatchTarget(target.id, {
        lastCheckedAt: checkedAt,
        lastStatus: "error",
      });
    }
  }

  return results;
}
