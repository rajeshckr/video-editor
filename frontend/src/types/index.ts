export interface Clip {
  id: string;
  type: 'video' | 'audio' | 'image' | 'text';
  assetId?: string; // References AssetMeta.id (undefined for text/caption clips)
  originalName: string;
  srcStart: number;
  srcEnd: number;
  timelinePosition: number;
  timelineDuration: number;
  trackId: string;
  trackNumber: number;
  volume: number;
  opacity: number;
  transform: { x: number; y: number; scale: number; rotation: number };
  effects: string[];
  // Text-only
  text?: string;
  font?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  x?: number;
  y?: number;
  animation?: string;
}

export interface Track {
  id: string;
  type: 'video' | 'audio' | 'image' | 'caption';
  trackNumber: number;
  name: string;
  muted: boolean;
  visible: boolean;
  clips: Clip[];
}

export interface AssetMeta {
  id: string;
  originalName: string;
  filename: string;
  filePath: string;
  localUrl?: string; // Instant preview URL
  localFile?: File; // For local processing (wasm-ffmpeg)
  uploadStatus?: 'uploading' | 'success' | 'failed'; // Upload tracking
  size: number;
  type: 'video' | 'audio' | 'image';
  duration: number;
  width: number;
  height: number;
  fps: number;
  thumbnail?: string;
}

export interface Project {
  projectName: string;
  resolution: { width: number; height: number };
  orientation?: 'portrait' | 'landscape';
  fps: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  tracks: Track[];
  assets: AssetMeta[];
}

export interface SnackbarMessage {
  id: string;
  type: 'error' | 'success' | 'info';
  message: string;
}
