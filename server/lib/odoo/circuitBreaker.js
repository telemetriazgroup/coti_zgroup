class CircuitOpenError extends Error {
  constructor(openUntil) {
    const ms = Math.max(0, openUntil - Date.now());
    super(`Circuito Odoo abierto; reintentar en ${Math.ceil(ms / 1000)}s`);
    this.name = 'CircuitOpenError';
    this.openUntil = openUntil;
  }
}

/**
 * Tras N fallos seguidos deja de llamar a Odoo durante cooldownMs (default 10 min).
 */
class CircuitBreaker {
  constructor({ failureThreshold = 5, cooldownMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.failures = 0;
    this.openUntil = 0;
    this.lastError = null;
  }

  snapshot() {
    const now = this.now();
    const open = now < this.openUntil;
    return {
      open,
      failures: this.failures,
      openUntil: this.openUntil || null,
      remainingMs: open ? this.openUntil - now : 0,
      lastError: this.lastError,
    };
  }

  assertClosed() {
    const now = this.now();
    if (now < this.openUntil) {
      throw new CircuitOpenError(this.openUntil);
    }
    if (this.openUntil && now >= this.openUntil) {
      this.openUntil = 0;
      this.failures = 0;
    }
  }

  recordSuccess() {
    this.failures = 0;
    this.openUntil = 0;
    this.lastError = null;
  }

  recordFailure(err) {
    this.failures += 1;
    this.lastError = err && err.message ? err.message : String(err || 'error');
    if (this.failures >= this.failureThreshold) {
      this.openUntil = this.now() + this.cooldownMs;
    }
  }
}

module.exports = { CircuitBreaker, CircuitOpenError };
