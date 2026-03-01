/**
 * Run tasks in parallel with concurrency limit.
 * Individual task failures don't abort remaining tasks --
 * all rejections are collected and re-thrown via Promise.allSettled + Promise.all.
 */
export async function runParallel<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number = 10
): Promise<T[]> {
  const results: Promise<T>[] = [];
  const executing: Set<Promise<void>> = new Set();

  for (const task of tasks) {
    const promise = task();
    results.push(promise);

    const cleanup = promise.then(() => {}, () => {}).then(() => {
      executing.delete(cleanup);
    });
    executing.add(cleanup);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

/**
 * Batch an array into chunks
 */
export function batch<T>(array: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Batch size must be greater than 0');
  }
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    batches.push(array.slice(i, i + size));
  }
  return batches;
}

/**
 * Delay execution
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
