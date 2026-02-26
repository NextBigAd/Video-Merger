/**
 * FFmpeg Helper
 *
 * Handles local video merging using fluent-ffmpeg.
 * Builds and executes FFmpeg commands based on user settings.
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

/**
 * Merge two videos locally using FFmpeg.
 * Returns a promise that resolves with the output file path.
 * Calls onProgress(percent) as FFmpeg processes.
 */
function mergeVideos(video1Path, video2Path, outputPath, settings, onProgress) {
  return new Promise((resolve, reject) => {
    const {
      resolution = '1920x1080',
      format = 'mp4',
      quality = 'medium',
      customBitrate,
      audioOption = 'keepAll',
      transition = 'none',
      watermark,
      trimStart0, trimEnd0,
      trimStart1, trimEnd1,
    } = settings;

    const [w, h] = resolution.split('x');

    // Build filter graph
    let filterGraph = '';
    if (transition === 'fade') {
      filterGraph =
        `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fade=t=out:st=0:d=0.5[v0];` +
        `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fade=t=in:st=0:d=0.5[v1];` +
        `[v0][v1]concat=n=2:v=1:a=0[outv]`;
    } else if (transition === 'crossfade') {
      filterGraph =
        `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v0];` +
        `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v1];` +
        `[v0][v1]xfade=transition=fade:duration=1:offset=auto[outv]`;
    } else {
      filterGraph =
        `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v0];` +
        `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v1];` +
        `[v0][v1]concat=n=2:v=1:a=0[outv]`;
    }

    // Audio handling
    let audioFilter = '';
    if (audioOption === 'muteAll') {
      // no audio
    } else if (audioOption === 'keepFirst') {
      audioFilter = ';[0:a]aresample=44100[outa]';
    } else {
      audioFilter = ';[0:a][1:a]concat=n=2:v=0:a=1[outa]';
    }

    // Watermark
    let watermarkFilter = '';
    if (watermark && watermark.trim()) {
      const safeText = watermark.replace(/'/g, "\\'").replace(/:/g, '\\:');
      watermarkFilter = `;[outv]drawtext=text='${safeText}':fontsize=24:fontcolor=white@0.7:x=w-tw-20:y=h-th-20:shadowcolor=black@0.5:shadowx=2:shadowy=2[outv2]`;
    }

    const fullFilter = filterGraph + audioFilter + watermarkFilter;
    const finalVideoLabel = watermarkFilter ? 'outv2' : 'outv';

    // Build the command
    const cmd = ffmpeg();

    // Input 1 with optional trim
    const input1 = cmd.input(video1Path);
    if (trimStart0 && trimStart0 !== '0') input1.inputOptions(`-ss ${trimStart0}`);
    if (trimEnd0) input1.inputOptions(`-to ${trimEnd0}`);

    // Input 2 with optional trim
    const input2 = cmd.input(video2Path);
    if (trimStart1 && trimStart1 !== '0') input2.inputOptions(`-ss ${trimStart1}`);
    if (trimEnd1) input2.inputOptions(`-to ${trimEnd1}`);

    cmd.complexFilter(fullFilter);

    // Map outputs
    cmd.outputOptions(`-map [${finalVideoLabel}]`);
    if (audioOption === 'muteAll') {
      cmd.outputOptions('-an');
    } else {
      cmd.outputOptions('-map [outa]');
    }

    // Quality
    if (quality === 'custom' && customBitrate) {
      cmd.outputOptions(`-b:v ${customBitrate}`);
    } else {
      const crf = quality === 'high' ? '18' : quality === 'low' ? '28' : '23';
      cmd.outputOptions(`-crf ${crf}`);
    }

    // Codec
    if (format === 'webm') {
      cmd.outputOptions(['-c:v libvpx-vp9', '-c:a libopus']);
    } else {
      cmd.outputOptions(['-c:v libx264', '-c:a aac', '-preset fast', '-movflags +faststart']);
    }

    cmd
      .outputOptions('-y')
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
      })
      .run();
  });
}

module.exports = { mergeVideos };
