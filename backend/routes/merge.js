/**
 * Merge Routes
 *
 * Defines all API endpoints and wires them to the merge controller.
 * Configures multer for file uploads with size and type validation.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const controller = require('../controllers/mergeController');

const router = express.Router();

// ── Multer configuration ──

// Parse the MAX_FILE_SIZE from .env (e.g. "500mb" → bytes)
function parseMaxFileSize(sizeStr) {
  const match = (sizeStr || '500mb').match(/^(\d+)(mb|gb|kb)?$/i);
  if (!match) return 500 * 1024 * 1024; // default 500 MB
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'mb').toLowerCase();
  const multipliers = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return num * (multipliers[unit] || multipliers.mb);
}

const maxFileSize = parseMaxFileSize(process.env.MAX_FILE_SIZE);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    // Unique filename to avoid collisions
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  // Only allow video MIME types
  if (file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.originalname}. Only video files are allowed.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxFileSize },
});

// ── Routes ──

// Upload exactly 2 video files for merging
router.post('/upload', upload.array('videos', 2), controller.uploadVideos);

// Start a merge job
router.post('/merge', express.json(), controller.startMerge);

// Stream merge progress via SSE
router.get('/progress/:id', controller.streamProgress);

// Download the merged video
router.get('/download/:id', controller.downloadVideo);

// Stream a preview of the merged video
router.get('/preview/:id', controller.previewVideo);

// Delete temp files for a job
router.delete('/cleanup/:id', controller.cleanup);

// ── Multer error handler ──
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `File too large. Maximum file size is ${process.env.MAX_FILE_SIZE || '500mb'}.`,
      });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
