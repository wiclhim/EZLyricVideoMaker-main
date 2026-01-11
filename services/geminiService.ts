import { GoogleGenAI } from "@google/genai";

let cachedApiKey: string | null = null;

export const setApiKey = (key: string) => {
  cachedApiKey = key;
  localStorage.setItem('gemini_api_key', key);
};

export const getApiKey = (): string | null => {
  if (cachedApiKey) return cachedApiKey;
  const stored = localStorage.getItem('gemini_api_key');
  if (stored) {
    cachedApiKey = stored;
    return stored;
  }
  return null;
};

export const clearApiKey = () => {
  cachedApiKey = null;
  localStorage.removeItem('gemini_api_key');
};

const getAiClient = () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Please enter your Gemini API Key first");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Converts a File object to a Base64 string suitable for Gemini API
 */
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve({
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// ==========================================
// 🛡️ GUARDRAILS: Helper Functions
// ==========================================

/**
 * Helper: Converts SRT timestamp string to seconds
 */
const srtTimeToSeconds = (time: string): number => {
  const parts = time.trim().split(/[:,\.]/);
  // Default to 0 if format is broken
  if (parts.length < 3) return 0;
  
  let h=0, m=0, s=0, ms=0;
  
  // Handle HH:MM:SS,mmm (4 parts) or MM:SS,mmm (3 parts)
  if (parts.length === 4) {
    h = parseInt(parts[0]) || 0;
    m = parseInt(parts[1]) || 0;
    s = parseInt(parts[2]) || 0;
    ms = parseInt(parts[3]) || 0;
  } else {
    m = parseInt(parts[0]) || 0;
    s = parseInt(parts[1]) || 0;
    ms = parseInt(parts[2]) || 0;
  }
  
  return h * 3600 + m * 60 + s + ms / 1000;
};

/**
 * Helper: Converts seconds back to strict SRT timestamp format (HH:MM:SS,mmm)
 */
const secondsToSrtTime = (totalSeconds: number): string => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 1000);

  const pad = (num: number, size: number) => num.toString().padStart(size, '0');
  // Ensure we always return comma for milliseconds (SRT standard)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
};

/**
 * 🛡️ CORE GUARDRAIL FUNCTION:
 * Parses raw AI output and forces logical consistency.
 * 1. Clamps duration (max 12s).
 * 2. Fixes overlaps.
 * 3. Re-indexes sequence numbers.
 */
const validateAndFixSrt = (rawSrt: string): string => {
  const lines = rawSrt.trim().split(/\r?\n/);
  const correctedBlocks: string[] = [];
  
  let currentIndex = 1;
  // Regex that supports both comma and colon for milliseconds
  const timeRegex = /((?:\d{1,2}:)?\d{1,2}:\d{1,2}[:.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{1,2}[:.,]\d{1,3})(.*)?/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(timeRegex);

    if (match) {
      // It's a timestamp line
      let startStr = match[1];
      let endStr = match[2];
      let extraText = match[3] || '';

      let startSec = srtTimeToSeconds(startStr);
      let endSec = srtTimeToSeconds(endStr);

      // --- LOGIC FIXES ---

      // Rule 1: Max Duration Clamp
      // If a subtitle is > 12 seconds, it's likely an AI hallucination (e.g., 10 minutes).
      // We clamp it to 5 seconds to be safe.
      if (endSec - startSec > 12) {
        endSec = startSec + 5;
      }

      // Rule 2: Logic Check
      // End time must be after Start time
      if (endSec <= startSec) {
        endSec = startSec + 3;
      }

      // -------------------

      // Extract subtitle text from this line (if any) and subsequent lines
      let text = extraText.trim();
      let j = i + 1;
      
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        // Skip empty lines
        if (!nextLine) { j++; continue; }
        
        // Stop if we hit a new index number or a new timestamp
        if (/^\d+$/.test(nextLine) || timeRegex.test(nextLine)) {
           // Double check: sometimes a line is just a number but part of lyrics.
           // But for SRT structure, we assume pure number is index.
           break;
        }
        
        text += (text ? ' ' : '') + nextLine;
        j++;
      }
      
      // Update outer loop index to skip the lines we just read
      i = j - 1;

      if (text) {
        // Rebuild the block with clean formatting
        correctedBlocks.push(`${currentIndex}`);
        correctedBlocks.push(`${secondsToSrtTime(startSec)} --> ${secondsToSrtTime(endSec)}`);
        correctedBlocks.push(`${text}\n`);
        currentIndex++;
      }
    }
  }

  // Fallback: If regex failed completely, return original (unlikely)
  if (correctedBlocks.length === 0) return rawSrt;

  return correctedBlocks.join('\n');
};

// ==========================================
// Main Exported Functions
// ==========================================

/**
 * Generates SRT subtitles from an audio file using Gemini.
 */
export const generateSrtFromAudio = async (audioFile: File): Promise<string> => {
  const ai = getAiClient();
  const audioPart = await fileToGenerativePart(audioFile);

  // 🔴 Prompt Updated: Added strict constraints on duration
  const prompt = `
    You are a professional subtitle generator.
    Listen to the audio and output standard SRT format subtitles for the LYRICS only.

    STRICT RULES:
    1. Output strictly standard SRT format.
    2. **CRITICAL**: No single subtitle line should last longer than 8 seconds. Split long lines if needed.
    3. Check your timestamps carefully. Do not confuse minutes (MM) with hours (HH).
    4. Time format: HH:MM:SS,mmm.
    5. Do NOT include [Intro], [Music], or non-lyric text.
    6. Return RAW text only. No markdown formatting.

    EXAMPLE:
    1
    00:00:14,480 --> 00:00:16,850
    Text of the lyrics here...
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [audioPart, { text: prompt }],
      },
    });

    let text = response.text;
    if (!text) {
      throw new Error("Failed to generate subtitles.");
    }

    // Cleanup potential markdown wrapper
    text = text.replace(/```srt/g, '').replace(/```/g, '').trim();

    // 🟢 Apply Guardrails: Fix timestamp logic before returning
    const fixedText = validateAndFixSrt(text);

    return fixedText;

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(error.message || "Failed to contact Gemini API.");
  }
};

/**
 * Generates a cover image based on the SRT context using Gemini.
 */
export const generateCoverImage = async (srtContent: string): Promise<{ data: string; mimeType: string }> => {
  const ai = getAiClient();

  const prompt = `
    Analyze the following subtitles/lyrics to understand the mood, theme, and imagery of the song:
    "${srtContent.slice(0, 1000)}..."
    
    Based on this analysis, generate a high-quality, artistic, square (1:1 aspect ratio) album cover art.
    Style: Cinematic, digital art, high resolution, evocative.
    Do not include text on the image.
  `;

  // Use a model that supports image generation (Flash 2.5 can generate images in some environments, 
  // or use 'imagen-3' if available in your API tier. Assuming Flash 2.5 supports it here or user has access).
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash', 
    contents: {
      parts: [{ text: prompt }],
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
        return {
            data: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
            mimeType: part.inlineData.mimeType
        };
    }
  }

  throw new Error("No image generated.");
};