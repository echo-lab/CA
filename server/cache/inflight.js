const inFlight = new Map();

function oncePerKey(key, producer) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = (async () => {
    try { return await producer(); }
    finally { inFlight.delete(key); }
  })();
  inFlight.set(key, p);
  return p;
}

module.exports = { oncePerKey };