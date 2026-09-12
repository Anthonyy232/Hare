/** Always release the timeout after a request settles, including rejected requests. */
export async function withTimeout<T>(request: Promise<T>, timeoutMs = 2500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The tab did not respond. Reload it and try again.')), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
