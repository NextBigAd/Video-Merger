/**
 * Video Merger – Express Server
 *
 * Entry point. Sets up middleware, static file serving, API routes,
 * and a cron job that auto-deletes stale uploaded files.
 *
 * Video processing is handled by local FFmpeg (installed via Docker).
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const ffmpeg = require('fluent-ffmpeg');
const mergeRoutes = require('./routes/merge');
const { cleanupOldFiles } = require('./controllers/mergeController');

// Use system FFmpeg (installed via apt in Docker) or ffmpeg-static locally
try {
  const ffmpegPath = require('ffmpeg-static');
  ffmpeg.setFfmpegPath(ffmpegPath);
  console.log('[FFmpeg] Using ffmpeg-static:', ffmpegPath);
} catch (_) {
  console.log('[FFmpeg] Using system FFmpeg');
}

const app = express();
const PORT = process.env.PORT || 7860;

// ── Ensure directories exist (use /tmp for HF Spaces compatibility) ──
const uploadsDir = '/tmp/uploads';
const outputsDir = '/tmp/outputs';
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

// ── Middleware ──
app.use(cors());
app.use(express.json());

// Serve the frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Serve merged output files for download
app.use('/outputs', express.static(outputsDir));

// ── API routes ──
app.use('/api', mergeRoutes);

// ── Cron: delete files older than 1 hour, every 30 minutes ──
cron.schedule('*/30 * * * *', () => {
  console.log('[Cron] Running stale file cleanup...');
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
