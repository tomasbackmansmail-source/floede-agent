// Retry wrapper with exponential backoff for API rate limits (429) and transient errors (502, 503)

// Sleep that resolves after `ms`, or rejects early if `signal` aborts. Used so a
// source stuck in retry-backoff bails immediately when its per-source timeout fires
// instead of ignoring the abort for up to baseDelay*2^n seconds.
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      }, { once: true });
    }
  });
}

export async function withRetry(fn, { maxRetries = 3, baseDelay = 30000, label = "request", signal } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");

    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const status = err?.status || err?.statusCode || err?.error?.status;
      const isRetryable = status === 429 || status === 502 || status === 503 || status === 529;

      if (!isRetryable || attempt > maxRetries) {
        throw err;
      }

      // Exponential backoff: 30s, 60s, 120s
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`  [Retry] ${label} got ${status}, attempt ${attempt}/${maxRetries}. Waiting ${delay / 1000}s...`);
      await abortableSleep(delay, signal);
    }
  }

  throw lastError;
}
