/**
 * MinIO / S3-compatible storage helper
 * Bucket: logbook  (created at startup if missing)
 */
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const _envConfigured = !!process.env.MINIO_ENDPOINT;
let _endpoint = process.env.MINIO_ENDPOINT || "http://localhost:9000";
let _accessKey = process.env.MINIO_ACCESS_KEY || "minioadmin";
let _secretKey = process.env.MINIO_SECRET_KEY || "minioadmin";
let _bucket = process.env.MINIO_BUCKET || "logbook";
let _publicUrl = process.env.MINIO_PUBLIC_URL || _endpoint;
let _dbConfigured = false;

function _normalizeEndpoint(endpoint) {
  if (!endpoint) return endpoint;

  let raw = String(endpoint).trim();
  if (!raw) return raw;
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;

  try {
    const url = new URL(raw);
    const inDocker = fs.existsSync("/.dockerenv");
    if (
      inDocker &&
      ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)
    ) {
      url.hostname = "host.docker.internal";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return endpoint;
  }
}

function _makeClient() {
  return new S3Client({
    endpoint: _endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: _accessKey, secretAccessKey: _secretKey },
    forcePathStyle: true,
  });
}

let client = _makeClient();

/** Reconfigure from DB settings. Pass empty/missing endpoint to revert to env. */
function reconfigure({ endpoint, accessKey, secretKey, bucket } = {}) {
  if (endpoint) {
    _endpoint = _normalizeEndpoint(endpoint);
    _accessKey = accessKey || "minioadmin";
    _secretKey = secretKey || "minioadmin";
    _bucket = bucket || "logbook";
    _publicUrl = _endpoint;
    _dbConfigured = true;
  } else {
    _endpoint = _normalizeEndpoint(
      process.env.MINIO_ENDPOINT || "http://localhost:9000",
    );
    _accessKey = process.env.MINIO_ACCESS_KEY || "minioadmin";
    _secretKey = process.env.MINIO_SECRET_KEY || "minioadmin";
    _bucket = process.env.MINIO_BUCKET || "logbook";
    _publicUrl = _normalizeEndpoint(process.env.MINIO_PUBLIC_URL) || _endpoint;
    _dbConfigured = false;
  }
  client = _makeClient();
}

/** True if MinIO is explicitly configured (via env var or DB settings). */
function isStorageConfigured() {
  return _envConfigured || _dbConfigured;
}

async function ensureBucket() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: _bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: _bucket }));
    console.log(`✓  MinIO bucket '${_bucket}' created`);
  }
}

/**
 * Upload a buffer/stream to MinIO.
 * Returns the object key.
 */
async function upload({ buffer, originalName, mimeType }) {
  const ext = path.extname(originalName).toLowerCase();
  const key = `attachments/${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  await client.send(
    new PutObjectCommand({
      Bucket: _bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ContentDisposition: `inline; filename="${encodeURIComponent(originalName)}"`,
    }),
  );
  return key;
}

/** Delete an object by key */
async function remove(key) {
  await client.send(new DeleteObjectCommand({ Bucket: _bucket, Key: key }));
}

/**
 * Delete multiple objects in parallel. Silently ignores individual failures
 * (e.g. already-gone objects) so a bulk delete never blocks the parent delete.
 */
async function removeMany(keys) {
  if (!keys?.length) return;
  await Promise.allSettled(keys.map((k) => remove(k)));
}

/** Get a presigned download URL valid for 1 hour */
async function presignedUrl(key, expiresIn = 3600) {
  const cmd = new GetObjectCommand({ Bucket: _bucket, Key: key });
  return getSignedUrl(client, cmd, { expiresIn });
}

/** Direct public URL (works when bucket policy = download) */
function publicUrl(key) {
  return `${_publicUrl}/${_bucket}/${key}`;
}

/** Download an object from MinIO and return its raw bytes */
async function getBuffer(key) {
  const { Body } = await client.send(
    new GetObjectCommand({ Bucket: _bucket, Key: key }),
  );
  const chunks = [];
  for await (const chunk of Body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Stream an object from MinIO directly into an HTTP response.
 * Avoids exposing internal MinIO hostnames (e.g. host.docker.internal) to browsers.
 */
async function streamToResponse(key, res) {
  const result = await client.send(
    new GetObjectCommand({ Bucket: _bucket, Key: key }),
  );
  if (result.ContentType) res.set("Content-Type", result.ContentType);
  if (result.ContentLength)
    res.set("Content-Length", String(result.ContentLength));
  res.set("Cache-Control", "public, max-age=300");
  result.Body.pipe(res);
}

module.exports = {
  ensureBucket,
  upload,
  remove,
  removeMany,
  presignedUrl,
  publicUrl,
  getBuffer,
  streamToResponse,
  reconfigure,
  isStorageConfigured,
  get BUCKET() {
    return _bucket;
  },
};
