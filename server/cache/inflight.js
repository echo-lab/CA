const inFlight = new Map();

function oncePerKey(key, producer) {
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const p = (async () => {
    try {
      const result = await producer();
      // Keep in cache briefly for concurrent requests
      setTimeout(() => inFlight.delete(key), 100);
      return result;
    } catch (err) {
      // CRITICAL: Remove immediately on error so retries can happen
      inFlight.delete(key);
      throw err;
    }
  })();

  inFlight.set(key, p);
  return p;
}

module.exports = { oncePerKey };
