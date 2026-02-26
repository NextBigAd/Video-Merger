/**
 * Video Merger – Frontend Application
 *
 * Two-slot upload model: the user fills Video 1 and Video 2,
 * then clicks Merge.
 *
 * The merge endpoint is a POST that returns an SSE stream.
 * Progress updates and the final Rendi download URL arrive
 * as SSE data frames.
 */

// ── API base URL (same origin) ──
const API = '/api';

// ── State: exactly 2 slots ──
const slots = [null, null];
let currentJobId = null;

// ── DOM references ──
const dropZone          = document.getElementById('dropZone');
const dropInput         = document.getElementById('dropInput');
const mergeBtn          = document.getElementById('mergeBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill      = document.getElementById('progressFill');
const progressText      = document.getElementById('progressText');
const statusText        = document.getElementById('statusText');
const resultArea        = document.getElementById('resultArea');
const downloadBtn       = document.getElementById('downloadBtn');
const cleanupBtn        = document.getElementById('cleanupBtn');

// Setting inputs
const resolutionSelect     = document.getElementById('resolution');
const customResolutionInput = document.getElementById('customResolution');
const aspectRatioSelect    = document.getElementById('aspectRatio');
const customAspectRatio    = document.getElementById('customAspectRatio');
const formatSelect         = document.getElementById('format');
const qualitySelect        = document.getElementById('quality');
const customBitrateInput   = document.getElementById('customBitrate');
const audioOptionSelect    = document.getElementById('audioOption');
const transitionSelect     = document.getElementById('transition');
const watermarkInput       = document.getElementById('watermark');

// Per-slot DOM helpers
function slotDOM(i) {
  return {
    container:  document.getElementById(`slot${i}`),
    preview:    document.getElementById(`slotPreview${i}`),
    info:       document.getElementById(`slotInfo${i}`),
    trimWrap:   document.getElementById(`slotTrim${i}`),
    trimStart:  document.getElementById(`trimStart${i}`),
    trimEnd:    document.getElementById(`trimEnd${i}`),
    pickBtn:    document.getElementById(`pickBtn${i}`),
    removeBtn:  document.getElementById(`removeBtn${i}`),
    fileInput:  document.getElementById(`fileInput${i}`),
  };
}

// ═══════════════════════════════════════════════════
//  Toast Notifications
// ═══════════════════════════════════════════════════

function showToast(message, type = 'error') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ═══════════════════════════════════════════════════
//  Slot Rendering
// ═══════════════════════════════════════════════════

function renderSlot(i) {
  const d = slotDOM(i);
  const clip = slots[i];

  if (clip) {
    d.container.classList.add('filled');
    const sizeMB = (clip.size / (1024 * 1024)).toFixed(1);
    d.preview.innerHTML = '<span class="slot-placeholder" style="color:var(--accent)">Ready</span>';
    d.info.textContent = `${clip.originalName}  —  ${sizeMB} MB`;
    d.trimWrap.hidden = false;
    d.pickBtn.textContent = 'Change File';
    d.removeBtn.hidden = false;
  } else {
    d.container.classList.remove('filled');
    d.preview.innerHTML = '<span class="slot-placeholder">No video selected</span>';
    d.info.textContent = '';
    d.trimWrap.hidden = true;
    d.trimStart.value = '';
    d.trimEnd.value = '';
    d.pickBtn.textContent = 'Choose File';
    d.removeBtn.hidden = true;
  }

  mergeBtn.disabled = !(slots[0] && slots[1]);
}

// ═══════════════════════════════════════════════════
//  Per-Slot Pick / Remove
// ═══════════════════════════════════════════════════

[0, 1].forEach((i) => {
  const d = slotDOM(i);
  d.pickBtn.addEventListener('click', () => d.fileInput.click());
  d.fileInput.addEventListener('change', () => {
    if (d.fileInput.files.length) uploadSingleFile(d.fileInput.files[0], i);
    d.fileInput.value = '';
  });
  d.removeBtn.addEventListener('click', () => {
    slots[i] = null;
    renderSlot(i);
  });
});

// ═══════════════════════════════════════════════════
//  Drop Zone
// ═══════════════════════════════════════════════════

dropZone.addEventListener('click', () => dropInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  handleDroppedFiles(e.dataTransfer.files);
});
dropInput.addEventListener('change', () => {
  if (dropInput.files.length) handleDroppedFiles(dropInput.files);
  dropInput.value = '';
});

function handleDroppedFiles(fileList) {
  const videoFiles = Array.from(fileList).filter(f => f.type.startsWith('video/'));
  if (videoFiles.length === 0) { showToast('No video files detected.'); return; }
  if (videoFiles.length > 2)  { showToast('Please drop exactly 2 video files.'); return; }

  let slotIndex = 0;
  for (const file of videoFiles) {
    while (slotIndex < 2 && slots[slotIndex] !== null) slotIndex++;
    if (slotIndex >= 2) slotIndex = 0;
    uploadSingleFile(file, slotIndex);
    slotIndex++;
  }
}

// ═══════════════════════════════════════════════════
//  Upload a single file into a slot
// ═══════════════════════════════════════════════════

async function uploadSingleFile(file, slotIndex) {
  if (!file.type.startsWith('video/')) {
    showToast(`"${file.name}" is not a video file.`);
    return;
  }

  const formData = new FormData();
  formData.append('videos', file);

  try {
    const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) { showToast(data.error || 'Upload failed.'); return; }

    slots[slotIndex] = data.files[0];
    renderSlot(slotIndex);
    showToast(`Video ${slotIndex + 1} uploaded.`, 'success');
  } catch (err) {
    showToast('Network error during upload.');
    console.error(err);
  }
}

// ═══════════════════════════════════════════════════
//  Settings – toggle custom inputs
// ═══════════════════════════════════════════════════

resolutionSelect.addEventListener('change', () => {
  customResolutionInput.hidden = resolutionSelect.value !== 'custom';
});
aspectRatioSelect.addEventListener('change', () => {
  customAspectRatio.hidden = aspectRatioSelect.value !== 'custom';
});
qualitySelect.addEventListener('change', () => {
  customBitrateInput.hidden = qualitySelect.value !== 'custom';
});

// ═══════════════════════════════════════════════════
//  Merge (POST → SSE stream via fetch ReadableStream)
// ═══════════════════════════════════════════════════

mergeBtn.addEventListener('click', startMerge);

async function startMerge() {
  if (!slots[0] || !slots[1]) {
    showToast('Please select both videos before merging.');
    return;
  }

  const trimStart0 = document.getElementById('trimStart0').value.trim();
  const trimEnd0   = document.getElementById('trimEnd0').value.trim();
  const trimStart1 = document.getElementById('trimStart1').value.trim();
  const trimEnd1   = document.getElementById('trimEnd1').value.trim();

  const resolution = resolutionSelect.value === 'custom'
    ? customResolutionInput.value.trim() || '1920x1080'
    : resolutionSelect.value;
  const quality = qualitySelect.value;
  const customBitrate = quality === 'custom' ? customBitrateInput.value.trim() : undefined;

  const payload = {
    videos: [
      { id: slots[0].id, path: slots[0].path, originalName: slots[0].originalName, trimStart: trimStart0 || '0', trimEnd: trimEnd0 || '' },
      { id: slots[1].id, path: slots[1].path, originalName: slots[1].originalName, trimStart: trimStart1 || '0', trimEnd: trimEnd1 || '' },
    ],
    resolution,
    aspectRatio: aspectRatioSelect.value === 'custom' ? customAspectRatio.value.trim() || '16:9' : aspectRatioSelect.value,
    format: formatSelect.value,
    quality,
    customBitrate,
    audioOption: audioOptionSelect.value,
    transition: transitionSelect.value,
    watermark: watermarkInput.value.trim() || undefined,
  };

  // Lock UI
  mergeBtn.disabled = true;
  resultArea.hidden = true;
  progressContainer.hidden = false;
  updateProgress(0, 'Starting...');

  try {
    // POST /merge returns an SSE stream
    const response = await fetch(`${API}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      const errData = await response.json().catch(() => ({}));
      showToast(errData.error || 'Failed to start merge.');
      mergeBtn.disabled = false;
      progressContainer.hidden = true;
      return;
    }

    // Read the SSE stream via ReadableStream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse complete SSE "data: {...}\n\n" frames out of the buffer
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep any incomplete tail

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const data = JSON.parse(jsonStr);

          const percent = (data.percent != null && !isNaN(data.percent))
            ? Math.round(data.percent) : 0;
          updateProgress(percent, data.status || '');

          if (data.error) {
            showToast(data.error);
            mergeBtn.disabled = false;
            progressContainer.hidden = true;
            return;
          }

          if (data.done && data.downloadUrl) {
            currentJobId = data.jobId || null;
            onMergeComplete(data.downloadUrl);
            return;
          }
        } catch (_) { /* ignore malformed frames */ }
      }
    }

    // Stream ended without done/error
    showToast('Merge stream ended unexpectedly.');
    mergeBtn.disabled = false;
    progressContainer.hidden = true;
  } catch (err) {
    showToast('Network error during merge.');
    mergeBtn.disabled = false;
    progressContainer.hidden = true;
    console.error(err);
  }
}

// ═══════════════════════════════════════════════════
//  Progress + Completion
// ═══════════════════════════════════════════════════

function updateProgress(percent, status) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
  if (statusText && status) statusText.textContent = status;
}

function onMergeComplete(downloadUrl) {
  updateProgress(100, 'Complete!');
  showToast('Videos merged successfully!', 'success');
  mergeBtn.disabled = false;

  resultArea.hidden = false;

  // Download button — direct link to Rendi-hosted file
  downloadBtn.href = downloadUrl;
  downloadBtn.download = `merged-${Date.now()}.mp4`;

  // Cleanup button — delete local temp files
  cleanupBtn.onclick = async () => {
    if (!currentJobId) return;
    try {
      await fetch(`${API}/cleanup/${currentJobId}`, { method: 'DELETE' });
      showToast('Temp files deleted.', 'info');
    } catch (_) {
      showToast('Cleanup failed.');
    }
  };
}

// ═══════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
