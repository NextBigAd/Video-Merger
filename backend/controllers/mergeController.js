/**
 * Merge Controller
 *
 * Handles uploading, merging (via local FFmpeg), and cleaning up video files.
 *
 * The merge endpoint is an SSE stream: it runs FFmpeg locally,
 * streams progress, and sends the final download URL to the client.
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { mergeVideos } = require('../utils/ffmpegHelper');

// In-memory store for completed jobs (for download/cleanup)
const jobs = new Map();

// Output directory (use /tmp for HF Spaces compatibility)
const outputsDir = '/tmp/outputs';
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

// Allowed video MIME types
const ALLOWED_TYPES = [
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
  'video/x-matroska', 'video/ogg', 'video/mpeg', 'video/3gpp',
];

/**
 * POST /upload
 * Accept 1-2 video files via multer, validate MIME types,
 * and return basic file info.
 */
async function uploadVideos(req, res) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No video files uploaded.' });
    }

    if (req.files.length > 2) {
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
      return res.status(400).json({ error: 'Please upload exactly 2 videos to merge.' });
    }

    console.log('[Upload] Received files:', req.files.map(f => f.originalname));

    // Validate MIME types
    for (const file of req.files) {
      if (!ALLOWED_TYPES.includes(file.mimetype)) {
        req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
        return res.status(400).json({
          error: `Invalid file type: ${file.originalname}. Only video files are allowed.`,
        });
      }
    }

    // Return basic info
    const filesInfo = req.files.map((file) => ({
      id: file.filename,
      originalName: file.originalname,
      path: file.path,
      size: file.size,
    }));

    res.json({ files: filesInfo });
  } catch (err) {
    console.error('[Upload] Error:', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Failed to process uploaded files.' });
  }
}

/**
 * POST /merge  (SSE endpoint)
 *
 * Expects JSON body with:
 *   videos       – array of 2 objects { id, path, originalName, trimStart, trimEnd }
 *   resolution, format, quality, customBitrate,
 *   audioOption, transition, watermark
 *
 * Streams progress via SSE, then sends the download URL.
 */
async function startMerge(req, res) {
  // ── SSE headers ──
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function send(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (res.flush) res.flush();
  }

  try {
    const {
      videos,
      resolution = '1920x1080',
      format = 'mp4',
      quality = 'medium',
      customBitrate,
      audioOption = 'keepAll',
      transition = 'none',
      watermark,
    } = req.body;

    if (!videos || !Array.isArray(videos) || videos.length !== 2) {
      send({ percent: 0, error: 'Please upload exactly 2 videos to merge.' });
      return res.end();
    }

    // Verify both local files exist
    for (const v of videos) {
      if (!fs.existsSync(v.path)) {
        send({ percent: 0, error: `Video file not found: ${v.originalName || v.id}` });
        return res.end();
      }
    }

    send({ percent: 5, status: 'Starting merge...' });

    // Build output path
    const jobId = uuidv4();
    const outputFilename = `merged-${jobId}.${format}`;
    const outputPath = path.join(outputsDir, outputFilename);

    // Settings for FFmpeg
    const settings = {
      resolution,
      format,
      quality,
      customBitrate,
      audioOption,
      transition,
      watermark,
      trimStart0: videos[0].trimStart,
      trimEnd0: videos[0].trimEnd,
      trimStart1: videos[1].trimStart,
      trimEnd1: videos[1].trimEnd,
    };

    // Run FFmpeg locally
    await mergeVideos(
      videos[0].path,
      videos[1].path,
      outputPath,
      settings,
      (percent) => {
        // Map FFmpeg 0-100 to our 5-95 range
        const mapped = 5 + Math.round(percent * 0.9);
        send({ percent: mapped, status: 'Merging videos...' });
      }
    );

    // Build download URL (served via /outputs/ static route)
    const downloadUrl = `/outputs/${outputFilename}`;

    jobs.set(jobId, {
      status: 'completed',
      downloadUrl,
      outputPath,
      videos,
    });

    send({
      percent: 100,
      done: true,
      downloadUrl,
      jobId,
    });

    res.end();
  } catch (err) {
    console.error('[Merge] Error:', err.message, err.stack);
    send({ percent: 0, error: err.message || 'Merge failed.' });
    res.end();
  }
}

/**
 * DELETE /cleanup/:id
 * Remove local uploaded files and output file for a job.
 */
function cleanup(req, res) {
  const { id } = req.params;
  const job = jobs.get(id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  // Delete uploaded source files
  if (job.videos && Array.isArray(job.videos)) {
    job.videos.forEach((v) => {
      if (v.path && fs.existsSync(v.path)) {
        fs.unlinkSync(v.path);
      }
    });
  }

  // Delete output file
  if (job.outputPath && fs.existsSync(job.outputPath)) {
    fs.unlinkSync(job.outputPath);
  }

  jobs.delete(id);
  res.json({ message: 'Cleanup complete.' });
}

/**
 * Run periodically to remove stale files older than 1 hour.
 */
function cleanupOldFiles() {
  const dirs = [
    '/tmp/uploads',
    '/tmp/outputs',
  ];

  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach((file) => {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < oneHourAgo) {
          fs.unlinkSync(filePath);
          console.log('[Cleanup] Deleted stale file:', file);
        }
      } catch (_) {}
    });
  });
}

/**
 * POST /merge-videos  (REST API endpoint — Shotstack-style)
 *
 * Accepts multipart form data with fields "video1" and "video2".
 * Merges them and returns the merged mp4 file directly in the response.
 */
async function mergeVideosRest(req, res) {
  const tempFiles = [];

  try {
    if (!req.files || !req.files.video1 || !req.files.video2) {
      return res.status(400).json({ error: 'Both "video1" and "video2" fields are required.' });
    }

    const video1 = req.files.video1[0];
    const video2 = req.files.video2[0];
    tempFiles.push(video1.path, video2.path);

    // Validate MIME types
    for (const file of [video1, video2]) {
      if (!ALLOWED_TYPES.includes(file.mimetype)) {
        return res.status(400).json({
          error: `Invalid file type: ${file.originalname}. Only video files are allowed.`,
        });
      }
    }

    console.log(`[API] Merging: ${video1.originalname} + ${video2.originalname}`);

    const jobId = uuidv4();
    const outputFilename = `merged-${jobId}.mp4`;
    const outputPath = path.join(outputsDir, outputFilename);
    tempFiles.push(outputPath);

    const settings = {
      resolution: req.body.resolution || '1280x720',
      format: 'mp4',
      quality: req.body.quality || 'medium',
      audioOption: req.body.audioOption || 'keepAll',
      transition: req.body.transition || 'none',
      trimStart0: req.body.trimStart0,
      trimEnd0: req.body.trimEnd0,
      trimStart1: req.body.trimStart1,
      trimEnd1: req.body.trimEnd1,
    };

    await mergeVideos(video1.path, video2.path, outputPath, settings, () => {});

    // Send the merged file
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);

    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      // Clean up all temp files after sending
      tempFiles.forEach((f) => {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
      });
    });

    fileStream.on('error', (err) => {
      console.error('[API] Stream error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to send merged file.' });
      }
    });
  } catch (err) {
    console.error('[API] Merge error:', err.message, err.stack);
    // Clean up temp files on error
    tempFiles.forEach((f) => {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    });
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Merge failed.' });
    }
  }
}

/**
 * GET /health
 */
function health(req, res) {
  res.json({ status: 'ok', message: 'Video Merger API is running' });
}

module.exports = {
  uploadVideos,
  startMerge,
  mergeVideosRest,
  health,
  cleanup,
  cleanupOldFiles,
};
