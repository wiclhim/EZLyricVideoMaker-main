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

/**
 * Generates SRT subtitles from an audio file using Gemini.
 */
export const generateSrtFromAudio = async (audioFile: File): Promise<string> => {
  const ai = getAiClient();
  const audioPart = await fileToGenerativePart(audioFile);

  // 🔴 修改重點：加入明確的「範例 (Example)」讓模型照抄格式
  const prompt = `
    You are a professional subtitle generator.
    Listen to the audio and output standard SRT format subtitles for the LYRICS only.

    STRICT OUTPUT FORMAT EXAMPLE (Follow this layout exactly):
    1
    00:00:00,000 --> 00:00:05,000
    (Intro)

    2
    00:00:05,000 --> 00:00:10,000
    First line of the lyrics

    3
    00:00:10,000 --> 00:00:15,500
    Second line of the lyrics

    RULES:
    1. Do NOT use markdown code blocks. Output raw text.
    2. Do NOT add headers like "Lyrics" or title. Start directly with index 1.
    3. Time format must be exactly HH:MM:SS,mmm.
    4. Do NOT combine timestamp and text on the same line.
    5. No [Instrumental], [Applause] or non-lyrics tags.
    6. If there is no vocal, do not output anything for that period.
  `;

  // 使用 gemini-2.5-flash (穩定版)
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [audioPart, { text: prompt }],
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Failed to generate subtitles.");
  }

  // Cleanup potential markdown if the model disobeys slightly
  return text.replace(/```srt/g, '').replace(/```/g, '').trim();
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

  // 圖片生成維持使用 gemini-2.5-flash (或支援圖片的模型)
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