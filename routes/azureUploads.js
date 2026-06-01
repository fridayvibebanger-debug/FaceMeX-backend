import { Router } from 'express';
import multer from 'multer';
import { BlobServiceClient } from '@azure/storage-blob';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024, // 8MB per image
  },
});

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function clean(value) {
  return String(value || '').trim();
}

function getFileExtension(file) {
  const mime = clean(file?.mimetype).toLowerCase();
  const originalName = clean(file?.originalname).toLowerCase();

  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';

  const match = originalName.match(/\.([a-z0-9]+)$/i);
  return match?.[1] || 'jpg';
}

function cleanFileName(name = 'facemex-image') {
  return String(name || 'facemex-image')
    .toLowerCase()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'facemex-image';
}

function getAzureConfig() {
  const connectionString = clean(process.env.AZURE_STORAGE_CONNECTION_STRING);
  const accountName = clean(process.env.AZURE_STORAGE_ACCOUNT);
  const containerName = clean(process.env.AZURE_STORAGE_CONTAINER) || 'facemex-posts';

  const publicBaseUrl =
    clean(process.env.AZURE_BLOB_PUBLIC_URL) ||
    (accountName
      ? `https://${accountName}.blob.core.windows.net/${containerName}`
      : '');

  return {
    connectionString,
    accountName,
    containerName,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
  };
}

async function getContainerClient() {
  const { connectionString, containerName } = getAzureConfig();

  if (!connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING missing on backend');
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  return containerClient;
}

function buildBlobName(file, userId = 'user') {
  const ext = getFileExtension(file);
  const safeName = cleanFileName(file?.originalname || 'facemex-image');

  const cleanUserId = clean(userId)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40) || 'user';

  const random = Math.random().toString(36).slice(2, 10);

  return `posts/${cleanUserId}/${Date.now()}-${random}-${safeName}.${ext}`;
}

async function uploadFileToAzure(file, userId) {
  if (!file) {
    throw new Error('No file uploaded');
  }

  if (!ALLOWED_IMAGE_TYPES.has(clean(file.mimetype).toLowerCase())) {
    throw new Error('Only JPG, PNG, WEBP, and GIF images are allowed');
  }

  const { publicBaseUrl } = getAzureConfig();

  if (!publicBaseUrl) {
    throw new Error('AZURE_BLOB_PUBLIC_URL or AZURE_STORAGE_ACCOUNT missing on backend');
  }

  const containerClient = await getContainerClient();
  const blobName = buildBlobName(file, userId);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(file.buffer, {
    blobHTTPHeaders: {
      blobContentType: file.mimetype || 'image/jpeg',
      blobCacheControl: 'public, max-age=31536000',
    },
  });

  return {
    url: `${publicBaseUrl}/${blobName}`,
    blobName,
  };
}

/*
  POST /api/uploads/azure/image

  FormData:
  file: image file
*/
router.post('/image', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const userId = clean(req.user?._id || req.user?.id || req.headers['x-user-id'] || 'user');

    const uploaded = await uploadFileToAzure(req.file, userId);

    return res.json({
      ok: true,
      url: uploaded.url,
      blobName: uploaded.blobName,
      provider: 'azure-blob',
    });
  } catch (err) {
    console.error('Azure single image upload error:', err?.message || err);

    return res.status(500).json({
      ok: false,
      error: err?.message || 'Azure image upload failed',
    });
  }
});

/*
  POST /api/uploads/azure/images

  FormData:
  files: multiple image files, max 5
*/
router.post('/images', requireAuth, upload.array('files', 5), async (req, res) => {
  try {
    const userId = clean(req.user?._id || req.user?.id || req.headers['x-user-id'] || 'user');
    const files = Array.isArray(req.files) ? req.files : [];

    if (!files.length) {
      return res.status(400).json({
        ok: false,
        error: 'No files uploaded',
      });
    }

    const uploaded = [];

    for (const file of files.slice(0, 5)) {
      uploaded.push(await uploadFileToAzure(file, userId));
    }

    return res.json({
      ok: true,
      urls: uploaded.map((item) => item.url),
      files: uploaded,
      provider: 'azure-blob',
    });
  } catch (err) {
    console.error('Azure multiple image upload error:', err?.message || err);

    return res.status(500).json({
      ok: false,
      error: err?.message || 'Azure images upload failed',
    });
  }
});

/*
  GET /api/uploads/azure/test
*/
router.get('/test', (_req, res) => {
  const { accountName, containerName, publicBaseUrl } = getAzureConfig();

  return res.json({
    ok: true,
    provider: 'azure-blob',
    configured: {
      accountName: Boolean(accountName),
      containerName: Boolean(containerName),
      publicBaseUrl: Boolean(publicBaseUrl),
      connectionString: Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING),
    },
    accountName,
    containerName,
    publicBaseUrl,
  });
});

export default router;
