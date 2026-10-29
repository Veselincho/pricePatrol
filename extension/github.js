import { storageGet } from "./api.js";

const api = globalThis.browser ?? globalThis.chrome;
const GITHUB_API = "https://api.github.com";
const DEFAULT_BRANCH = "main";
const PRICES_PATH = "data/prices.json";
const WORKFLOW_FILE = "check-prices.yml";

function nowIso() {
  return new Date().toISOString();
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeRepo(repo) {
  const value = normalizeText(repo)
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  const match = value.match(/^([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}` };
}

function getRepoInfoFromSettings(settings) {
  const repo = normalizeRepo(settings?.githubRepo);
  if (!repo) {
    throw new Error("Set a GitHub repository in the extension settings, e.g. Veselincho/pricePatrol");
  }

  if (!settings?.githubToken) {
    throw new Error("Set a GitHub Personal Access Token in the extension settings");
  }

  return {
    ...repo,
    token: settings.githubToken,
    branch: normalizeText(settings.githubBranch) || DEFAULT_BRANCH,
  };
}

function buildRepoFileUrl(pathname, settings) {
  const repo = getRepoInfoFromSettings(settings);
  return `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${encodeURIComponent(repo.branch)}/${String(pathname).replace(/^\/+/, "")}`;
}

function normalizeScreenshotRef(ref) {
  if (!ref) return null;
  if (String(ref).startsWith("http://") || String(ref).startsWith("https://")) return String(ref);

  const file = String(ref).replace(/^\/+/, "");
  if (!file) return null;
  return `/data/screenshots/${file.replace(/^data\/screenshots\//, "")}`;
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
    return { watchTargets: [...targetMap.values()], snapshots };
  }

  if (!raw || typeof raw !== "object") {
    return { watchTargets: [], snapshots: [] };
  }

  const watchTargets = Array.isArray(raw.watchTargets) ? raw.watchTargets.map(normalizeWatchTarget).filter(Boolean) : [];
  const snapshots = Array.isArray(raw.snapshots) ? raw.snapshots.map(normalizeSnapshot).filter(Boolean) : [];
  if (watchTargets.length) return { watchTargets, snapshots };

  const targetMap = new Map();
  for (const snapshot of snapshots) {
    const target = deriveTargetFromSnapshot(snapshot);
    if (!target) continue;
    const existing = targetMap.get(target.productUrl);
    if (!existing || new Date(target.lastChangedAt ?? target.createdAt) > new Date(existing.lastChangedAt ?? existing.createdAt)) {
      targetMap.set(target.productUrl, target);
    }
  }

  return { watchTargets: [...targetMap.values()], snapshots };
}

function normalizeWatchTarget(doc) {
  if (!doc || typeof doc !== "object") return null;
  return {
    id: doc.id ?? randomId(),
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
    baselineRequested: doc.baselineRequested ?? false,
    createdAt: doc.createdAt ?? nowIso(),
    updatedAt: doc.updatedAt ?? nowIso(),
  };
}

function normalizeSnapshot(doc) {
  if (!doc || typeof doc !== "object") return null;
  return {
    id: doc.id ?? randomId(),
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
    capturedAt: doc.capturedAt ?? nowIso(),
    viewport: doc.viewport ?? null,
    screenshotUrl: doc.screenshotUrl ?? null,
    status: doc.status ?? "manual",
    errorMessage: doc.errorMessage ?? null,
    changeType: doc.changeType ?? null,
    priceKey: doc.priceKey ?? null,
  };
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubRequest(path, { token, method = "GET", body, headers = {} }) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  return response;
}

function ensureRepoSettings(settings) {
  return getRepoInfoFromSettings(settings);
}

export async function getSettings() {
  const stored = await storageGet({
    githubRepo: "",
    githubToken: "",
    githubBranch: DEFAULT_BRANCH,
  });

  return {
    githubRepo: normalizeText(stored.githubRepo),
    githubToken: normalizeText(stored.githubToken),
    githubBranch: normalizeText(stored.githubBranch) || DEFAULT_BRANCH,
  };
}

export async function getRepositoryState() {
  const settings = await getSettings();
  const repo = ensureRepoSettings(settings);

  const response = await githubRequest(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${PRICES_PATH}?ref=${encodeURIComponent(repo.branch)}`,
    { token: repo.token },
  );

  if (response.status === 404) {
    return { state: { watchTargets: [], snapshots: [] }, sha: null, settings };
  }

  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
  }

  const file = await response.json();
  const content = Array.isArray(file.content) ? file.content.join("") : file.content;
  const json = fromBase64(String(content ?? "").replace(/\n/g, ""));
  return {
    state: normalizeState(JSON.parse(json)),
    sha: file.sha,
    settings,
  };
}

export function summarizeState(state) {
  const watchTargets = Array.isArray(state?.watchTargets) ? state.watchTargets.slice() : [];
  watchTargets.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  return watchTargets;
}

export function getProductSnapshots(state, productUrl) {
  const snapshots = Array.isArray(state?.snapshots) ? state.snapshots.slice() : [];
  return snapshots
    .filter((snapshot) => snapshot.productUrl === productUrl)
    .sort((a, b) => String(a.capturedAt ?? "").localeCompare(String(b.capturedAt ?? "")));
}

export async function getProductDetailByUrl(productUrl) {
  const { state, settings } = await getRepositoryState();
  const target = Array.isArray(state.watchTargets)
    ? state.watchTargets.find((item) => item.productUrl === productUrl)
    : null;

  if (!target) {
    throw new Error("Product not found in repository data");
  }

  const snapshots = getProductSnapshots(state, productUrl);
  return {
    settings,
    target,
    snapshots,
    rawScreenshotUrl: (ref) => buildRawScreenshotUrl(ref, settings),
  };
}

export function buildRawScreenshotUrl(ref, settings) {
  const normalized = normalizeScreenshotRef(ref);
  if (!normalized) return null;
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) return normalized;

  const repo = ensureRepoSettings(settings);
  const filePath = normalized.replace(/^\/data\/screenshots\//, "data/screenshots/");
  return `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${encodeURIComponent(repo.branch)}/${filePath}`;
}

export function upsertWatchTarget(state, payload) {
  const next = normalizeState(state);
  const target = normalizeWatchTarget(payload);
  const index = next.watchTargets.findIndex((item) => item.id === target.id || item.productUrl === target.productUrl);

  if (index === -1) {
    next.watchTargets.push(target);
  } else {
    const existing = next.watchTargets[index];
    next.watchTargets[index] = {
      ...existing,
      ...target,
      createdAt: existing.createdAt ?? target.createdAt,
      updatedAt: nowIso(),
    };
  }

  return next;
}

export function removeWatchTarget(state, targetId) {
  const next = normalizeState(state);
  const target = next.watchTargets.find((item) => item.id === targetId);
  if (!target) return next;

  next.watchTargets = next.watchTargets.filter((item) => item.id !== targetId);
  next.snapshots = next.snapshots.filter((snapshot) => snapshot.watchTargetId !== targetId && snapshot.productUrl !== target.productUrl);
  return next;
}

export async function saveRepositoryState(nextState, sha, commitMessage) {
  const settings = await getSettings();
  const repo = ensureRepoSettings(settings);
  const payload = {
    message: commitMessage,
    content: toBase64(JSON.stringify(nextState, null, 2)),
    branch: repo.branch,
  };

  if (sha) payload.sha = sha;

  const response = await githubRequest(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${PRICES_PATH}`,
    {
      token: repo.token,
      method: "PUT",
      body: payload,
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to save data/prices.json: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

export async function dispatchWorkflow() {
  const settings = await getSettings();
  const repo = ensureRepoSettings(settings);

  const response = await githubRequest(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/actions/workflows/${encodeURIComponent(WORKFLOW_FILE)}/dispatches`,
    {
      token: repo.token,
      method: "POST",
      body: { ref: repo.branch },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to dispatch workflow: ${response.status} ${await response.text()}`);
  }
}

export async function saveWatchTargetFromPayload(payload) {
  const { state, sha } = await getRepositoryState();
  const settings = await getSettings();
  const existing = state.watchTargets.find((item) => item.productUrl === payload.productUrl);
  const now = nowIso();
  const nextTarget = normalizeWatchTarget({
    id: existing?.id ?? randomId(),
    productUrl: payload.productUrl,
    hostname: payload.hostname ?? new URL(payload.productUrl).hostname,
    pageTitle: payload.pageTitle ?? existing?.pageTitle ?? "",
    productName: payload.productName ?? existing?.productName ?? "",
    selector: payload.selector ?? existing?.selector ?? "",
    fallbackSelectors: existing?.fallbackSelectors ?? [],
    currency: payload.currency ?? existing?.currency ?? null,
    active: true,
    checkIntervalMinutes: existing?.checkIntervalMinutes ?? 5,
    lastKnownPriceText: payload.priceText ?? existing?.lastKnownPriceText ?? null,
    lastKnownPriceKey: payload.priceText ? `${payload.price?.amount ?? payload.priceText}|${payload.currency ?? payload.price?.currency ?? ""}` : existing?.lastKnownPriceKey ?? null,
    lastKnownPriceAmount: payload.price?.amount ?? existing?.lastKnownPriceAmount ?? null,
    lastKnownCurrency: payload.price?.currency ?? payload.currency ?? existing?.lastKnownCurrency ?? null,
    lastKnownScreenshotUrl: existing?.lastKnownScreenshotUrl ?? null,
    lastCheckedAt: now,
    lastChangedAt: now,
    lastStatus: "manual",
    baselineRequested: true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  const nextState = upsertWatchTarget(state, nextTarget);
  await saveRepositoryState(nextState, sha, `Save price watch for ${nextTarget.productName || nextTarget.pageTitle || nextTarget.hostname || nextTarget.productUrl}`);

  return {
    settings,
    target: nextTarget,
    state: nextState,
  };
}

export async function deleteWatchTargetById(targetId) {
  const { state, sha } = await getRepositoryState();
  const target = state.watchTargets.find((item) => item.id === targetId);
  if (!target) {
    throw new Error("Product not found in repository data");
  }

  const nextState = removeWatchTarget(state, targetId);
  await saveRepositoryState(nextState, sha, `Remove price watch for ${target.productName || target.pageTitle || target.hostname || target.productUrl}`);
  return nextState;
}

export async function listProducts() {
  const { state } = await getRepositoryState();
  return summarizeState(state);
}
