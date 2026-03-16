// Retry wrapper with exponential backoff for API rate limits (429) and transient errors (502, 503)

export async function withRetry(fn, { maxRetries = 3, baseDelay = 30000, label = "request" } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
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
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}
