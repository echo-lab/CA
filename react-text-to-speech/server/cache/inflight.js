const inFlight = new Map();

function oncePerKey(key, producer) {
  if (inFlight.has(key)) {
    console.log(`[inflight] Reusing existing request for key=${key.slice(0, 8)}`);
    return inFlight.get(key);
  }
  
  console.log(`[inflight] Starting new request for key=${key.slice(0, 8)}`);
  
  const p = (async () => {
    try {
      return await producer();
    } catch (err) {
      // Remove from inflight on error so it can be retried
      inFlight.delete(key);
      throw err;
    } finally {
      // Only delete after a delay to prevent race conditions
      setTimeout(() => inFlight.delete(key), 100);
    }
  })();
  
  inFlight.set(key, p);
  return p;
}

module.exports = { oncePerKey };