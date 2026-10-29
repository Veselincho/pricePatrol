const api = globalThis.browser ?? globalThis.chrome;
const hasBrowserPromises = Boolean(globalThis.browser);

function withCallback(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const err = api.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(result);
    });
  });
}

export async function storageGet(defaults) {
  if (hasBrowserPromises) return api.storage.local.get(defaults);
  return withCallback(api.storage.local.get.bind(api.storage.local), defaults);
}

export async function storageSet(values) {
  if (hasBrowserPromises) return api.storage.local.set(values);
  return withCallback(api.storage.local.set.bind(api.storage.local), values);
}

export async function sendRuntimeMessage(message) {
  if (hasBrowserPromises) return api.runtime.sendMessage(message);
  return withCallback(api.runtime.sendMessage.bind(api.runtime), message);
}

export function openOptionsPage() {
  if (api.runtime?.openOptionsPage) {
    const maybe = api.runtime.openOptionsPage();
    if (maybe?.catch) maybe.catch(() => {});
    return;
  }

  if (api.tabs?.create) {
    api.tabs.create({ url: api.runtime.getURL("options.html") });
  }
}

export function getExtensionUrl(path) {
  return api.runtime.getURL(path);
}
