/**
 * FFmpeg Helper Utility
 *
 * Handles all video processing operations: probing metadata,
 * building complex FFmpeg filter graphs for merging, trimming,
 * transitions, watermarks, and letterboxing.
 */

const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const path = require('path');
const fs = require('fs');

// Point fluent-ffmpeg at the bundled static binaries
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobePath);

/**
 * Probe a video file and return its metadata (duration, resolution, codecs, etc.)
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      resolve({
        duration: metadata.format.duration,
        width: videoStream ? videoStream.width : 0,
        height: videoStream ? videoStream.height : 0,
        hasAudio: !!audioStream,
        codec: videoStream ? videoStream.codec_name : 'unknown',
        format: metadata.format.format_name,
      });
    });
  });
}

/**
 * Parse a resolution string like "1920x1080" into { width, height }.
 */
function parseResolution(resString) {
  const [w, h] = resString.split('x').map(Number);
  return { width: w || 1920, height: h || 1080 };
}

/**
 * Map quality presets to video bitrate strings.
 */
function getVideoBitrate(quality, customBitrate) {
  const map = { low: '1000k', medium: '3000k', high: '6000k' };
  return customBitrate || map[quality] || map.medium;
}

/**
 * Map quality presets to audio bitrate strings.
 */
function getAudioBitrate(quality) {
  const map = { low: '96k', medium: '128k', high: '192k' };
  return map[quality] || map.medium;
}

/**
 * Return the appropriate video codec for a given output format.
 */
function getCodecForFormat(format) {
  const codecs = {
    mp4: { video: 'libx264', audio: 'aac' },
    mov: { video: 'libx264', audio: 'aac' },
    webm: { video: 'libvpx-vp9', audio: 'libopus' },
  };
  return codecs[format] || codecs.mp4;
}

/**
 * Build and execute the merge operation.
 *
 * @param {Object}   options
 * @param {Array}    options.videos       – array of { path, originalName, trimStart, trimEnd }
 * @param {string}   options.resolution   – e.g. "1920x1080"
 * @param {string}   options.aspectRatio  – e.g. "16:9"
 * @param {string}   options.format       – mp4 | mov | webm
 * @param {string}   options.quality      – low | medium | high | custom
 * @param {string}   options.customBitrate – e.g. "5000k" (when quality === 'custom')
 * @param {string}   options.audioOption  – keepAll | muteAll | keepFirst
 * @param {string}   options.transition   – none | fade | crossfade
 * @param {string}   options.watermark    – optional text overlay
 * @param {string}   options.outputPath   – full path for the output file
 * @param {Function} options.onProgress   – callback(percent) for progress updates
 * @returns {Promise<string>} resolves with the output file path
 */
function mergeVideos(options) {
  const {
    videos,
    resolution,
    format,
    quality,
    customBitrate,
    audioOption,
    transition,
    watermark,
    outputPath,
    onProgress,
  } = options;

  return new Promise(async (resolve, reject) => {
    try {
      const { width, height } = parseResolution(resolution);
      const videoBitrate = getVideoBitrate(quality, customBitrate);
      const audioBitrate = getAudioBitrate(quality);
      const codec = getCodecForFormat(format);

      // Probe each video to get durations (needed for trim calculations)
      const probes = await Promise.all(videos.map(v => probeVideo(v.path)));

      // Calculate effective durations after trimming
      const effectiveDurations = videos.map((v, i) => {
        const full = probes[i].duration;
        const start = parseFloat(v.trimStart) || 0;
        const end = parseFloat(v.trimEnd) || full;
        return Math.min(end, full) - start;
      });

      const totalDuration = effectiveDurations.reduce((a, b) => a + b, 0);

      // ── Build the FFmpeg command with a complex filter graph ──

      const command = ffmpeg();

      // Add each input file
      videos.forEach(v => {
        command.input(v.path);
      });

      // Build the filter graph string
      const filters = buildFilterGraph({
        videos,
        probes,
        effectiveDurations,
        width,
        height,
        audioOption,
        transition,
        watermark,
      });

      command
        .complexFilter(filters.filterGraph, filters.outputs)
        .outputOptions([
          `-c:v ${codec.video}`,
          `-c:a ${codec.audio}`,
          `-b:v ${videoBitrate}`,
          `-b:a ${audioBitrate}`,
          '-preset fast',
          '-movflags +faststart',
          '-y', // overwrite output
        ])
        .output(outputPath)
        .on('start', (cmdLine) => {
          console.log('[FFmpeg] Command:', cmdLine);
        })
        .on('progress', (progress) => {
          // Calculate percentage from timemark
          if (progress.timemark) {
            const parts = progress.timemark.split(':').map(Number);
            const currentSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
            const percent = Math.min(Math.round((currentSeconds / totalDuration) * 100), 99);
            if (onProgress) onProgress(percent);
          }
        })
        .on('end', () => {
          if (onProgress) onProgress(100);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('[FFmpeg] Error:', err.message);
          reject(err);
        })
        .run();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Construct the complex filter graph that handles scaling, padding,
 * trimming, audio mixing, transitions, and watermarking.
 */
function buildFilterGraph({ videos, probes, effectiveDurations, width, height, audioOption, transition, watermark }) {
  const filters = [];
  const videoLabels = [];
  const audioLabels = [];

  // ── Step 1: Scale, pad, and trim each input ──
  videos.forEach((v, i) => {
    const start = parseFloat(v.trimStart) || 0;
    const end = parseFloat(v.trimEnd) || probes[i].duration;

    // Trim → scale to fit target → pad to exact target (letterbox)
    let videoFilter = `[${i}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,` +
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `setsar=1[v${i}]`;
    filters.push(videoFilter);
    videoLabels.push(`[v${i}]`);

    // Handle audio per clip
    if (probes[i].hasAudio) {
      if (audioOption === 'muteAll') {
        // Generate silent audio for each clip
        filters.push(
          `aevalsrc=0:d=${effectiveDurations[i]}[a${i}]`
        );
      } else if (audioOption === 'keepFirst' && i > 0) {
        // Only first clip keeps audio; the rest get silence
        filters.push(
          `aevalsrc=0:d=${effectiveDurations[i]}[a${i}]`
        );
      } else {
        filters.push(
          `[${i}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`
        );
      }
    } else {
      // No audio track — generate silence
      filters.push(
        `aevalsrc=0:d=${effectiveDurations[i]}[a${i}]`
      );
    }
    audioLabels.push(`[a${i}]`);
  });

  // ── Step 2: Concatenate or add transitions ──
  const n = videos.length;

  if (transition === 'fade' && n > 1) {
    // Add a quick fade-out/fade-in on each boundary
    const fadedVideoLabels = [];
    const fadedAudioLabels = [];
    const fadeDuration = 0.5; // seconds

    videos.forEach((v, i) => {
      const dur = effectiveDurations[i];
      let vf = `[v${i}]`;
      let af = `[a${i}]`;

      // Fade in at the start (except the first clip)
      if (i > 0) {
        filters.push(`${vf}fade=t=in:st=0:d=${fadeDuration}[vfin${i}]`);
        vf = `[vfin${i}]`;
        filters.push(`${af}afade=t=in:st=0:d=${fadeDuration}[afin${i}]`);
        af = `[afin${i}]`;
      }

      // Fade out at the end (except the last clip)
      if (i < n - 1) {
        const fadeStart = Math.max(0, dur - fadeDuration);
        filters.push(`${vf}fade=t=out:st=${fadeStart}:d=${fadeDuration}[vfout${i}]`);
        vf = `[vfout${i}]`;
        filters.push(`${af}afade=t=out:st=${fadeStart}:d=${fadeDuration}[afout${i}]`);
        af = `[afout${i}]`;
      }

      fadedVideoLabels.push(vf);
      fadedAudioLabels.push(af);
    });

    // Concatenate all faded segments
    const concatInput = fadedVideoLabels.map((v, i) => `${v}${fadedAudioLabels[i]}`).join('');
    filters.push(`${concatInput}concat=n=${n}:v=1:a=1[outv][outa]`);

  } else if (transition === 'crossfade' && n > 1) {
    // Crossfade: overlap segments by a short duration using xfade
    const xfadeDuration = 1; // 1 second overlap
    let currentVideoLabel = '[v0]';
    let currentAudioLabel = '[a0]';
    let cumulativeOffset = effectiveDurations[0];

    for (let i = 1; i < n; i++) {
      const offset = Math.max(0, cumulativeOffset - xfadeDuration);
      const nextV = `[v${i}]`;
      const nextA = `[a${i}]`;
      const outV = i === n - 1 ? '[outv]' : `[xv${i}]`;
      const outA = i === n - 1 ? '[outa]' : `[xa${i}]`;

      filters.push(`${currentVideoLabel}${nextV}xfade=transition=fade:duration=${xfadeDuration}:offset=${offset}${outV}`);
      filters.push(`${currentAudioLabel}${nextA}acrossfade=d=${xfadeDuration}${outA}`);

      currentVideoLabel = outV;
      currentAudioLabel = outA;
      cumulativeOffset = offset + effectiveDurations[i];
    }

  } else {
    // No transition — simple concat
    const concatInput = videoLabels.map((v, i) => `${v}${audioLabels[i]}`).join('');
    filters.push(`${concatInput}concat=n=${n}:v=1:a=1[outv][outa]`);
  }

  // ── Step 3: Optional watermark text overlay ──
  let finalVideoLabel = '[outv]';
  if (watermark && watermark.trim()) {
    const safeText = watermark.replace(/'/g, "\\'").replace(/:/g, '\\:');
    filters.push(
      `${finalVideoLabel}drawtext=text='${safeText}':fontsize=24:fontcolor=white@0.7:x=w-tw-20:y=h-th-20:shadowcolor=black@0.5:shadowx=2:shadowy=2[watermarked]`
    );
    finalVideoLabel = '[watermarked]';
  }

  // Determine final output labels
  const outputs = finalVideoLabel === '[outv]'
    ? ['outv', 'outa']
    : [finalVideoLabel.replace(/[\[\]]/g, ''), 'outa'];

  return {
    filterGraph: filters.join(';'),
    outputs,
  };
}

/**
 * Generate a thumbnail from a video at a specific timestamp.
 */
function generateThumbnail(videoPath, outputPath, timestamp = '00:00:01') {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [timestamp],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '320x180',
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });
}

module.exports = {
  probeVideo,
  mergeVideos,
  generateThumbnail,
  parseResolution,
};
