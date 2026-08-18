const { loadOdooConfig, isOdooConfigured, odooUsesHttps } = require('./config');
const { createOdooClient } = require('./xmlrpcClient');
const { CircuitOpenError } = require('./circuitBreaker');
const { XmlrpcFault } = require('./xmlrpcCodec');
const { normalizePartner } = require('./normalizePartner');
const { PARTNER_FIELDS } = require('./partnerFields');
const { SYNC_STATUS, SYNC_ORIGIN, mapOdooPartnerRow, mapSyncStateRow } = require('./syncStatus');
const { isEligibleCompany, partnerDisplayTags } = require('./partnerEligibility');

module.exports = {
  loadOdooConfig,
  isOdooConfigured,
  odooUsesHttps,
  createOdooClient,
  CircuitOpenError,
  XmlrpcFault,
  normalizePartner,
  PARTNER_FIELDS,
  SYNC_STATUS,
  SYNC_ORIGIN,
  mapOdooPartnerRow,
  mapSyncStateRow,
  isEligibleCompany,
  partnerDisplayTags,
};
