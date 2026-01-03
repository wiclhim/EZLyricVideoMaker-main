# 用 Prompt 重建「Gemini Lyric Video Maker」（中文）

> 目標：給一個 AI coding assistant（如 Cursor / ChatGPT / Claude）一組「列點式 Prompt」，讓它能重做出與本專案同等功能的應用（React + Vite + Electron + Gemini + FFmpeg.wasm）。

## 必須（MUST）Prompt 清單

- **專案與技術棧**
  - 請用 **Vite + React + TypeScript** 建立一個單頁應用，並提供 **Electron** 包裝成 Windows 桌面 App。
  - 使用依賴：`react`、`react-dom`、`@google/genai`、`@ffmpeg/ffmpeg`、`@ffmpeg/util`，並用 `electron-builder` 打包（Windows NSIS）。
  - 檔案結構至少包含：`App.tsx`、`services/geminiService.ts`、`services/ffmpegService.ts`、`electron/main.cjs`、`types.ts`。

- **App 流程（分步驟）**
  - UI 必須做成 5 個步驟狀態：上傳音檔 → 轉錄中 → 編輯 SRT → 產生封面 → 預覽/下載。
  - 音檔上傳只接受 **MP3/WAV**，並限制檔案大小 **25MB**；未設定 API Key 時必須禁用上傳。
  - 任何錯誤要顯示在 UI，並允許使用者「重新開始」清空狀態與釋放舊的 video blob URL。

- **Gemini API Key 管理（前端本機）**
  - API Key 必須由使用者輸入，並儲存在 `localStorage`（key 名稱：`gemini_api_key`）。
  - 需要提供：`setApiKey()` / `getApiKey()` / `clearApiKey()`；呼叫 Gemini 前必須檢查 key，沒有就丟出「請先輸入 API Key」的錯誤。

- **Gemini：音檔 → SRT（字幕轉錄）**
  - 使用 `@google/genai` 的 `GoogleGenAI`，呼叫 `models.generateContent`，模型固定用：`gemini-2.5-flash`。
  - 將 `File` 音檔轉為 `inlineData` base64（用 `FileReader.readAsDataURL`，取逗號後半段）。
  - Prompt 必須強制 Gemini 只輸出 **純 SRT 內容**（不要 markdown、不要解釋），並要求：
    - 若音檔包含中文，必須輸出 **繁體中文**（不要簡體）。
    - SRT timing 格式必須是 `HH:MM:SS,mmm --> HH:MM:SS,mmm`（毫秒用逗號）。
    - 長音樂間奏可跳過或用 `[Instrumental]`。
  - 仍要加一層防呆：若回傳包含 ```，要清掉 code fence 再 `trim()`。

- **Gemini：歌詞/字幕 → 封面圖（1:1）**
  - 使用模型：`gemini-2.5-flash-image`。
  - Prompt：根據字幕/歌詞前 1000 字分析氛圍，生成「高品質、方形 1:1、電影感數位藝術、不要文字」的封面。
  - 解析回應：從 `response.candidates[0].content.parts` 找 `inlineData`，回傳 `{ data, mimeType }`；沒找到就丟錯。

- **FFmpeg.wasm：封面 + 音檔 + 字幕 → MP4（在前端離線產生）**
  - 使用 `@ffmpeg/ffmpeg` 建立 `VideoService`，並提供 `load(onLog)` 與 `createVideo(...)`。
  - `load` 必須用 `toBlobURL` 從 CDN 下載 core 檔，避免 CORS：
    - `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js`
    - `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm`
  - `createVideo` 生成方式必須符合：
    - 先用 `<audio>` 讀 metadata 取得音檔秒數（失敗 fallback 180 秒）。
    - 解析 SRT 成 `{ text, startSec, endSec }`。
    - 以 **4 fps** 逐幀產生影格（`frame00000.jpg`…），每幀用 Canvas：
      - 背景為封面圖「等比放大覆蓋」到 1280×720（黑底、置中裁切）。
      - 字幕置中顯示、白字黑邊、必要時自動換行（逐字量測）。
    - 將所有 frame + 音檔丟給 ffmpeg 合成：
      - `-framerate 4 -i frame%05d.jpg -i audio.xxx -c:v libx264 -preset ultrafast -c:a aac -b:a 128k -pix_fmt yuv420p -shortest output.mp4`
    - 回傳 `URL.createObjectURL(new Blob([data], { type: 'video/mp4' }))`。
    - 產完要清理 ffmpeg 虛擬檔案系統（刪 frames、audio、output）。
  - UI 必須顯示進度（0-100%）：frame 生成占一段比例、ffmpeg exec 期間用 `ffmpeg.on('progress')` 更新。

- **下載功能**
  - 必須提供下載：
    - `.srt`（由 textarea 內容產生 Blob 下載）
    - `cover_art.png`（用 `data:mime;base64,...` 下載）
    - `lyric_video.mp4`（下載產生的 blob URL）

- **Electron 主程序（只做殼）**
  - `electron/main.cjs` 必須：
    - dev 模式載入 `http://localhost:3000` 並開 devtools。
    - production 載入 `dist/index.html`。
    - `nodeIntegration: false`、`contextIsolation: true`、隱藏選單列。

## 非必須（NICE-TO-HAVE）Prompt 清單

- **UI/UX 細節**
  - 做漂亮的深色系介面、漸層標題、step indicator、loading 動畫、錯誤可 dismiss。
  - 顯示 FFmpeg log（過濾掉 `frame=` 類型）與更細緻的進度條。
  - 產生影片前可以顯示封面預覽與 SRT 預覽區。

- **效能與穩定性**
  - 影格快取：同一段字幕連續多幀時重用上一張 frame（避免每幀重繪）。
  - SRT 時間格式容錯（Gemini 偶爾輸出不標準），可加 normalize/parse 的修正邏輯。
  - 產生完成後釋放舊的 `generatedVideoUrl`（`URL.revokeObjectURL`）避免記憶體累積。

- **打包與發佈**
  - 用 `electron-builder` 產出 Windows NSIS installer（可選：可改安裝路徑、建立捷徑、perMachine）。


