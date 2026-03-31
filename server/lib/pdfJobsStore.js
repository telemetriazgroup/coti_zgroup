/** Resultados PDF en memoria (buffer) hasta descarga o expiración */
const results = new Map();
const TTL_MS = 30 * 60 * 1000;

function setResult(jobId, buffer) {
  results.set(jobId, { buffer, expires: Date.now() + TTL_MS });
}

function takeResult(jobId) {
  const r = results.get(jobId);
  if (!r) return null;
  if (Date.now() > r.expires) {
    results.delete(jobId);
    return null;
  }
  results.delete(jobId);
  return r.buffer;
}

function peekResult(jobId) {
  const r = results.get(jobId);
  if (!r) return null;
  if (Date.now() > r.expires) {
    results.delete(jobId);
    return null;
  }
  return r.buffer;
}

function hasResult(jobId) {
  return peekResult(jobId) != null;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of results.entries()) {
    if (now > v.expires) results.delete(k);
  }
}, 60_000);

module.exports = { setResult, takeResult, peekResult, hasResult };
