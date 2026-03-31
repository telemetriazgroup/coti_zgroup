/**
 * IP del cliente (proxy-aware).
 */
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || null;
}

module.exports = { getClientIp };
