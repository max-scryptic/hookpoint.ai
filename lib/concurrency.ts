// Runs `fn` over `items`, with at most `limit` calls in flight at once. A
// fixed-size pool of workers pulls the next index as soon as it's free, so a
// slow item never blocks the rest of the batch behind it — unlike a plain
// sequential loop, where every call waits for the previous one to finish
// even though the calls are otherwise fully independent.
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return

  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        await fn(items[index])
      }
    }),
  )
}
