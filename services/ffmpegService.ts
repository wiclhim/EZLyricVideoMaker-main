import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Core files CDN
const CORE_URL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js";
const WASM_URL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm";

export class VideoService {
  private ffmpeg: FFmpeg;
  private loaded: boolean = false;

  constructor() {
    this.ffmpeg = new FFmpeg();
  }

  async load(onLog: (msg: string) => void) {
    if (this.loaded) return;

    onLog("Loading video engine...");

    try {
      this.ffmpeg.on('log', ({ message }) => {
        if (message && !message.startsWith('frame=')) {
          onLog(message);
        }
      });

      onLog("Downloading core files...");
      const coreURL = await toBlobURL(CORE_URL, 'text/javascript');
      const wasmURL = await toBlobURL(WASM_URL, 'application/wasm');

      onLog("Loading worker...");
      await this.ffmpeg.load({
        coreURL,
        wasmURL,
      });

      this.loaded = true;
      onLog("Engine ready!");
    } catch (error: any) {
      console.error("FFmpeg load failed:", error);
      throw new Error(`Engine load failed: ${error.message || "Unknown error"}`);
    }
  }

  /**
   * Get audio duration in seconds
   */
  private async getAudioDuration(audioFile: File): Promise<number> {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.src = URL.createObjectURL(audioFile);
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(audio.src);
        resolve(audio.duration || 180); 
      };
      audio.onerror = () => {
        resolve(180);
      };
    });
  }

  /**
   * Load image from Base64 string
   */
  private async loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Wrap text to fit within maxWidth
   */
  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split('');
    const lines: string[] = [];
    let currentLine = '';

    for (const char of words) {
      const testLine = currentLine + char;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  }

  /**
   * Render a frame with subtitle using Canvas
   */
  private async renderFrame(
    baseImage: HTMLImageElement,
    subtitle: string,
    width: number,
    height: number
  ): Promise<Uint8Array> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Draw base image (scaled to fit covering the canvas)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    const scale = Math.max(width / baseImage.width, height / baseImage.height);
    const scaledWidth = baseImage.width * scale;
    const scaledHeight = baseImage.height * scale;
    const x = (width - scaledWidth) / 2;
    const y = (height - scaledHeight) / 2;
    
    ctx.drawImage(baseImage, x, y, scaledWidth, scaledHeight);

    // Draw subtitle if present
    if (subtitle) {
      const fontSize = 48;
      ctx.font = `bold ${fontSize}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Shadow for better visibility
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      const maxWidth = width - 100;
      const lines = this.wrapText(ctx, subtitle, maxWidth);
      const lineHeight = fontSize * 1.3;
      const totalHeight = lines.length * lineHeight;
      
      // Subtitle position: Bottom center with margin
      const marginBottom = 80;
      const startY = height - marginBottom - totalHeight + (lineHeight / 2);

      lines.forEach((line, index) => {
        const lineY = startY + index * lineHeight;
        
        // Outline (Stroke)
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, width / 2, lineY);
        
        // Fill
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(line, width / 2, lineY);
      });
    }

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9);
    });
    
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * Parse SRT content (Updated for Robustness)
   * Handles both standard SRT and compact formats (same-line text)
   * FIXED: Now supports variable length milliseconds (e.g. 0, 50, 480)
   */
  private parseSrtToSubtitles(srtContent: string): Array<{text: string, startSec: number, endSec: number}> {
    // 1. Normalize line endings and remove empty lines
    const lines = srtContent.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l);
    const subtitles: Array<{text: string, startSec: number, endSec: number}> = [];

    // SYNC_OFFSET: Adjust if subtitles are too early/late
    const SYNC_OFFSET = 0;

    // 2. Regex Updated: 
    // - \d{1,3} allows for 1, 2, or 3 digit milliseconds (e.g., :0, :50, :480)
    // - Supports [:,.] as separators
    const timeRegex = /((?:\d{1,2}:)?\d{1,2}:\d{1,2}[:.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{1,2}[:.,]\d{1,3})(.*)?/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(timeRegex);

      if (match) {
        const startSecRaw = this.timeToSeconds(match[1]);
        const endSecRaw = this.timeToSeconds(match[2]);

        if (startSecRaw === null || endSecRaw === null) continue;

        const startSec = Math.max(0, startSecRaw + SYNC_OFFSET);
        const endSec = Math.max(0, endSecRaw + SYNC_OFFSET);

        // 3. Extract text: Check same line first (Group 3)
        let text = match[3] ? match[3].trim() : '';

        // If no text on the same line, look ahead to next lines
        if (!text) {
          let j = i + 1;
          while (j < lines.length) {
            const nextLine = lines[j];
            // Stop if we hit another timestamp or a pure number (index) that looks like the start of next block
            if (timeRegex.test(nextLine) || (/^\d+$/.test(nextLine) && j < lines.length - 1 && timeRegex.test(lines[j+1]))) {
              break;
            }
            text += (text ? ' ' : '') + nextLine;
            j++;
            i++; // Skip processed line
          }
        }

        if (text) {
          subtitles.push({ text, startSec, endSec });
        }
      }
    }

    return subtitles;
  }

  /**
   * Convert timestamp string to seconds
   * Supports HH:MM:SS,mmm / HH:MM:SS:mmm / MM:SS,mmm / MM:SS:mmm
   * FIXED: Logic to correctly interpret "00:48:0" as MM:SS:ms instead of HH:MM:SS
   */
  private timeToSeconds(time: string): number | null {
    if (!time) return null;
    
    time = time.trim();
    // Split by colon, comma, or dot
    const parts = time.split(/[:,\.]/);
    
    let hours = 0, minutes = 0, seconds = 0, ms = 0;

    // Case: 00:00:22,200 (4 parts) -> Standard HH:MM:SS:ms
    if (parts.length === 4) {
      hours = parseInt(parts[0], 10) || 0;
      minutes = parseInt(parts[1], 10) || 0;
      seconds = parseInt(parts[2], 10) || 0;
      ms = parseInt(parts[3], 10) || 0;
    } 
    // Case: 00:22,200 or 00:48:0 (3 parts)
    // CRITICAL FIX: For lyric videos, we assume 3-part time is ALWAYS MM:SS:ms
    // because "HH:MM:SS" (hours long) is extremely rare for a single song file 
    // and causes "00:48:0" to be read as 48 minutes instead of 48 seconds.
    else if (parts.length === 3) {
      minutes = parseInt(parts[0], 10) || 0;
      seconds = parseInt(parts[1], 10) || 0;
      ms = parseInt(parts[2], 10) || 0;
    } else {
      return null;
    }

    // Handle variable length milliseconds (e.g. "5" -> 5ms, "50" -> 50ms, "500" -> 500ms)
    // Note: In some loose formats "5" might mean 500ms, but strict parsing is safer.
    // Given the input mixed 0, 50, 480, we treat them as direct ms values.
    
    return hours * 3600 + minutes * 60 + seconds + ms / 1000;
  }

  /**
   * Create video from audio, SRT, and image
   */
  async createVideo(
    audioFile: File,
    srtContent: string,
    imageBase64: string,
    onProgress: (ratio: number) => void
  ): Promise<string> {
    if (!this.loaded) throw new Error("FFmpeg not loaded");

    const audioExt = audioFile.name.split('.').pop() || 'mp3';
    const audioName = `audio.${audioExt}`;
    const outputName = 'output.mp4';

    onProgress(0.01);

    const subtitles = this.parseSrtToSubtitles(srtContent);
    const audioDuration = await this.getAudioDuration(audioFile);

    onProgress(0.05);
    const fps = 4;
    const totalFrames = Math.ceil(audioDuration * fps);
    
    const baseImage = await this.loadImage(imageBase64);
    
    let lastSubtitle = '';
    let cachedFrameData: Uint8Array | null = null;
    
    for (let i = 0; i < totalFrames; i++) {
      const currentTime = i / fps;
      const currentSubtitle = subtitles.find(
        sub => currentTime >= sub.startSec && currentTime < sub.endSec
      );
      
      const subtitleText = currentSubtitle?.text || '';
      
      if (subtitleText !== lastSubtitle || !cachedFrameData) {
        cachedFrameData = await this.renderFrame(
          baseImage, 
          subtitleText,
          1280, 
          720
        );
        lastSubtitle = subtitleText;
      }
      
      const frameName = `frame${i.toString().padStart(5, '0')}.jpg`;
      await this.ffmpeg.writeFile(frameName, new Uint8Array(cachedFrameData));
      
      if (i % 20 === 0) {
        onProgress(0.05 + (i / totalFrames) * 0.4);
      }
    }

    onProgress(0.45);

    await this.ffmpeg.writeFile(audioName, await fetchFile(audioFile));
    onProgress(0.50);

    this.ffmpeg.on('progress', ({ progress }) => {
      onProgress(0.50 + progress * 0.45);
    });

    await this.ffmpeg.exec([
      '-framerate', fps.toString(),
      '-i', 'frame%05d.jpg',
      '-i', audioName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-pix_fmt', 'yuv420p',
      '-shortest',
      outputName
    ]);

    onProgress(0.95);

    const data = await this.ffmpeg.readFile(outputName);

    try {
      for (let i = 0; i < totalFrames; i++) {
        const frameName = `frame${i.toString().padStart(5, '0')}.jpg`;
        await this.ffmpeg.deleteFile(frameName);
      }
      await this.ffmpeg.deleteFile(audioName);
      await this.ffmpeg.deleteFile(outputName);
    } catch (e) {
      // Ignore cleanup errors
    }

    onProgress(1);

    const blob = new Blob([data], { type: 'video/mp4' });
    return URL.createObjectURL(blob);
  }
}

export const videoService = new VideoService();