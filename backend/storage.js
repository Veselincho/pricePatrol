// Local mock of Cosmos DB (JSON file) + Blob Storage (folder).
// When migrating to Azure, only these function implementations need to change.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const SHOTS_DIR = path.join(DATA_DIR, "screenshots");
const DB_FILE = path.join(DATA_DIR, "prices.json");

export const dataDir = DATA_DIR;
export const screenshotsDir = SHOTS_DIR;

const DEFAULT_STATE = {
  watchTargets: [],
  snapshots: [],
};

let state = structuredClone(DEFAULT_STATE);
let loaded = false;
let persistQueue = Promise.resolve();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function screenshotFileNameFromRef(ref) {
  if (!ref) return null;

  try {
    return path.basename(new URL(ref).pathname);
  } catch {
    return path.basename(String(ref));
  }
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSnapshot(doc) {
  if (!doc || typeof doc !== "object") return null;
  return {
    id: doc.id ?? crypto.randomUUID(),
    watchTargetId: doc.watchTargetId ?? null,
    productUrl: doc.productUrl ?? "",
    hostname: doc.hostname ?? "",
    pageTitle: doc.pageTitle ?? "",
    productName: doc.productName ?? "",
    selector: doc.selector ?? "",
    priceText: doc.priceText ?? "",
    selectedText: doc.selectedText ?? "",
    currency: doc.currency ?? null,
    price: doc.price ?? null,
    capturedAt: doc.capturedAt ?? new Date().toISOString(),
    viewport: doc.viewport ?? null,
    screenshotUrl: doc.screenshotUrl ?? null,
    status: doc.status ?? "manual",
    errorMessage: doc.errorMessage ?? null,
    changeType: doc.changeType ?? null,
    priceKey: doc.priceKey ?? null,
  };
}

function normalizeWatchTarget(doc) {
  if (!doc || typeof doc !== "object") return null;
  return {
    id: doc.id ?? crypto.randomUUID(),
    productUrl: doc.productUrl ?? "",
    hostname: doc.hostname ?? "",
    pageTitle: doc.pageTitle ?? "",
    productName: doc.productName ?? "",
    selector: doc.selector ?? "",
    fallbackSelectors: Array.isArray(doc.fallbackSelectors) ? doc.fallbackSelectors : [],
    currency: doc.currency ?? null,
    active: doc.active ?? true,
    checkIntervalMinutes: doc.checkIntervalMinutes ?? 5,
    lastKnownPriceText: doc.lastKnownPriceText ?? null,
    lastKnownPriceKey: doc.lastKnownPriceKey ?? null,
    lastKnownPriceAmount: doc.lastKnownPriceAmount ?? null,
    lastKnownCurrency: doc.lastKnownCurrency ?? null,
    lastKnownScreenshotUrl: doc.lastKnownScreenshotUrl ?? null,
    lastCheckedAt: doc.lastCheckedAt ?? null,
    lastChangedAt: doc.lastChangedAt ?? null,
    lastStatus: doc.lastStatus ?? null,
    createdAt: doc.createdAt ?? new Date().toISOString(),
    updatedAt: doc.updatedAt ?? new Date().toISOString(),
  };
}

function deriveTargetFromSnapshot(snapshot) {
  if (!snapshot?.productUrl) return null;
  return normalizeWatchTarget({
    productUrl: snapshot.productUrl,
    hostname: snapshot.hostname,
    pageTitle: snapshot.pageTitle,
    productName: snapshot.productName,
    selector: snapshot.selector,
    currency: snapshot.currency,
    active: true,
    lastKnownPriceText: snapshot.priceText,
    lastKnownPriceKey: snapshot.priceKey,
    lastKnownPriceAmount: snapshot.price?.amount ?? null,
    lastKnownCurrency: snapshot.price?.currency ?? snapshot.currency ?? null,
    lastKnownScreenshotUrl: snapshot.screenshotUrl ?? null,
    lastCheckedAt: snapshot.capturedAt,
    lastChangedAt: snapshot.capturedAt,
    lastStatus: snapshot.status ?? "manual",
  });
}

function normalizeState(raw) {
  if (Array.isArray(raw)) {
    const snapshots = raw.map(normalizeSnapshot).filter(Boolean);
    const targetMap = new Map();
    for (const snapshot of snapshots) {
      const target = deriveTargetFromSnapshot(snapshot);
      if (!target) continue;
      const existing = targetMap.get(target.productUrl);
      if (!existing || new Date(target.lastChangedAt ?? target.createdAt) > new Date(existing.lastChangedAt ?? existing.createdAt)) {
        targetMap.set(target.productUrl, target);
      }
    }
    return {
      watchTargets: [...targetMap.values()],
      snapshots,
    };
  }

  if (raw && typeof raw === "object") {
    const watchTargets = Array.isArray(raw.watchTargets) ? raw.watchTargets.map(normalizeWatchTarget).filter(Boolean) : [];
    const snapshots = Array.isArray(raw.snapshots) ? raw.snapshots.map(normalizeSnapshot).filter(Boolean) : [];
    return {
      watchTargets,
      snapshots,
    };
  }

  return clone(DEFAULT_STATE);
}

async function persist() {
  await fs.writeFile(DB_FILE, JSON.stringify(state, null, 2));
}

async function schedulePersist() {
  persistQueue = persistQueue.then(persist, persist);
  return persistQueue;
}

async function loadState() {
  if (loaded) return state;

  await fs.mkdir(SHOTS_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    state = normalizeState(JSON.parse(raw));
  } catch {
    state = clone(DEFAULT_STATE);
    await persist();
  }

  loaded = true;
  return state;
}

function sortByCapturedAtDesc(a, b) {
  return String(b.capturedAt ?? "").localeCompare(String(a.capturedAt ?? ""));
}

function sortByUpdatedAtDesc(a, b) {
  return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
}

export async function init() {
  await loadState();
}

export async function saveScreenshot(fileName, buffer) {
  await fs.mkdir(SHOTS_DIR, { recursive: true });
  await fs.writeFile(path.join(SHOTS_DIR, fileName), buffer);
  return fileName;
}

export async function listWatchTargets({ includeInactive = false } = {}) {
  await loadState();
  const items = includeInactive ? state.watchTargets.slice() : state.watchTargets.filter((doc) => doc.active !== false);
  return items.sort(sortByUpdatedAtDesc);
}

export async function getWatchTarget(id) {
  await loadState();
  return state.watchTargets.find((doc) => doc.id === id) ?? null;
}

export async function getWatchTargetById(id) {
  return getWatchTarget(id);
}

export async function getWatchTargetByUrl(productUrl) {
  await loadState();
  return state.watchTargets.find((doc) => doc.productUrl === productUrl) ?? null;
}

export async function upsertWatchTarget(doc) {
  await loadState();

  const normalized = normalizeWatchTarget(doc);
  const index = state.watchTargets.findIndex((item) => item.id === normalized.id || item.productUrl === normalized.productUrl);
  if (index === -1) {
    state.watchTargets.push(normalized);
  } else {
    const existing = state.watchTargets[index];
    state.watchTargets[index] = {
      ...existing,
      ...normalized,
      createdAt: existing.createdAt ?? normalized.createdAt,
      updatedAt: new Date().toISOString(),
    };
  }

  await schedulePersist();
  return state.watchTargets.find((item) => item.id === normalized.id || item.productUrl === normalized.productUrl);
}

export async function updateWatchTarget(id, patch) {
  await loadState();
  const index = state.watchTargets.findIndex((item) => item.id === id);
  if (index === -1) return null;

  state.watchTargets[index] = {
    ...state.watchTargets[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await schedulePersist();
  return state.watchTargets[index];
}

export async function deleteWatchTarget(id) {
  await loadState();
  const index = state.watchTargets.findIndex((item) => item.id === id);
  if (index === -1) return null;

  // Remove the watch target from the list
  const [removed] = state.watchTargets.splice(index, 1);

  // Remove associated snapshots and delete their screenshot files
  const productUrl = removed?.productUrl ?? null;
  const snapshotsToRemove = state.snapshots.filter((s) => s.watchTargetId === id || (productUrl && s.productUrl === productUrl));
  if (snapshotsToRemove.length) {
    state.snapshots = state.snapshots.filter((s) => !(s.watchTargetId === id || (productUrl && s.productUrl === productUrl)));

    for (const snap of snapshotsToRemove) {
      const fileName = screenshotFileNameFromRef(snap?.screenshotUrl);
      if (fileName) {
        await fs.unlink(path.join(SHOTS_DIR, fileName)).catch(() => {});
      }
    }
  }

  await schedulePersist();
  return removed;
}

export async function listSnapshots({ watchTargetId, url, hostname, status, limit } = {}) {
  await loadState();
  let items = state.snapshots.slice();

  if (watchTargetId) items = items.filter((doc) => doc.watchTargetId === watchTargetId);
  if (url) items = items.filter((doc) => doc.productUrl === url);
  if (hostname) items = items.filter((doc) => doc.hostname === hostname);
  if (status) items = items.filter((doc) => doc.status === status);

  items = items.sort(sortByCapturedAtDesc);
  if (limit) items = items.slice(0, Number(limit));
  return items;
}

export async function listPrices(filter = {}) {
  return listSnapshots(filter);
}

export async function insertSnapshot(doc) {
  await loadState();
  const normalized = normalizeSnapshot(doc);
  state.snapshots.push(normalized);
  await schedulePersist();
  return normalized;
}

export async function deleteSnapshot(id) {
  await loadState();
  const index = state.snapshots.findIndex((doc) => doc.id === id);
  if (index === -1) return null;

  const [removed] = state.snapshots.splice(index, 1);
  await schedulePersist();

  const fileName = screenshotFileNameFromRef(removed?.screenshotUrl);
  if (fileName) {
    try {
      await fs.unlink(path.join(SHOTS_DIR, fileName));
    } catch {
      // If the screenshot is missing, we still do not fail the record deletion.
    }
  }

  return removed;
}

export async function deletePrice(id) {
  return deleteSnapshot(id);
}

export async function deleteAllSnapshots() {
  await loadState();
  const removedCount = state.snapshots.length;
  state.snapshots = [];

  for (const target of state.watchTargets) {
    if (target.lastKnownScreenshotUrl) {
      target.lastKnownScreenshotUrl = null;
      target.updatedAt = new Date().toISOString();
    }
  }

  await schedulePersist();

  try {
    const files = await fs.readdir(SHOTS_DIR);
    await Promise.all(files.map((file) => fs.unlink(path.join(SHOTS_DIR, file)).catch(() => {})));
  } catch {
    // Ignore cleanup errors; data rows have already been cleared.
  }

  return removedCount;
}

export async function setState(nextState) {
  state = normalizeState(nextState);
  loaded = true;
  await schedulePersist();
  return state;
}

export async function getState() {
  await loadState();
  return state;
}
