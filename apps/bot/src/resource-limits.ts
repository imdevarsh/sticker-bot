export class BotBusyError extends Error {
  constructor() {
    super(
      "The bot is busy or you have reached the request limit. Please try again later.",
    );
  }
}
type Bucket = { count: number; until: number };
const buckets = new Map<string, Bucket>();
let previews = 0;

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  for (const [key, bucket] of buckets)
    if (bucket.until <= now) buckets.delete(key);
  const bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= 10_000) throw new BotBusyError();
    buckets.set(key, { count: 1, until: now + windowMs });
  } else {
    if (bucket.count >= limit) throw new BotBusyError();
    bucket.count++;
  }
}

export async function withImagePreview<T>(
  user: string,
  work: () => Promise<T>,
) {
  if (previews >= 2) throw new BotBusyError();
  checkRateLimit(`preview:${user}`, 5, 60_000);
  previews++;
  try {
    return await work();
  } finally {
    previews--;
  }
}
