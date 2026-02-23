/**
 * Video Merger – Frontend Application
 *
 * Two-slot upload model: the user fills Video 1 and Video 2,
 * then clicks Merge. Files can be picked individually per slot
 * or dropped together onto the shared drop zone.
 */

// ── API base URL (same origin) ──
const API = '/api';

// ── State: exactly 2 slots ──
// Each slot is null (empty) or { id, originalName, path, duration, width, height, thumbnail }
const slots = [null, null];
let currentJobId = null;

// ── DOM references ──
const dropZone          = document.getElementById('dropZone');
const dropInput         = document.getElementById('dropInput');
const mergeBtn          = document.getElementById('mergeBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill      = document.getElementById('progressFill');
const progressText      = document.getElementById('progressText');
const resultArea        = document.getElementById('resultArea');
const previewPlayer     = document.getElementById('previewPlayer');
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

/** Re-render a single slot's UI based on the slots[] state. */
function renderSlot(i) {
  const d = slotDOM(i);
  const clip = slots[i];

  if (clip) {
    // Slot is filled — show thumbnail + info
    d.container.classList.add('filled');
    d.preview.innerHTML = `<img src="${clip.thumbnail}" alt="thumb"
      onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 160 90%22><rect fill=%22%23333%22 width=%22160%22 height=%2290%22/><text x=%2280%22 y=%2250%22 fill=%22%23888%22 text-anchor=%22middle%22 font-size=%2212%22>No Preview</text></svg>'" />`;
    const dur = clip.duration ? formatTime(clip.duration) : '--:--';
    d.info.textContent = `${clip.originalName}  —  ${clip.width}x${clip.height}  •  ${dur}`;
    d.trimWrap.hidden = false;
    d.trimEnd.placeholder = clip.duration ? clip.duration.toFixed(1) : 'end';
    d.pickBtn.textContent = 'Change File';
    d.removeBtn.hidden = false;
  } else {
    // Slot is empty
    d.container.classList.remove('filled');
    d.preview.innerHTML = '<span class="slot-placeholder">No video selected</span>';
    d.info.textContent = '';
    d.trimWrap.hidden = true;
    d.trimStart.value = '';
    d.trimEnd.value = '';
    d.pickBtn.textContent = 'Choose File';
    d.removeBtn.hidden = true;
  }

  // Enable merge button only when both slots are filled
  mergeBtn.disabled = !(slots[0] && slots[1]);
}

// ═══════════════════════════════════════════════════
//  Per-Slot Pick / Remove
// ═══════════════════════════════════════════════════

[0, 1].forEach((i) => {
  const d = slotDOM(i);

  // "Choose File" button opens file picker for this slot
  d.pickBtn.addEventListener('click', () => d.fileInput.click());

  // When a file is picked via the file input
  d.fileInput.addEventListener('change', () => {
    if (d.fileInput.files.length) {
      uploadSingleFile(d.fileInput.files[0], i);
    }
    d.fileInput.value = '';
  });

  // "Remove" button clears the slot
  d.removeBtn.addEventListener('click', () => {
    slots[i] = null;
    renderSlot(i);
  });
});

// ═══════════════════════════════════════════════════
//  Drop Zone — accepts 1 or 2 files
// ═══════════════════════════════════════════════════

dropZone.addEventListener('click', () => dropInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

// Handle files dropped onto the shared drop zone
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  handleDroppedFiles(e.dataTransfer.files);
});

// Handle files chosen via the hidden input on the drop zone
dropInput.addEventListener('change', () => {
  if (dropInput.files.length) handleDroppedFiles(dropInput.files);
  dropInput.value = '';
});

/**
 * When files are dropped/picked via the shared zone, fill the first
 * available slots in order. If 2 files are dropped, both slots fill.
 */
function handleDroppedFiles(fileList) {
  const videoFiles = Array.from(fileList).filter(f => f.type.startsWith('video/'));
  if (videoFiles.length === 0) {
    showToast('No video files detected. Please drop video files.');
    return;
  }
  if (videoFiles.length > 2) {
    showToast('Please drop exactly 2 video files.');
    return;
  }

  // Fill empty slots in order
  let slotIndex = 0;
  for (const file of videoFiles) {
    // Find the next empty slot (or overwrite from the start)
    while (slotIndex < 2 && slots[slotIndex] !== null) slotIndex++;
    if (slotIndex >= 2) {
      // Both slots already filled — overwrite from slot 0
      slotIndex = 0;
    }
    uploadSingleFile(file, slotIndex);
    slotIndex++;
  }
}

// ═══════════════════════════════════════════════════
//  Upload a single file into a specific slot
// ═══════════════════════════════════════════════════

/**
 * Upload one video file to the server. We still hit /api/upload
 * which expects exactly 2 files, so we batch: if only one slot is
 * being filled at a time we upload it alone for probing, then pair
 * them at merge time.
 *
 * Approach: upload each file individually for probing (the backend
 * route accepts up to 2 — we send 1 and the controller will accept
 * 1 for probing purposes). We adjusted the controller below to
 * allow 1-or-2 files on upload (validation of exactly 2 happens at
 * merge time instead).
 */
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

    if (!res.ok) {
      showToast(data.error || 'Upload failed.');
      return;
    }

    // Store the returned file info in the slot
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
//  Merge
// ═══════════════════════════════════════════════════

mergeBtn.addEventListener('click', startMerge);

async function startMerge() {
  // Both slots must be filled
  if (!slots[0] || !slots[1]) {
    showToast('Please select both videos before merging.');
    return;
  }

  // Read trim values from inputs
  const trimStart0 = document.getElementById('trimStart0').value.trim();
  const trimEnd0   = document.getElementById('trimEnd0').value.trim();
  const trimStart1 = document.getElementById('trimStart1').value.trim();
  const trimEnd1   = document.getElementById('trimEnd1').value.trim();

  // Gather settings
  const resolution = resolutionSelect.value === 'custom'
    ? customResolutionInput.value.trim() || '1920x1080'
    : resolutionSelect.value;

  const quality = qualitySelect.value;
  const customBitrate = quality === 'custom' ? customBitrateInput.value.trim() : undefined;

  const payload = {
    videos: [
      {
        id: slots[0].id,
        path: slots[0].path,
        originalName: slots[0].originalName,
        trimStart: trimStart0 || '0',
        trimEnd: trimEnd0 || String(slots[0].duration || ''),
      },
      {
        id: slots[1].id,
        path: slots[1].path,
        originalName: slots[1].originalName,
        trimStart: trimStart1 || '0',
        trimEnd: trimEnd1 || String(slots[1].duration || ''),
      },
    ],
    resolution,
    aspectRatio: aspectRatioSelect.value === 'custom'
      ? customAspectRatio.value.trim() || '16:9'
      : aspectRatioSelect.value,
    format: formatSelect.value,
    quality,
    customBitrate,
    audioOption: audioOptionSelect.value,
    transition: transitionSelect.value,
    watermark: watermarkInput.value.trim() || undefined,
  };

  // Disable UI while merging
  mergeBtn.disabled = true;
  resultArea.hidden = true;
  progressContainer.hidden = false;
  updateProgress(0);

  try {
    const res = await fetch(`${API}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to start merge.');
      mergeBtn.disabled = false;
      progressContainer.hidden = true;
      return;
    }

    currentJobId = data.jobId;
    listenForProgress(currentJobId);
  } catch (err) {
    showToast('Network error when starting merge.');
    mergeBtn.disabled = false;
    progressContainer.hidden = true;
    console.error(err);
  }
}

// ═══════════════════════════════════════════════════
//  SSE Progress
// ═══════════════════════════════════════════════════

function listenForProgress(jobId) {
  const evtSource = new EventSource(`${API}/progress/${jobId}`);

  evtSource.onmessage = (e) => {
    try {
      const info = JSON.parse(e.data);
      updateProgress(info.progress);

      if (info.status === 'completed') {
        evtSource.close();
        onMergeComplete(jobId);
      } else if (info.status === 'failed') {
        evtSource.close();
        showToast(info.error || 'Merge failed.');
        mergeBtn.disabled = false;
        progressContainer.hidden = true;
      }
    } catch (_) { /* ignore parse errors */ }
  };

  evtSource.onerror = () => {
    evtSource.close();
    setTimeout(() => checkJobStatus(jobId), 1000);
  };
}

async function checkJobStatus(jobId) {
  try {
    const evtSource = new EventSource(`${API}/progress/${jobId}`);
    evtSource.onmessage = (e) => {
      const info = JSON.parse(e.data);
      if (info.status === 'completed') {
        evtSource.close();
        onMergeComplete(jobId);
      } else if (info.status === 'failed') {
        evtSource.close();
        showToast(info.error || 'Merge failed.');
        mergeBtn.disabled = false;
        progressContainer.hidden = true;
      }
    };
  } catch (_) {
    showToast('Lost connection to the server.');
    mergeBtn.disabled = false;
    progressContainer.hidden = true;
  }
}

function updateProgress(percent) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
}

// ═══════════════════════════════════════════════════
//  Merge Complete
// ═══════════════════════════════════════════════════

function onMergeComplete(jobId) {
  updateProgress(100);
  showToast('Videos merged successfully!', 'success');
  mergeBtn.disabled = false;

  resultArea.hidden = false;
  previewPlayer.src = `${API}/preview/${jobId}`;

  downloadBtn.onclick = () => {
    window.location.href = `${API}/download/${jobId}`;
  };

  cleanupBtn.onclick = async () => {
    try {
      await fetch(`${API}/cleanup/${jobId}`, { method: 'DELETE' });
      showToast('Temp files deleted.', 'info');
      resultArea.hidden = true;
      progressContainer.hidden = true;
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
