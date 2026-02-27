/**
 * Merge Routes
 *
 * Defines API endpoints and wires them to the merge controller.
 * Configures multer for file uploads with size and type validation.
 *
 * POST /upload   – accept 1-2 video files via multer
 * POST /merge    – SSE stream: uploads to Rendi, merges, returns URL
 * DELETE /cleanup/:id – delete local temp files
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const controller = require('../controllers/mergeController');

const router = express.Router();

// ── Multer configuration ──

function parseMaxFileSize(sizeStr) {
  const match = (sizeStr || '500mb').match(/^(\d+)(mb|gb|kb)?$/i);
  if (!match) return 500 * 1024 * 1024;
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'mb').toLowerCase();
  const multipliers = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return num * (multipliers[unit] || multipliers.mb);
}

const maxFileSize = parseMaxFileSize(process.env.MAX_FILE_SIZE);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, '/tmp/uploads');
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
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

// Multer middleware for the REST API merge (video1 + video2 fields)
const mergeUpload = upload.fields([
  { name: 'video1', maxCount: 1 },
  { name: 'video2', maxCount: 1 },
]);

// ── Routes ──

// Health check
router.get('/health', controller.health);

// Upload 1-2 video files (frontend uploads per-slot)
router.post('/upload', upload.array('videos', 2), controller.uploadVideos);

// POST /merge — smart route:
//   multipart/form-data (video1 + video2) → REST API, returns merged file
//   application/json (videos array)       → SSE stream for frontend UI
router.post('/merge', (req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) {
    // REST API path — run multer then the REST controller
    mergeUpload(req, res, (err) => {
      if (err) return next(err);
      controller.mergeVideosRest(req, res, next);
    });
  } else {
    // Frontend SSE path — parse JSON then the SSE controller
    express.json()(req, res, (err) => {
      if (err) return next(err);
      controller.startMerge(req, res, next);
    });
  }
});

// Delete local temp files for a job
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
