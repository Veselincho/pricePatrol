export async function createBrowser({ headless = false } = {}) {
  const engine = process.env.BROWSER_ENGINE || "camoufox";
  if (engine === "playwright") {
    const { firefox } = await import("playwright");
    return firefox.launch({ headless });
  }
  if (engine !== "camoufox") {
    throw new Error("BROWSER_ENGINE must be camoufox or playwright");
  }

  let proxy = torEnabled() ? { server: "http://127.0.0.1:8118" } : undefined;
  if (!proxy && process.env.PROXY_URL) {
    try {
      const url = new URL(process.env.PROXY_URL);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
        throw new Error("Unsupported proxy URL");
      }
      proxy = {
        server: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    } catch {
      throw new Error("PROXY_URL must be a valid HTTP or HTTPS proxy URL");
    }
  }

  const { Camoufox } = await import("camoufox-js");
  console.log(`Camoufox launch: headless="virtual", route=${torEnabled() ? "tor via Privoxy" : proxy ? "configured proxy" : "direct"}`);
  return Camoufox({
    headless: "virtual",
    i_know_what_im_doing: true,
    humanize: true,
    os: "windows",
    locale: "bg-BG",
    config: { timezone: "Europe/Sofia" },
    geoip: false,
    block_images: false,
    proxy,
  });
}

export function torEnabled() {
  return (process.env.USE_TOR ?? "true") === "true"
    && process.env.TOR_READY === "true"
    && (process.env.BROWSER_ENGINE || "camoufox") === "camoufox";
}
