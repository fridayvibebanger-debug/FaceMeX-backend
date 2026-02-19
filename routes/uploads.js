import express from 'express';
import { v2 as cloudinary } from 'cloudinary';

const router = express.Router();

// Configure cloudinary from env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// POST /api/uploads
// Accepts JSON { dataUrl: string } where dataUrl is a base64 data URL
router.post('/', async (req, res) => {
  const { dataUrl, folder } = req.body || {};
  if (!dataUrl) return res.status(400).json({ error: 'missing_data' });

  try {
    const opts = { resource_type: 'auto' };
    if (folder) opts.folder = folder;
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(dataUrl, opts, (err, r) => {
        if (err) return reject(err);
        resolve(r);
      });
    });
    return res.json({ url: result.secure_url, raw: result });
  } catch (err) {
    console.error('Upload failed:', err);
    return res.status(500).json({ error: (err && err.message) || String(err) });
  }
});

export default router;
