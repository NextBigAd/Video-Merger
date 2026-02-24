/**
 * Video Merger – Express Server
 *
 * Entry point for the application. Sets up middleware, static file
 * serving, API routes, and a cron job that auto-deletes stale temp
 * files every 30 minutes.
 */

const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");

ffmpeg.setFfmpegPath(ffmpegPath);

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const mergeRoutes = require('./routes/merge');
const { cleanupOldFiles } = require('./controllers/mergeController');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Ensure required directories exist ──
['uploads', 'outputs'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// ── Middleware ──
app.use(cors());
app.use(express.json());

// Serve the frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Serve uploaded files (thumbnails, etc.) so the frontend can display them
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API routes ──
app.use('/api', mergeRoutes);

// ── Diagnostic: bare-bones upload test ──
const multer = require('multer');
const testUpload = multer({ dest: path.join(__dirname, 'uploads') });
app.post('/test-upload', testUpload.array('videos', 2), (req, res) => {
  console.log('[Test Upload] Files received:', req.files);
  res.json({
    received: req.files ? req.files.length : 0,
    files: req.files ? req.files.map(f => ({
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      path: f.path,
    })) : [],
  });
});

// ── Cron: delete temp files older than 1 hour, every 30 minutes ──
cron.schedule('*/30 * * * *', () => {
  console.log('[Cron] Running stale file cleanup…');
  cleanupOldFiles();
});

// ── Global error handler ──
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// ── Start ──
app.listen(PORT, () => {
  console.log(`\n  Video Merger server running at http://localhost:${PORT}\n`);
});
