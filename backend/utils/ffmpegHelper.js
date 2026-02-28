/**
 * FFmpeg Helper
 *
 * Handles local video merging using fluent-ffmpeg.
 * Supports per-clip trimming via trim/atrim filters,
 * silent audio generation for videos without audio tracks,
 * and proper concat with both video and audio streams.
 *
 * All video streams are normalised to the same resolution, fps,
 * and pixel format before concat. All audio streams are normalised
 * to the same sample rate, sample format, and channel layout so
 * that the concat filter never fails due to mismatched parameters.
 */

const ffmpeg = require('fluent-ffmpeg');

// ── Shared audio normalisation chain ──
// Every audio path (real audio, trimmed audio, or synthetic silence)
// must end with this so the concat filter sees identical parameters.
const AUDIO_NORM = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';

/**
 * Probe a video file and return { duration, hasAudio }.
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const hasAudio = metadata.streams.some((s) => s.codec_type === 'audio');
      const duration = metadata.format.duration || 0;
      resolve({ duration: parseFloat(duration), hasAudio });
    });
  });
}

/**
 * Sanitize a trim value. Returns a valid float or null.
 */
function sanitizeTrim(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = parseFloat(val);
  return isNaN(num) ? null : num;
}

/**
 * Merge two videos locally using FFmpeg.
 * Returns a promise that resolves with the output file path.
 * Calls onProgress(percent) as FFmpeg processes.
 */
async function mergeVideos(video1Path, video2Path, outputPath, settings, onProgress) {
  const {
    resolution = '1280x720',
    watermark,
  } = settings;

  // Sanitize trim values
  const trimStart0 = sanitizeTrim(settings.trimStart0) || 0;
  const trimEnd0 = sanitizeTrim(settings.trimEnd0);
  const trimStart1 = sanitizeTrim(settings.trimStart1) || 0;
  const trimEnd1 = sanitizeTrim(settings.trimEnd1);

  console.log('[Trim]', { trimStart0, trimEnd0, trimStart1, trimEnd1 });

  // Probe both videos for duration and audio presence
  const [probe0, probe1] = await Promise.all([
    probeVideo(video1Path),
    probeVideo(video2Path),
  ]);

  console.log('[Probe] Video1:', probe0, '| Video2:', probe1);

  const [w, h] = resolution.split('x');

  // Determine effective trim values
  const eff0Start = trimStart0;
  const eff0End = trimEnd0 !== null ? trimEnd0 : probe0.duration;
  const eff1Start = trimStart1;
  const eff1End = trimEnd1 !== null ? trimEnd1 : probe1.duration;

  // Check if trimming is actually needed
  const needTrim0 = eff0Start > 0 || (trimEnd0 !== null && trimEnd0 < probe0.duration);
  const needTrim1 = eff1Start > 0 || (trimEnd1 !== null && trimEnd1 < probe1.duration);

  // ── Build filter graph ──
  const filters = [];

  // ────────────── Video 0 ──────────────
  if (needTrim0) {
    filters.push(
      `[0:v]trim=start=${eff0Start}:end=${eff0End},setpts=PTS-STARTPTS,` +
      `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p[v0]`
    );
  } else {
    filters.push(
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p[v0]`
    );
  }

  // ────────────── Audio 0 ──────────────
  if (probe0.hasAudio) {
    if (needTrim0) {
      filters.push(
        `[0:a]atrim=start=${eff0Start}:end=${eff0End},asetpts=PTS-STARTPTS,${AUDIO_NORM}[a0]`
      );
    } else {
      filters.push(`[0:a]${AUDIO_NORM}[a0]`);
    }
  } else {
    // Generate silent audio matching the video duration
    const dur0 = needTrim0 ? (eff0End - eff0Start) : probe0.duration;
    filters.push(
      `aevalsrc=0:channel_layout=stereo:sample_rate=44100:duration=${dur0},${AUDIO_NORM}[a0]`
    );
  }

  // ────────────── Video 1 ──────────────
  if (needTrim1) {
    filters.push(
      `[1:v]trim=start=${eff1Start}:end=${eff1End},setpts=PTS-STARTPTS,` +
      `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p[v1]`
    );
  } else {
    filters.push(
      `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p[v1]`
    );
  }

  // ────────────── Audio 1 ──────────────
  if (probe1.hasAudio) {
    if (needTrim1) {
      filters.push(
        `[1:a]atrim=start=${eff1Start}:end=${eff1End},asetpts=PTS-STARTPTS,${AUDIO_NORM}[a1]`
      );
    } else {
      filters.push(`[1:a]${AUDIO_NORM}[a1]`);
    }
  } else {
    // Generate silent audio matching the video duration
    const dur1 = needTrim1 ? (eff1End - eff1Start) : probe1.duration;
    filters.push(
      `aevalsrc=0:channel_layout=stereo:sample_rate=44100:duration=${dur1},${AUDIO_NORM}[a1]`
    );
  }

  // ────────────── Concat ──────────────
  filters.push(`[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`);

  // ────────────── Watermark (optional) ──────────────
  let finalVideoLabel = 'outv';
  if (watermark && watermark.trim()) {
    const safeText = watermark.replace(/'/g, "\\'").replace(/:/g, '\\:');
    filters.push(
      `[outv]drawtext=text='${safeText}':fontsize=24:fontcolor=white@0.7:` +
      `x=w-tw-20:y=h-th-20:shadowcolor=black@0.5:shadowx=2:shadowy=2[outv2]`
    );
    finalVideoLabel = 'outv2';
  }

  const filterGraph = filters.join(';');
  console.log('[FFmpeg] Filter graph:', filterGraph);

  // ── Run FFmpeg ──
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(video1Path)
      .input(video2Path)
      .complexFilter(filterGraph)
      .outputOptions([
        `-map [${finalVideoLabel}]`,
        '-map [outa]',
        '-c:v libx264',
        '-c:a aac',
        '-preset fast',
        '-crf 23',
        '-movflags +faststart',
        '-y',
      ])
      .output(outputPath)
      .on('progress', (progress) => {
        if (onProgress && progress.percent) {
          onProgress(Math.round(progress.percent));
        }
      })
      .on('end', () => {
        console.log('[FFmpeg] Merge complete:', outputPath);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('[FFmpeg] Error:', err.message);
        reject(err);
      });

    cmd.run();
  });
}

module.exports = { mergeVideos };
