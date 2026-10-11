/**
 * "Back off at least as long as the provider asked" taken literally.
 *
 * The advice is right. Obeying it without a ceiling means a provider can park
 * a request handler for as long as it feels like, and `Retry-After: 3600` is a
 * value real providers send during an incident.
 */
export function createClient({ sleep, fetchImpl, maxRetries = 1 }) {
  return {
    async request() {
      let last;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response = await fetchImpl();
        if (response.ok) return response;
        const seconds = Number(response.headers.get('retry-after'));
        last = new Error(`upstream returned ${response.status}`);
        if (attempt === maxRetries) break;
        await sleep(Number.isFinite(seconds) ? seconds * 1000 : 500);
      }
      throw last;
    },
  };
}
