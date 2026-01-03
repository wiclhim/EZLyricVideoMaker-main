import React, { useState, useRef, useEffect } from 'react';
import { AppStep, VideoData } from './types';
import { StepIndicator } from './components/StepIndicator';
import { Button } from './components/Button';
import { generateSrtFromAudio, generateCoverImage, setApiKey, getApiKey, clearApiKey } from './services/geminiService';
import { videoService } from './services/ffmpegService';

export default function App() {
  const [step, setStep] = useState<AppStep>(AppStep.UPLOAD);
  const [data, setData] = useState<VideoData>({
    audioFile: null,
    srtContent: '',
    imageBase64: null,
    imageMimeType: null,
    generatedVideoUrl: null,
  });
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegLogs, setFfmpegLogs] = useState<string>('');
  const [progress, setProgress] = useState(0);
  
  // API Key state
  const [apiKey, setApiKeyState] = useState<string>('');
  const [hasApiKey, setHasApiKey] = useState(false);

  // Check for stored API Key on load
  useEffect(() => {
    const storedKey = getApiKey();
    if (storedKey) {
      setApiKeyState(storedKey);
      setHasApiKey(true);
    }
  }, []);

  const handleSaveApiKey = () => {
    if (apiKey.trim()) {
      setApiKey(apiKey.trim());
      setHasApiKey(true);
      setError(null);
    }
  };

  const handleClearApiKey = () => {
    clearApiKey();
    setApiKeyState('');
    setHasApiKey(false);
    resetAndStartOver();
  };

  const resetAndStartOver = () => {
    if (data.generatedVideoUrl) {
      URL.revokeObjectURL(data.generatedVideoUrl);
    }
    setData({
      audioFile: null,
      srtContent: '',
      imageBase64: null,
      imageMimeType: null,
      generatedVideoUrl: null,
    });
    setStep(AppStep.UPLOAD);
    setError(null);
    setFfmpegLogs('');
    setProgress(0);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      setError("File size exceeds 25MB limit.");
      return;
    }

    if (!file.type.startsWith('audio/')) {
       setError("Please upload a valid audio file (MP3/WAV).");
       return;
    }

    setData(prev => ({ ...prev, audioFile: file }));
    setStep(AppStep.TRANSCRIBING);
    handleTranscribe(file);
  };

  const handleTranscribe = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    try {
      const srt = await generateSrtFromAudio(file);
      setData(prev => ({ ...prev, srtContent: srt }));
      setStep(AppStep.EDIT_SRT);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Transcription failed.");
      setStep(AppStep.UPLOAD); // Go back
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateImage = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await generateCoverImage(data.srtContent);
      setData(prev => ({ 
        ...prev, 
        imageBase64: result.data,
        imageMimeType: result.mimeType
      }));
      setStep(AppStep.PREVIEW_DOWNLOAD);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Image generation failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  // === 新增：處理使用者上傳自定義圖片 ===
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 檢查是否為圖片
    if (!file.type.startsWith('image/')) {
      setError('請上傳 JPG 或 PNG 圖片格式');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      // 更新狀態，將圖片換成使用者上傳的
      setData(prev => ({
        ...prev,
        imageBase64: result, 
        imageMimeType: file.type
      }));
      // 直接跳轉到下一步 (預覽/下載)
      setStep(AppStep.PREVIEW_DOWNLOAD);
    };
    reader.readAsDataURL(file);
  };
  // ===================================

  const handleCreateVideo = async () => {
    if (!data.audioFile || !data.imageBase64) return;

    setIsProcessing(true);
    setError(null);
    setFfmpegLogs('');
    setProgress(0);

    try {
      // Initialize FFmpeg if needed
      await videoService.load((msg) => {
         setFfmpegLogs(prev => prev + '\n' + msg);
      });

      const videoUrl = await videoService.createVideo(
        data.audioFile,
        data.srtContent,
        data.imageBase64,
        (prog) => setProgress(prog)
      );

      setData(prev => ({ ...prev, generatedVideoUrl: videoUrl }));
      setIsProcessing(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Video creation failed.");
      setIsProcessing(false);
    }
  };

  // Download helpers
  const downloadSrt = () => {
    const blob = new Blob([data.srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lyrics.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadImage = () => {
    if (!data.imageBase64) return;
    const a = document.createElement('a');
    a.href = data.imageBase64;
    a.download = 'cover_art.png';
    a.click();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center p-6">
      <header className="w-full max-w-4xl flex justify-between items-center mb-10">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Gemini Lyric Video Maker
        </h1>
        <div className="flex items-center gap-4">
           {hasApiKey ? (
             <div className="flex items-center gap-2">
               <span className="text-xs text-zinc-500 font-mono">API Key Active</span>
               <button onClick={handleClearApiKey} className="text-xs text-red-400 hover:text-red-300 underline">Change</button>
             </div>
           ) : (
             <div className="text-xs text-zinc-500">No API Key Set</div>
           )}
        </div>
      </header>

      <main className="w-full max-w-2xl flex-1 flex flex-col">
        {/* API Key Setup Screen */}
        {!hasApiKey ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-xl animate-fade-in">
             <h2 className="text-xl font-semibold mb-4 text-center">Setup Gemini API</h2>
             <p className="text-zinc-400 text-sm mb-6 text-center">
               This app runs entirely in your browser but needs a Gemini API Key to generate subtitles and art.
               <br/>
               <a href="https://aistudio.google.com/apikey" target="_blank" className="text-blue-400 hover:underline">Get a free key here</a>
             </p>
             <div className="flex gap-2">
               <input 
                 type="password" 
                 placeholder="Paste your API Key (AIza...)"
                 className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                 value={apiKey}
                 onChange={(e) => setApiKeyState(e.target.value)}
               />
               <Button onClick={handleSaveApiKey}>Save</Button>
             </div>
          </div>
        ) : (
          <div className="contents">
            <StepIndicator currentStep={step} />

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-xl min-h-[400px] relative overflow-hidden transition-all duration-300">
               
               {/* Error Banner */}
               {error && (
                 <div className="absolute top-0 left-0 right-0 bg-red-500/10 border-b border-red-500/20 text-red-400 p-3 text-sm flex justify-between items-center animate-slide-down">
                    <span>⚠️ {error}</span>
                    <button onClick={() => setError(null)} className="hover:text-red-300">✕</button>
                 </div>
               )}

               <div className="h-full flex flex-col justify-center items-center">
                 
                 {/* STEP 1: UPLOAD */}
                 {step === AppStep.UPLOAD && (
                    <div className="text-center w-full animate-fade-in">
                       <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-6">
                         <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>
                       </div>
                       <h3 className="text-xl font-semibold mb-2">Upload Song</h3>
                       <p className="text-zinc-500 text-sm mb-8">Select an MP3 or WAV file (max 25MB)</p>
                       
                       <div className="relative group w-full max-w-sm mx-auto">
                          <input 
                            type="file" 
                            accept="audio/mp3,audio/wav,audio/mpeg"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            onChange={handleUpload}
                          />
                          <Button className="w-full" variant="primary">
                            Choose File
                          </Button>
                       </div>
                    </div>
                 )}

                 {/* STEP 2: TRANSCRIBING */}
                 {step === AppStep.TRANSCRIBING && (
                    <div className="text-center animate-fade-in">
                      <div className="mb-6 relative">
                        <div className="w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto"></div>
                      </div>
                      <h3 className="text-lg font-medium animate-pulse">Listening to lyrics...</h3>
                      <p className="text-zinc-500 text-sm mt-2">Gemini is transcribing your audio</p>
                    </div>
                 )}

                 {/* STEP 3: EDIT SRT */}
                 {step === AppStep.EDIT_SRT && (
                    <div className="w-full h-full flex flex-col animate-fade-in">
                      <div className="flex justify-between items-end mb-2">
                        <h3 className="font-semibold text-lg">Review Lyrics</h3>
                        <span className="text-xs text-zinc-500">Edit timestamps or text if needed</span>
                      </div>
                      <textarea 
                        className="flex-1 w-full bg-zinc-950 border border-zinc-700 rounded-lg p-4 font-mono text-sm text-zinc-300 focus:ring-2 focus:ring-blue-500 outline-none resize-none min-h-[300px]"
                        value={data.srtContent}
                        onChange={(e) => setData({...data, srtContent: e.target.value})}
                      />
                      <div className="flex gap-3 mt-4">
                        <Button variant="secondary" onClick={downloadSrt} className="flex-1">
                          Save SRT
                        </Button>
                        <Button onClick={() => setStep(AppStep.GENERATING_IMAGE)} className="flex-[2]">
                          Next: Generate Art →
                        </Button>
                      </div>
                    </div>
                 )}

                 {/* STEP 4: GENERATE IMAGE */}
                 {step === AppStep.GENERATING_IMAGE && (
                    <div className="text-center w-full max-w-sm animate-fade-in">
                      {isProcessing ? (
                         <div className="flex flex-col items-center">
                            <div className="w-12 h-12 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4"></div>
                            <p className="text-purple-400 animate-pulse">Dreaming up a cover...</p>
                         </div>
                      ) : (
                        <>
                          <div className="w-24 h-24 bg-gradient-to-br from-blue-900/50 to-purple-900/50 rounded-xl flex items-center justify-center mx-auto mb-6 border border-white/10">
                            <svg className="w-10 h-10 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                          </div>
                          <h3 className="text-xl font-semibold mb-2">Create Cover Art</h3>
                          <p className="text-zinc-500 text-sm mb-8">AI will generate a cover based on the lyrics, or upload your own.</p>
                          
                          <Button 
                            onClick={handleGenerateImage} 
                            isLoading={isProcessing}
                            className="w-full mb-4"
                          >
                            ✨ Generate with AI
                          </Button>

                          {/* === 修改點：新增上傳自定義圖片按鈕 === */}
                          <div className="relative w-full">
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/jpg"
                              onChange={handleImageUpload}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            />
                            <Button variant="secondary" className="w-full">
                              <span className="flex items-center gap-2">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Upload My Own Image
                              </span>
                            </Button>
                          </div>
                          {/* =================================== */}
                        </>
                      )}
                    </div>
                 )}

                 {/* STEP 5: PREVIEW & DOWNLOAD */}
                 {step === AppStep.PREVIEW_DOWNLOAD && (
                   <div className="w-full h-full flex flex-col animate-fade-in">
                     <div className="grid grid-cols-2 gap-6 mb-6 flex-1">
                        {/* Preview Audio/SRT info */}
                        <div className="bg-zinc-950/50 rounded-lg p-4 border border-zinc-800">
                          <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Audio Track</h4>
                          <div className="flex items-center gap-3">
                             <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center">
                               🎵
                             </div>
                             <div className="overflow-hidden">
                               <p className="text-sm font-medium truncate">{data.audioFile?.name}</p>
                               <p className="text-xs text-zinc-500">{(data.audioFile?.size || 0) / 1024 / 1024 < 1 ? Math.round((data.audioFile?.size || 0)/1024) + ' KB' : ((data.audioFile?.size || 0)/1024/1024).toFixed(1) + ' MB'}</p>
                             </div>
                          </div>
                          <div className="mt-4">
                            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Lyrics</h4>
                            <div className="text-xs text-zinc-400 font-mono h-20 overflow-y-auto bg-black/20 p-2 rounded">
                               {data.srtContent}
                            </div>
                          </div>
                        </div>

                        {/* Preview Image */}
                        <div className="bg-zinc-950/50 rounded-lg p-4 border border-zinc-800 flex flex-col">
                           <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Cover Art</h4>
                           <div className="relative flex-1 bg-black rounded overflow-hidden group">
                              {data.imageBase64 && (
                                <img src={data.imageBase64} alt="Cover" className="w-full h-full object-cover" />
                              )}
                              <button 
                                onClick={downloadImage}
                                className="absolute bottom-2 right-2 bg-black/70 hover:bg-black text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Download Image"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                              </button>
                           </div>
                        </div>
                     </div>

                     {/* Action Area */}
                     <div className="mt-auto">
                        {!data.generatedVideoUrl ? (
                          <div className="space-y-4">
                            {isProcessing ? (
                               <div className="bg-zinc-950 rounded-lg p-4 border border-zinc-800">
                                  <div className="flex justify-between text-sm mb-2">
                                    <span className="text-blue-400 animate-pulse">Rendering Video...</span>
                                    <span className="font-mono">{Math.round(progress * 100)}%</span>
                                  </div>
                                  <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                                     <div className="h-full bg-blue-500 transition-all duration-300" style={{width: `${progress * 100}%`}}></div>
                                  </div>
                                  <pre className="mt-3 text-[10px] text-zinc-600 font-mono h-12 overflow-y-auto">
                                    {ffmpegLogs}
                                  </pre>
                               </div>
                            ) : (
                              <Button onClick={handleCreateVideo} className="w-full" variant="primary">
                                 Render Video (FFmpeg)
                              </Button>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 animate-fade-in">
                            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm text-center">
                                Video Ready!
                            </div>
                            <a 
                              href={data.generatedVideoUrl} 
                              download="lyric_video.mp4"
                              className="w-full"
                            >
                              <Button className="w-full" variant="primary">
                                Download Video
                                <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                              </Button>
                            </a>
                             <Button onClick={resetAndStartOver} variant="secondary" className="w-full">
                                Make Another
                             </Button>
                          </div>
                        )}
                     </div>
                   </div>
                </div>
              </div>
            )}
          </main>
    
          <footer className="mt-12 text-zinc-600 text-sm">
             Powered by Gemini Flash 2.5 & FFmpeg.wasm
          </footer>
        </div>
      );
    }