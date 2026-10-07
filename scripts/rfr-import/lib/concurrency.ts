/**
 * Rally for Rangers — bounded-concurrency map.
 *
 * Plain `Promise.all` over hundreds of network calls to a single slow host can serialize
 * behind connection-pool limits anyway, while still queuing everything up front. This caps
 * how many run at once so progress is visible and predictable.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    results[i] = await worker(items[i], i);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}
