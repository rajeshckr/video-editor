export interface Clip {
  id: string;
  type: 'video' | 'audio' | 'image' | 'text';
  filePath: string;
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
  thumbnail?: string;
  width?: number;
  height?: number;
  fps?: number;
  // Text-only
  text?: string;
  font?: string;
  fontSize?: number;
  color?: string;
  x?: number;
  y?: number;
  animation?: string;
}

export interface Track {
  id: string;
  type: 'video' | 'audio' | 'overlay';
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
