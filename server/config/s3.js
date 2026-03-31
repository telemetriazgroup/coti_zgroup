/**
 * Cliente S3 compatible (MinIO). Uploads usan endpoint interno; URLs firmadas pueden usar host público.
 */
const { S3Client } = require('@aws-sdk/client-s3');

const region = process.env.S3_REGION || 'us-east-1';
const bucket = process.env.S3_BUCKET || 'zgroup-plans';

function buildClient(endpoint) {
  if (!endpoint) return null;
  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
  });
}

const internalEndpoint = process.env.S3_ENDPOINT || '';
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || internalEndpoint;

/** Operaciones servidor → MinIO (Docker: http://minio:9000) */
const s3Internal = buildClient(internalEndpoint);
/** Presign GET para el navegador (p. ej. http://localhost:9000) */
const s3Public = publicEndpoint !== internalEndpoint ? buildClient(publicEndpoint) : s3Internal;

function getClientForUpload() {
  return s3Internal;
}

function getClientForPresign() {
  return s3Public || s3Internal;
}

function getBucket() {
  return bucket;
}

function isStorageConfigured() {
  return Boolean(internalEndpoint);
}

module.exports = {
  getClientForUpload,
  getClientForPresign,
  getBucket,
  isStorageConfigured,
  region,
};
