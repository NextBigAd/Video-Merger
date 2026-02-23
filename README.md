# Video Merger

A full-stack video merging tool built with **Node.js**, **Express**, and **FFmpeg**.
Upload multiple video clips, arrange them, tweak settings, and merge them into a single video — all locally, no third-party APIs.

---

## Features

- **Drag-and-drop upload** — add multiple video files at once
- **Clip reordering** — drag clips to set the merge order
- **Per-clip trimming** — set start / end times for each clip
- **Custom resolution** — 4K, Full HD, HD, SD, or any custom size
- **Aspect ratio control** — 16:9, 9:16, 4:3, 1:1, or custom
- **Output format** — MP4, MOV, or WebM
- **Quality presets** — Low, Medium, High, or custom bitrate
- **Transition effects** — None, Fade, or Crossfade between clips
- **Audio mixing** — Keep all audio, mute all, or keep first clip only
- **Watermark overlay** — optional text watermark on the output
- **Letterboxing** — automatic padding when aspect ratios don't match
- **Real-time progress** — live progress bar via Server-Sent Events
- **Preview & download** — preview the result in-browser, then download
- **Auto-cleanup** — temp files older than 1 hour are deleted automatically

---

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** (comes with Node.js)

> FFmpeg is bundled automatically via `ffmpeg-static` — no manual FFmpeg install required.

---

## Setup

```bash
# 1. Clone or download this project
cd video-merger

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

The app will be available at **http://localhost:5000**.

---

## Configuration

Edit the `.env` file in the project root:

| Variable       | Default  | Description                        |
| -------------- | -------- | ---------------------------------- |
| `PORT`         | `5000`   | Server port                        |
| `MAX_FILE_SIZE`| `500mb`  | Maximum upload size per file       |

---

## API Endpoints

| Method   | Endpoint           | Description                             |
| -------- | ------------------ | --------------------------------------- |
| `POST`   | `/api/upload`      | Upload multiple video files             |
| `POST`   | `/api/merge`       | Start a merge job                       |
| `GET`    | `/api/progress/:id`| Stream merge progress (SSE)             |
| `GET`    | `/api/download/:id`| Download the merged video               |
| `GET`    | `/api/preview/:id` | Stream a preview of the merged video    |
| `DELETE` | `/api/cleanup/:id` | Delete temp files for a job             |

---

## Project Structure

```
video-merger/
├── backend/
│   ├── server.js              # Express entry point
│   ├── routes/
│   │   └── merge.js           # API route definitions
│   ├── controllers/
│   │   └── mergeController.js # Business logic
│   ├── utils/
│   │   └── ffmpegHelper.js    # FFmpeg operations
│   ├── uploads/               # Temporary uploaded files
│   └── outputs/               # Merged output files
├── frontend/
│   ├── index.html             # UI markup
│   ├── style.css              # Styling
│   └── app.js                 # Client-side logic
├── .env                       # Environment variables
├── .gitignore
├── package.json
└── README.md
```

---

## License

MIT
