/**
 * A small, curated list of advertising and tracking host suffixes. This is not
 * meant to rival a full filter list like EasyList — it covers the most common
 * trackers/ad servers so pages load cleaner and faster while keeping the
 * footprint tiny and the matcher trivially fast.
 */
const BLOCKED_SUFFIXES: string[] = [
  // Google ads / analytics
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "google-analytics.com",
  "googletagmanager.com",
  "googletagservices.com",
  "adservice.google.com",
  "pagead2.googlesyndication.com",
  // Generic analytics / measurement
  "scorecardresearch.com",
  "quantserve.com",
  "quantcount.com",
  "hotjar.com",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "amplitude.com",
  "fullstory.com",
  "mouseflow.com",
  "newrelic.com",
  "nr-data.net",
  "sentry-cdn.com",
  "branch.io",
  // Social trackers
  "connect.facebook.net",
  "facebook.com/tr",
  "ads-twitter.com",
  "analytics.tiktok.com",
  "bat.bing.com",
  // Ad networks / exchanges
  "adnxs.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "criteo.com",
  "criteo.net",
  "taboola.com",
  "outbrain.com",
  "moatads.com",
  "adsafeprotected.com",
  "casalemedia.com",
  "smartadserver.com",
  "advertising.com",
  "amazon-adsystem.com",
  "yieldmo.com",
  "sharethrough.com",
  "3lift.com",
  "bidswitch.net",
  "demdex.net",
  "everesttech.net",
  "adform.net",
  "teads.tv",
  "zedo.com",
];

const BLOCKED_SET = new Set(BLOCKED_SUFFIXES);

/** Extract the hostname from a request URL (empty string on parse failure). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * True when the URL's host equals, or is a subdomain of, any blocked suffix.
 * A few entries include a path fragment (e.g. "facebook.com/tr"); those are
 * matched against host+path.
 */
export function isBlocked(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  // Walk the host's parent domains: a.b.c.com -> b.c.com -> c.com
  let candidate = host;
  while (candidate.includes(".")) {
    if (BLOCKED_SET.has(candidate)) return true;
    candidate = candidate.slice(candidate.indexOf(".") + 1);
  }
  if (BLOCKED_SET.has(candidate)) return true;
  // Path-qualified entries
  for (const suffix of BLOCKED_SUFFIXES) {
    if (suffix.includes("/") && url.toLowerCase().includes(suffix)) return true;
  }
  return false;
}
