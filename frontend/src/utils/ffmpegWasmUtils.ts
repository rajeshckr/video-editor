import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import Logger from './logger';

const logger = Logger.getInstance('FFmpegWasm');

let ffmpeg: FFmpeg | null = null;
let isLoading = false;

export const initFFmpeg = async (): Promise<FFmpeg> => {
  if (ffmpeg) return ffmpeg;
  if (isLoading) {
    // Wait until it's loaded if concurrent requests happen
    while (isLoading) await new Promise(r => setTimeout(r, 100));
    if (ffmpeg) return ffmpeg;
  }
  
  isLoading = true;
  try {
    const f = new FFmpeg();
    
    f.on('log', ({ message }) => {
      logger.debug(message);
    });

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    
    await f.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpeg = f;
    return f;
  } finally {
    isLoading = false;
  }
};

export const extractAudioLocally = async (videoFile: File | Blob, originalName: string): Promise<File> => {
  const ffmpegInstance = await initFFmpeg();
  
  const videoName = 'input.mp4';
  const audioName = 'output.mp3';
  
  await ffmpegInstance.writeFile(videoName, await fetchFile(videoFile));
  
  logger.info(`Starting audio extraction for ${originalName}`);
  
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
  
  // Cleanup
  await ffmpegInstance.deleteFile(videoName);
  await ffmpegInstance.deleteFile(audioName);
  
  logger.info(`Extracted local audio: ${audioFile.name}`);
  
  return audioFile;
};
