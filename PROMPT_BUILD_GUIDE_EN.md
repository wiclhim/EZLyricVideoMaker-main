# Prompt Blueprint to Rebuild “Gemini Lyric Video Maker” (English)

> Goal: Provide a bullet-style prompt set for an AI coding assistant (Cursor / ChatGPT / Claude) to recreate an app with the same behavior as this repository (React + Vite + Electron + Gemini + FFmpeg.wasm).

## MUST Prompts

- **Project & stack**
  - Build a **Vite + React + TypeScript** SPA and wrap it with **Electron** for a Windows desktop app.
  - Use dependencies: `react`, `react-dom`, `@google/genai`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`, and package with `electron-builder` (Windows NSIS).
  - Minimum structure: `App.tsx`, `services/geminiService.ts`, `services/ffmpegService.ts`, `electron/main.cjs`, `types.ts`.

- **App flow (step-based UI)**
  - Implement 5 steps: Upload audio → Transcribing → Edit SRT → Generate cover image → Preview/Download.
  - Upload accepts **MP3/WAV** only and enforces a **25MB** size limit. If the API key is not set, disable upload.
  - Show errors in the UI and provide “Start Over” to reset state and revoke any previous video blob URL.

- **Gemini API key storage (local only)**
  - Let users input an API key and store it in `localStorage` under `gemini_api_key`.
  - Provide `setApiKey()` / `getApiKey()` / `clearApiKey()`. Any Gemini call must throw a clear error if no key exists.

- **Gemini: audio → SRT transcription**
  - Use `@google/genai` `GoogleGenAI` and call `models.generateContent` with model: `gemini-2.5-flash`.
  - Convert the audio `File` into base64 `inlineData` using `FileReader.readAsDataURL()` and take the payload after the comma.
  - The prompt must force **strict SRT output only** (no markdown, no explanations) with:
    - If the audio contains Chinese, transcribe in **Traditional Chinese** (not Simplified).
    - Timing format must be `HH:MM:SS,mmm --> HH:MM:SS,mmm` (comma before milliseconds).
    - Skip long instrumental sections or label them `[Instrumental]`.
  - Add a cleanup guard: if the model includes ``` fences, strip them and `trim()`.

- **Gemini: lyrics/subtitles → 1:1 cover art**
  - Use model: `gemini-2.5-flash-image`.
  - Prompt: analyze the first ~1000 chars of the subtitles/lyrics for mood/theme, then generate a high-quality **square (1:1)** cinematic digital-art album cover. **No text** on the image.
  - Parse output: scan `response.candidates[0].content.parts` for `inlineData` and return `{ data, mimeType }`. If none found, throw.

- **FFmpeg.wasm: cover + audio + subtitles → MP4 (fully local)**
  - Implement a `VideoService` using `@ffmpeg/ffmpeg` with `load(onLog)` and `createVideo(...)`.
  - `load` must fetch FFmpeg core as blob URLs (avoid CORS) via `toBlobURL`:
    - `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js`
    - `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm`
  - `createVideo` must:
    - Get audio duration via an `<audio>` element metadata (fallback 180s on error).
    - Parse SRT into `{ text, startSec, endSec }`.
    - Render frames at **4 fps** to `frame00000.jpg`… using Canvas:
      - Draw the cover image as a “cover/crop” background on 1280×720 with black letterboxing background.
      - Draw centered subtitles with white fill + black outline; auto-wrap to fit width.
    - Write frames + audio into FFmpeg FS and run:
      - `-framerate 4 -i frame%05d.jpg -i audio.ext -c:v libx264 -preset ultrafast -c:a aac -b:a 128k -pix_fmt yuv420p -shortest output.mp4`
    - Return a blob URL for the MP4 and clean up generated files (frames, audio, output).
  - The UI must show progress (0–100%): a portion for frame generation and use `ffmpeg.on('progress')` for encoding progress.

- **Downloads**
  - Provide downloads for:
    - `.srt` (textarea content → Blob download)
    - `cover_art.png` (download from `data:mime;base64,...`)
    - `lyric_video.mp4` (download the produced blob URL)

- **Electron main process (shell only)**
  - `electron/main.cjs` must:
    - In dev: load `http://localhost:3000` and open DevTools.
    - In prod: load `dist/index.html`.
    - Use `nodeIntegration: false`, `contextIsolation: true`, and hide the menu bar.

## NICE-TO-HAVE Prompts

- **UI/UX polish**
  - Dark modern UI, gradient title, step indicator, spinners, dismissible error banner.
  - Show FFmpeg logs (filter out noisy `frame=` lines) and a smoother progress bar.
  - Preview cover art and SRT side-by-side before video generation.

- **Performance & resilience**
  - Frame caching: if the subtitle text doesn’t change between frames, reuse the last rendered JPEG bytes.
  - Add tolerant SRT parsing/normalization in case Gemini outputs slightly malformed timestamps.
  - Revoke old `generatedVideoUrl` via `URL.revokeObjectURL` to prevent memory growth.

- **Packaging**
  - Use `electron-builder` to produce a Windows NSIS installer (optional: allow custom install dir, desktop/start menu shortcuts, perMachine).


