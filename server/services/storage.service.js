const {
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getClientForUpload, getClientForPresign, getBucket, isStorageConfigured } = require('../config/s3');

let bucketEnsured = false;

async function ensureBucket() {
  if (!isStorageConfigured() || bucketEnsured) return;
  const client = getClientForUpload();
  const bucket = getBucket();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (e) {
      console.warn('[storage] ensureBucket:', e.message);
    }
  }
  bucketEnsured = true;
}

/**
 * @param {string} key
 * @param {Buffer} body
 * @param {string} contentType
 */
async function uploadObject(key, body, contentType) {
  await ensureBucket();
  const client = getClientForUpload();
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    })
  );
}

async function deleteObject(key) {
  if (!isStorageConfigured()) return;
  const client = getClientForUpload();
  await client.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

/** URL firmada GET (TTL segundos, default 15 min) */
async function getSignedGetUrl(key, expiresInSeconds = 900) {
  const client = getClientForPresign();
  const cmd = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(client, cmd, { expiresIn: expiresInSeconds });
}

module.exports = {
  ensureBucket,
  uploadObject,
  deleteObject,
  getSignedGetUrl,
  isStorageConfigured,
};
