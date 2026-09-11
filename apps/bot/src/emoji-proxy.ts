/** Retry explicit upload rate limits only; timeouts and 5xx outcomes are ambiguous. */
export async function emojiProxyRequest(
  baseUrl: string,
  token: string,
  operation: "upload" | "remove",
  init: RequestInit,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const base = new URL(baseUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error("Invalid emoji proxy URL");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    let response: Response;
    try {
      response = await fetcher(
        new URL(`api/emoji/${operation}`, base.href.replace(/\/?$/, "/")),
        {
          ...init,
          headers,
          redirect: "error",
          // The proxy can make five 30-second Slack attempts plus four 30-second waits.
          signal: AbortSignal.timeout(330_000),
        },
      );
    } catch {
      throw new Error(
        "Emoji proxy request failed; check proxy activity before retrying",
      );
    }
    if (operation === "upload" && response.status === 429 && attempt < 4) {
      const header = response.headers.get("Retry-After");
      const seconds = header === null ? NaN : Number(header);
      const date = header === null ? NaN : Date.parse(header);
      const delay =
        Number.isFinite(seconds) && seconds >= 0
          ? seconds * 1000
          : Number.isFinite(date)
            ? Math.max(0, date - Date.now())
            : 1000 * 2 ** attempt;
      // Never shorten a server-requested wait. Fail rather than hold a job indefinitely.
      if (delay <= 60_000) {
        await response.body?.cancel();
        await wait(delay + 250);
        continue;
      }
    }
    const data: unknown = await response.json().catch(() => null);
    if (
      !response.ok ||
      !data ||
      typeof data !== "object" ||
      !("ok" in data) ||
      data.ok !== true
    ) {
      // Do not echo upstream bodies or credentials into logs or Slack.
      throw new Error(
        `Emoji proxy rejected ${operation} (HTTP ${response.status})`,
      );
    }
    return;
  }
}
