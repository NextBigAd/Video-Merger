/**
 * Merge Controller
 *
 * Handles the business logic for uploading, merging, downloading,
 * previewing, and cleaning up video files.  Merge progress is
 * streamed to the client via Server-Sent Events (SSE).
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { mergeVideos, probeVideo, generateThumbnail } = require('../utils/ffmpegHelper');

// In-memory store for job state (progress, file paths, status)
const jobs = new Map();

// Allowed video MIME types
const ALLOWED_TYPES = [
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
  'video/x-matroska', 'video/ogg', 'video/mpeg', 'video/3gpp',
];

/**
 * POST /upload
 * Accept multiple video files, validate them, probe metadata,
 * generate thumbnails, and return file info to the client.
 */
async function uploadVideos(req, res) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No video files uploaded.' });
    }

    // Accept 1 or 2 files per upload call (frontend uploads per-slot)
    if (req.files.length > 2) {
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
      return res.status(400).json({ error: 'Please upload exactly 2 videos to merge.' });
    }

    console.log('[Upload] Received files:', req.files.map(f => f.originalname));

    // Validate MIME types
    for (const file of req.files) {
      if (!ALLOWED_TYPES.includes(file.mimetype)) {
        // Remove all uploaded files on rejection
        req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
        return res.status(400).json({
          error: `Invalid file type: ${file.originalname}. Only video files are allowed.`,
        });
      }
    }

    // Probe each file and generate thumbnails
    const filesInfo = await Promise.all(
      req.files.map(async (file) => {
        const meta = await probeVideo(file.path);

        // Generate a thumbnail
        const thumbName = `thumb_${path.parse(file.filename).name}.png`;
        const thumbPath = path.join(path.dirname(file.path), thumbName);
        try {
          await generateThumbnail(file.path, thumbPath);
        } catch (_) {
          // Thumbnail generation is best-effort; ignore failures
        }

        return {
          id: file.filename,
          originalName: file.originalname,
          path: file.path,
          size: file.size,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          thumbnail: `/uploads/${thumbName}`,
        };
      })
    );

    res.json({ files: filesInfo });
  } catch (err) {
    console.error('[Upload] Error:', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Failed to process uploaded files.' });
  }
}

/**
 * POST /merge
 * Start a merge job. Expects a JSON body with:
 *   videos      – ordered array of { id, path, trimStart, trimEnd }
 *   resolution  – e.g. "1920x1080"
 *   aspectRatio – e.g. "16:9"
 *   format      – mp4 | mov | webm
 *   quality     – low | medium | high | custom
 *   customBitrate – e.g. "5000k"
 *   audioOption – keepAll | muteAll | keepFirst
 *   transition  – none | fade | crossfade
 *   watermark   – optional string
 */
async function startMerge(req, res) {
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
      return res.status(400).json({ error: 'Please upload exactly 2 videos to merge.' });
    }

    // Verify every referenced file exists
    for (const v of videos) {
      if (!fs.existsSync(v.path)) {
        return res.status(400).json({ error: `Video file not found: ${v.originalName || v.id}` });
      }
    }

    // Create a unique job ID and output path
    const jobId = uuidv4();
    const outputDir = path.join(__dirname, '..', 'outputs');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `merged_${jobId}.${format}`);

    // Register the job
    jobs.set(jobId, { progress: 0, status: 'processing', outputPath, videos });

    // Respond immediately with the job ID
    res.json({ jobId, message: 'Merge started.' });

    // Run the merge in the background
    mergeVideos({
      videos,
      resolution,
      format,
      quality,
      customBitrate,
      audioOption,
      transition,
      watermark,
      outputPath,
      onProgress: (percent) => {
        const job = jobs.get(jobId);
        if (job) job.progress = percent;
      },
    })
      .then(() => {
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'completed';
          job.progress = 100;
        }
      })
      .catch((err) => {
        console.error('[Merge] Job failed:', err.message);
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = err.message;
        }
      });
  } catch (err) {
    console.error('[Merge] Error:', err);
    res.status(500).json({ error: 'Failed to start merge.' });
  }
}

/**
 * GET /progress/:id
 * Stream merge progress to the client via Server-Sent Events.
 */
function streamProgress(req, res) {
  const { id } = req.params;
  const job = jobs.get(id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send progress every 500 ms
  const interval = setInterval(() => {
    const current = jobs.get(id);
    if (!current) {
      clearInterval(interval);
      res.end();
      return;
    }

    const data = JSON.stringify({
      progress: current.progress,
      status: current.status,
      error: current.error || null,
    });
    res.write(`data: ${data}\n\n`);

    // Stop streaming once the job finishes or fails
    if (current.status === 'completed' || current.status === 'failed') {
      clearInterval(interval);
      res.end();
    }
  }, 500);

  // Clean up if the client disconnects
  req.on('close', () => clearInterval(interval));
}

/**
 * GET /download/:id
 * Send the merged output file as a download.
 */
function downloadVideo(req, res) {
  const { id } = req.params;
  const job = jobs.get(id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Merge is not yet complete.' });
  }
  if (!fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Output file not found.' });
  }

  res.download(job.outputPath);
}

/**
 * GET /preview/:id
 * Stream the merged video for in-browser preview (supports range requests).
 */
function previewVideo(req, res) {
  const { id } = req.params;
  const job = jobs.get(id);

  if (!job || job.status !== 'completed' || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Preview not available.' });
  }

  const stat = fs.statSync(job.outputPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Serve a byte-range for HTML5 video seeking
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(job.outputPath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(job.outputPath).pipe(res);
  }
}

/**
 * DELETE /cleanup/:id
 * Remove all temp files (uploads + output) associated with a job.
 */
function cleanup(req, res) {
  const { id } = req.params;
  const job = jobs.get(id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  // Delete the output file
  if (job.outputPath && fs.existsSync(job.outputPath)) {
    fs.unlinkSync(job.outputPath);
  }

  // Delete uploaded source files for this job
  if (job.videos && Array.isArray(job.videos)) {
    job.videos.forEach((v) => {
      if (v.path && fs.existsSync(v.path)) {
        fs.unlinkSync(v.path);
      }
    });
  }

  jobs.delete(id);
  res.json({ message: 'Cleanup complete.' });
}

/**
 * Run periodically to remove stale files older than 1 hour.
 */
function cleanupOldFiles() {
  const dirs = [
    path.join(__dirname, '..', 'uploads'),
    path.join(__dirname, '..', 'outputs'),
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
      } catch (_) {
        // Ignore errors on individual files
      }
    });
  });
}

module.exports = {
  uploadVideos,
  startMerge,
  streamProgress,
  downloadVideo,
  previewVideo,
  cleanup,
  cleanupOldFiles,
};
