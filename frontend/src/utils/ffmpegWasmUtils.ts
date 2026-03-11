import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import workerURL from '@ffmpeg/ffmpeg/worker?url';
import Logger from './logger';

const logger = Logger.getInstance('FFmpegWasm');

let ffmpeg: FFmpeg | null = null;
let isLoading = false;

export const initFFmpeg = async (): Promise<FFmpeg> => {
  console.log('[initFFmpeg] called');
  if (ffmpeg) {
    console.log('[initFFmpeg] ffmpeg already initialized');
    return ffmpeg;
  }
  if (isLoading) {
    console.log('[initFFmpeg] isLoading is true, waiting for existing load to finish');
    // Wait until it's loaded if concurrent requests happen
    let waitCount = 0;
    while (isLoading) {
      await new Promise(r => setTimeout(r, 100));
      waitCount++;
      if (waitCount % 10 === 0) console.log('[initFFmpeg] still waiting for ffmpeg to load...');
    }
    if (ffmpeg) {
      console.log('[initFFmpeg] ffmpeg loaded by another call');
      return ffmpeg;
    }
    console.warn('[initFFmpeg] waited for ffmpeg but it is still not initialized');
  }

  isLoading = true;
  try {
    console.log('[initFFmpeg] Instantiating FFmpeg');
    const f = new FFmpeg();

    f.on('log', ({ message }) => {
      logger.debug(message);
    });

    console.log('[initFFmpeg] Loading ffmpeg-core.js, ffmpeg-core.wasm, and worker from Vite assets');
    
    // In Vite, these imports resolve to static paths directly.
    await f.load({ 
      coreURL, 
      wasmURL,
      classWorkerURL: workerURL
    });
    console.log('[initFFmpeg] FFmpeg WASM loaded');

    ffmpeg = f;
    return f;
  } catch (err) {
    console.error('[initFFmpeg] Error during FFmpeg load:', err);
    throw err;
  } finally {
    isLoading = false;
    console.log('[initFFmpeg] isLoading set to false');
  }
};

export const extractAudioLocally = async (videoFile: File | Blob, originalName: string): Promise<File> => {
  logger.debug('[extractAudioLocally] called:', {videoFile, originalName});
  const ffmpegInstance = await initFFmpeg();

  const videoName = 'input.mp4';
  const audioName = 'output.mp3';

  const fetchedFile = await fetchFile(videoFile);
  await ffmpegInstance.writeFile(videoName, fetchedFile);

  logger.debug('[extractAudioLocally] Starting ffmpeg exec for audio extraction');

  await ffmpegInstance.exec([
    '-i', videoName,
    '-vn', // no video
    '-acodec', 'libmp3lame',
    '-q:a', '2', // quality
    audioName
  ]);

  const audioData = await ffmpegInstance.readFile(audioName);
  const audioBlob = new Blob([audioData as any], { type: 'audio/mp3' });
  const audioFile = new File([audioBlob], originalName.replace(/\.[^/.]+$/, '.mp3'), { type: 'audio/mp3' });
  logger.debug('[extractAudioLocally] Audio file created:', audioFile);

  // Cleanup
  await ffmpegInstance.deleteFile(videoName);
  await ffmpegInstance.deleteFile(audioName);

  return audioFile;
};
