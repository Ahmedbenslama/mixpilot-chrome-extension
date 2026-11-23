/** True only for YouTube web hosts (youtube.com and its subdomains such as www/m/music). */
export function isSupportedYouTubeUrl(urlString: string | undefined | null): boolean {
  if (!urlString) return false;
  try {
    const url = new URL(urlString);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}
