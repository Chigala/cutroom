/**
 * Screenshots of web pages for the cut: an article's headline, the line being quoted, a product page.
 * The page loads in a hidden, sandboxed window with its own throwaway session (no cookies kept, no
 * downloads, no pop-ups); consent banners and sticky overlays are hidden, not accepted.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { BrowserWindow, session } from "electron";

export interface CaptureOptions {
  /** Text on the page to scroll to and highlight, like the sentence being quoted. */
  readonly find?: string;
  /** How the page is laid out: as on a phone (tall, readable in a vertical video) or a desktop. */
  readonly device?: "phone" | "desktop";
}

export interface Captured {
  readonly file: string;
  readonly title: string;
  readonly url: string;
  /** Whether `find` was found and highlighted. */
  readonly found: boolean;
}

const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** Only public web pages: no files, no apps, nothing on this machine or the local network. */
export function checkUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https pages");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const privateV4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (isIP(host) === 4 && privateV4.test(host)) ||
    (isIP(host) === 6 && (host === "::1" || /^f[cd]|^fe80/i.test(host)))
  )
    throw new Error("Only public web pages");
  return url;
}

// Hides what covers articles: consent banners, newsletter pop-ups, sticky headers and app banners.
const CLEAN_CSS = `
[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="gdpr" i],
[class*="gdpr" i], [class*="paywall" i], [class*="newsletter" i][class*="modal" i], [aria-modal="true"],
[class*="smart-banner" i], [id*="onetrust" i], .fc-consent-root, #credential_picker_container {
  display: none !important;
}
html, body { overflow: auto !important; position: static !important; }
::highlight(vedit-mark) { background-color: #ffe45c; color: #111; }
header, [class*="sticky" i], [class*="header" i][style*="fixed"] { position: static !important; }
`;

// Finds the text and marks it like a highlighter would (the block it sits in: a paragraph, a heading).
const MARK_JS = (text: string) => `(() => {
  const want = ${JSON.stringify(text.toLowerCase().replace(/\s+/g, " ").trim())};
  const norm = (t) => (t || "").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\\s+/g, " ");
  const blocks = [...document.querySelectorAll("p, h1, h2, h3, li, blockquote, figcaption")];
  const hit = blocks.find((b) => b.offsetParent && norm(b.innerText).includes(norm(want)))
    // Quoted from memory: fall back to the block sharing the most words with it.
    || (() => {
      const words = norm(want).split(" ").filter((w) => w.length > 3);
      let best = null, score = 0;
      for (const b of blocks) {
        if (!b.offsetParent) continue;
        const t = norm(b.innerText);
        const n = words.filter((w) => t.includes(w)).length;
        if (n > score) { best = b; score = n; }
      }
      return score >= Math.max(3, words.length * 0.6) ? best : null;
    })();
  if (!hit) return false;
  hit.setAttribute("data-vedit-mark", "");
  // Highlight the sentence it's in, like a highlighter pen: the block's text, split into sentences,
  // the one that best matches marked across whatever links and spans it runs through.
  const nodes = [];
  const walk = document.createTreeWalker(hit, NodeFilter.SHOW_TEXT);
  let full = "";
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { nodes.push([n, full.length]); full += n.data; }
  const words = norm(want).split(" ").filter((w) => w.length > 3);
  let pick = null, score = -1;
  for (const m of full.matchAll(/[^.!?]+[.!?]+["'\u201d)]*\\s*/g)) {
    const t = norm(m[0]);
    const n = t.includes(norm(want)) ? 1e6 : words.filter((w) => t.includes(w)).length;
    if (n > score) { pick = [m.index, m.index + m[0].trimEnd().length]; score = n; }
  }
  const [from, to] = pick && score > 0 ? pick : [0, full.length];
  const at = (i) => { for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k][1] <= i) return [nodes[k][0], i - nodes[k][1]]; return [nodes[0][0], 0]; };
  const range = new Range();
  range.setStart(...at(from));
  range.setEnd(...at(to));
  CSS.highlights.set("vedit-mark", new Highlight(range));
  return true;
})()`;

// Puts the marked block a third of the way down the screen; true when it's fully in view.
const SCROLL_JS = `(() => {
  const el = document.querySelector("[data-vedit-mark]");
  if (!el) return false;
  const r = el.getBoundingClientRect();
  window.scrollTo(0, window.scrollY + r.top - window.innerHeight * 0.33);
  const after = el.getBoundingClientRect();
  return after.top >= 0 && after.bottom <= window.innerHeight;
})()`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ads, trackers and cookie-sync pixels: they make news pages take tens of seconds and draw nothing a
 * reader came for. Matched against the host; anything matching is never requested.
 */
const BLOCKED_HOSTS =
  /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|google-analytics\.com|googletagmanager\.com|googletagservices\.com|adservice\.google\.com|amazon-adsystem\.com|adnxs\.com|rubiconproject\.com|pubmatic\.com|openx\.net|criteo\.(com|net)|taboola\.com|outbrain\.com|scorecardresearch\.com|quantserve\.com|moatads\.com|casalemedia\.com|smartadserver\.com|teads\.tv|indexww\.com|bidswitch\.net|3lift\.com|sharethrough\.com|chartbeat\.(com|net)|hotjar\.com|segment\.(io|com)|facebook\.net|connect\.facebook\.com|adsrvr\.org|yieldmo\.com|media\.net|onetrust\.com|cookielaw\.org|privacy-mgmt\.com|consensu\.org)$|(^|[.-])(ads?|adserver|pixel|sync|usersync|cookie-?sync|prebid|tracking|tracker|analytics|beacon|metrics)[.-]/i;

/** Captures what a reader sees of `url` (at `find`, if given) into `dir` as a PNG. */
export async function capturePage(rawUrl: string, dir: string, o: CaptureOptions = {}): Promise<Captured> {
  const url = checkUrl(rawUrl);
  const phone = (o.device ?? "phone") === "phone";
  // A fresh in-memory session per capture: nothing persists, nothing is shared with the app.
  const ses = session.fromPartition(`capture-${Date.now()}`, { cache: false });
  ses.on("will-download", (e) => e.preventDefault());
  // No ads, trackers or media: only what draws the article.
  ses.webRequest.onBeforeRequest((details, done) => {
    let host = "";
    try {
      host = new URL(details.url).hostname;
    } catch {}
    done({ cancel: BLOCKED_HOSTS.test(host) || details.resourceType === "media" });
  });
  ses.setPermissionRequestHandler((_wc, _perm, done) => done(false));
  const win = new BrowserWindow({
    show: false,
    width: phone ? 430 : 1280,
    height: phone ? 860 : 900,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // Only follow redirects to other public pages.
  win.webContents.on("will-redirect", (e, next) => {
    try {
      checkUrl(next);
    } catch {
      e.preventDefault();
    }
  });
  try {
    if (phone) win.webContents.setUserAgent(PHONE_UA);
    // Capture once the article has drawn (its DOM is ready, plus a moment for fonts and images), not
    // when every last script finishes: a slow straggler shouldn't hold up the cut.
    const drawn = new Promise<boolean>((resolve) => {
      win.webContents.once("dom-ready", () => resolve(true));
      win.webContents.once("did-fail-load", (_e, code, desc, _u, mainFrame) => {
        if (mainFrame && code !== -3) resolve(false);
        void desc;
      });
    });
    void win.loadURL(url.toString()).catch(() => {});
    if (!(await Promise.race([drawn, wait(15_000).then(() => false)])))
      throw new Error("The page didn't load");
    await Promise.race([
      new Promise<void>((r) => win.webContents.once("did-finish-load", () => r())),
      wait(2500),
    ]);
    await win.webContents.insertCSS(CLEAN_CSS);
    await wait(600);
    let found = false;
    if (o.find && (await win.webContents.executeJavaScript(MARK_JS(o.find)))) {
      // Late images above it push it down after the first scroll: scroll, let things settle, scroll again.
      await win.webContents.executeJavaScript(SCROLL_JS);
      await wait(700);
      await win.webContents.executeJavaScript(SCROLL_JS);
      await wait(300);
      found = Boolean(await win.webContents.executeJavaScript(SCROLL_JS));
    }
    await wait(200);
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) throw new Error("The page came out blank");
    await mkdir(dir, { recursive: true });
    const slug = `${url.hostname.replace(/^www\./, "")}${url.pathname}`
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const file = path.join(dir, `${slug || "page"}-${Date.now().toString(36)}.png`);
    await writeFile(file, image.toPNG());
    return { file, title: win.webContents.getTitle().slice(0, 160), url: url.toString(), found };
  } finally {
    win.destroy();
    void ses.clearStorageData().catch(() => {});
  }
}
