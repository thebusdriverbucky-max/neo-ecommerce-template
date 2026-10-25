import optimizedImageHosts from "./image-hosts.json";

type ImageHost = { protocol: string; hostname: string };

const hosts = optimizedImageHosts as ImageHost[];

/**
 * True when next/image may optimize this source: same-origin paths and the
 * hosts listed in lib/image-hosts.json (shared with next.config.js). Any
 * other absolute URL must be rendered unoptimized.
 */
export function isOptimizedImageSrc(src: string): boolean {
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  const protocol = url.protocol.replace(/:$/, "");
  return hosts.some((host) => host.protocol === protocol && host.hostname === url.hostname);
}
