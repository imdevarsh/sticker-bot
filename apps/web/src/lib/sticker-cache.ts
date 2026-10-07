import { PUBLIC_EMOJI_CACHE_GET_URL } from "$app/env/public";

const cache = new Map<string, string>();
const pending = new Map<
  string,
  {
    promise: Promise<string>;
    resolve: (url: string) => void;
    reject: (error: Error) => void;
  }
>();
const queue = new Set<string>();
let scheduled = false;

async function flush() {
  scheduled = false;
  const names = [...queue].slice(0, 100);
  names.forEach((name) => queue.delete(name));
  try {
    const response = await fetch(PUBLIC_EMOJI_CACHE_GET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(names),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error("Emoji service is temporarily unavailable");
    const urls: unknown = await response.json();
    if (!urls || typeof urls !== "object" || Array.isArray(urls))
      throw new Error("Invalid emoji response");
    for (const name of names) {
      const url = (urls as Record<string, unknown>)[name];
      let valid = false;
      try {
        valid = typeof url === "string" && new URL(url).protocol === "https:";
      } catch {}
      if (!valid)
        pending.get(name)?.reject(new Error("Emoji image is unavailable"));
      else {
        cache.set(name, url as string);
        pending.get(name)?.resolve(url as string);
      }
      pending.delete(name);
    }
  } catch {
    for (const name of names) {
      pending.get(name)?.reject(new Error("Emoji image is unavailable"));
      pending.delete(name);
    }
  } finally {
    if (queue.size) schedule();
  }
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    void flush();
  }, 50);
}
export function getURL(name: string): Promise<string> {
  if (cache.has(name)) return Promise.resolve(cache.get(name)!);
  if (pending.has(name)) return pending.get(name)!.promise;
  let resolve!: (url: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  pending.set(name, { promise, resolve, reject });
  queue.add(name);
  schedule();
  return promise;
}
