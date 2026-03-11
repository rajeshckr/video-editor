import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import Logger from '../utils/logger';
import type { Clip, Track, AssetMeta, Project, SnackbarMessage } from '../types';
import { extractAudioLocally } from '../utils/ffmpegWasmUtils';

const logger = Logger.getInstance('EditorStore');

const canTrackAcceptClip = (trackType: Track['type'], clipType: Clip['type']): boolean => {
  if (trackType === 'video') return clipType === 'video';
  if (trackType === 'audio') return clipType === 'audio';
  if (trackType === 'image') return clipType === 'image';
  if (trackType === 'caption') return clipType === 'text';
  return false;
};

const ensureDefaultTracks = (project: Project) => {
  const requiredTypes: Track['type'][] = ['video', 'audio', 'image', 'caption'];
  const maxTrackNumber = project.tracks.reduce((m, t) => Math.max(m, t.trackNumber), -1);
  let nextTrackNumber = maxTrackNumber + 1;

  requiredTypes.forEach((type) => {
    const hasTrack = project.tracks.some(t => t.type === type);
    if (hasTrack) return;

    const count = project.tracks.filter(t => t.type === type).length + 1;
    const label = `${type.charAt(0).toUpperCase() + type.slice(1)} ${count}`;

    project.tracks.push({
      id: uuidv4(),
      type,
      trackNumber: nextTrackNumber,
      name: label,
      muted: false,
      visible: true,
      clips: [],
    });
    nextTrackNumber += 1;
  });
};

const migrateLegacyCaptionTracks = (project: Project) => {
  const imageClipsToMove: Clip[] = [];

  project.tracks.forEach(track => {
    if (track.type !== 'caption') return;

    const keepInCaption: Clip[] = [];
    track.clips.forEach(clip => {
      if (clip.type === 'image') {
        imageClipsToMove.push(clip);
        return;
      }
      keepInCaption.push(clip);
    });
    track.clips = keepInCaption;
  });

  if (imageClipsToMove.length === 0) return;

  let imageTrack = project.tracks.find(t => t.type === 'image');
  if (!imageTrack) {
    const maxTrackNumber = project.tracks.reduce((m, t) => Math.max(m, t.trackNumber), -1);
    imageTrack = {
      id: uuidv4(),
      type: 'image',
      trackNumber: maxTrackNumber + 1,
      name: `Image ${project.tracks.filter(t => t.type === 'image').length + 1}`,
      muted: false,
      visible: true,
      clips: [],
    };
    project.tracks.push(imageTrack);
  }

  imageClipsToMove.forEach(clip => {
    clip.trackId = imageTrack!.id;
    clip.trackNumber = imageTrack!.trackNumber;
    imageTrack!.clips.push(clip);
  });
};

interface EditorState {
  project: Project;
  assets: AssetMeta[];
  cursorTime: number;
  playbackState: 'playing' | 'paused';
  selectedClipId: string | null;
  zoom: number; // pixels per second
  exportPanelOpen: boolean;
  history: Project[];
  historyIndex: number;
  snackbars: SnackbarMessage[];
  outPointManuallySet: boolean; // Track if user has manually adjusted outPoint
  draggedMediaType: string | null;

  // Actions
  addSnackbar: (type: SnackbarMessage['type'], message: string) => void;
  removeSnackbar: (id: string) => void;
  addAsset: (asset: AssetMeta) => void;
  updateAsset: (assetId: string, updates: Partial<AssetMeta>) => void;
  addTrack: (type: Track['type']) => void;
  removeTrack: (trackId: string) => void;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;
  addClipToTrack: (trackId: string, clip: Omit<Clip, 'id' | 'trackId' | 'trackNumber'>) => void;
  updateClip: (trackId: string, clipId: string, updates: Partial<Clip>) => void;
  removeClip: (trackId: string, clipId: string) => void;
  reorderTrack: (draggedId: string, targetId: string) => void;
  moveClip: (fromTrackId: string, toTrackId: string, clipId: string, newPosition: number) => void;
  splitClip: (trackId: string, clipId: string, splitTime: number) => void;
  extractAudioFromVideo: (trackId: string, clipId: string) => Promise<void>;
  setCursorTime: (time: number) => void;
  setPlaybackState: (state: 'playing' | 'paused') => void;
  setSelectedClip: (clipId: string | null) => void;
  setInPoint: (t: number) => void;
  setOutPoint: (t: number) => void;
  setZoom: (zoom: number) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackVisible: (trackId: string) => void;
  setExportPanelOpen: (open: boolean) => void;
  setOrientation: (orientation: 'portrait' | 'landscape') => void;
  undo: () => void;
  redo: () => void;
  loadProject: (project: Project, assets: AssetMeta[]) => void;
  updateProjectName: (name: string) => void;
  setDraggedMediaType: (type: string | null) => void;
}

const DEFAULT_PROJECT: Project = {
  projectName: 'Untitled Project',
  resolution: { width: 1920, height: 1080 },
  orientation: 'landscape',
  fps: 30,
  duration: 120,
  inPoint: 0,
  outPoint: 120,
  tracks: [
    { id: uuidv4(), type: 'video', trackNumber: 0, name: 'Video 1', muted: false, visible: true, clips: [] },
    { id: uuidv4(), type: 'audio', trackNumber: 1, name: 'Audio 1', muted: false, visible: true, clips: [] },
    { id: uuidv4(), type: 'image', trackNumber: 2, name: 'Image 1', muted: false, visible: true, clips: [] },
    { id: uuidv4(), type: 'caption', trackNumber: 3, name: 'Caption 1', muted: false, visible: true, clips: [] },
  ],
  assets: [],
};

export const useEditorStore = create<EditorState>()(
  immer((set, get) => ({
    project: DEFAULT_PROJECT,
    assets: [],
    cursorTime: 0,
    playbackState: 'paused',
    selectedClipId: null,
    zoom: 80,
    exportPanelOpen: false,
    history: [],
    historyIndex: -1,
    snackbars: [],
    outPointManuallySet: false,
    draggedMediaType: null,

    addSnackbar: (type, message) => set(state => {
      state.snackbars.push({ id: uuidv4(), type, message });
    }),

    removeSnackbar: (id) => set(state => {
      state.snackbars = state.snackbars.filter(s => s.id !== id);
    }),

    addAsset: (asset) => set(state => {
      state.assets.push(asset);
    }),

    updateAsset: (assetId, updates) => set(state => {
      const asset = state.assets.find(a => a.id === assetId);
      if (asset) {
        Object.assign(asset, updates);
      }
    }),

    addTrack: (type) => set(state => {
      const maxNum = state.project.tracks.reduce((m, t) => Math.max(m, t.trackNumber), -1);
      const trackName = `${type.charAt(0).toUpperCase() + type.slice(1)} ${state.project.tracks.filter(t => t.type === type).length + 1}`;
      logger.action(`Create ${type} track`, 'SUCCESS', { trackName, trackNumber: maxNum + 1 });
      state.project.tracks.push({
        id: uuidv4(), type, trackNumber: maxNum + 1,
        name: trackName,
        muted: false, visible: true, clips: []
      });
    }),

    removeTrack: (trackId) => set(state => {
      const track = state.project.tracks.find(t => t.id === trackId);
      logger.action(`Remove track`, 'SUCCESS', { trackId, trackName: track?.name });
      state.project.tracks = state.project.tracks.filter(t => t.id !== trackId);
    }),

    updateTrack: (trackId, updates) => set(state => {
      const track = state.project.tracks.find(t => t.id === trackId);
      if (track) {
        logger.store('EditorStore', 'updateTrack', { trackId, updates: Object.keys(updates) });
        Object.assign(track, updates);
      }
    }),

    reorderTrack: (draggedId, targetId) => set(state => {
      const draggedIdx = state.project.tracks.findIndex(t => t.id === draggedId);
      const targetIdx = state.project.tracks.findIndex(t => t.id === targetId);
      if (draggedIdx < 0 || targetIdx < 0 || draggedIdx === targetIdx) return;
      
      const sortedTracks = [...state.project.tracks].sort((a, b) => b.trackNumber - a.trackNumber);
      const fromI = sortedTracks.findIndex(t => t.id === draggedId);
      const toI = sortedTracks.findIndex(t => t.id === targetId);
      
      const [moved] = sortedTracks.splice(fromI, 1);
      sortedTracks.splice(toI, 0, moved);
      
      const numTracks = sortedTracks.length;
      sortedTracks.forEach((t, i) => {
        const newNum = numTracks - 1 - i;
        const stateTrack = state.project.tracks.find(st => st.id === t.id);
        if (stateTrack) {
          stateTrack.trackNumber = newNum;
          stateTrack.clips.forEach(c => c.trackNumber = newNum);
        }
      });
    }),

    addClipToTrack: (trackId, clipData) => set(state => {
      const track = state.project.tracks.find(t => t.id === trackId);
      if (!track) {
        logger.error('Add clip to track failed:', new Error(`Track ${trackId} not found`));
        return;
      }

      if (!canTrackAcceptClip(track.type, clipData.type)) {
        logger.error('Add clip to track failed: incompatible clip/track types', new Error(`clipType=${clipData.type} trackType=${track.type}`));
        return;
      }
      
      // Auto-detect orientation from the first VIDEO clip added
      const hasExistingVideoClips = state.project.tracks.some(t => 
        t.clips.some(c => c.type === 'video')
      );
      
      if (!hasExistingVideoClips && clipData.type === 'video' && clipData.width && clipData.height) {
        const clipOrientation = clipData.width > clipData.height ? 'landscape' : 'portrait';
        state.project.orientation = clipOrientation;
        
        // Update resolution to match orientation
        if (clipOrientation === 'portrait') {
          state.project.resolution = { width: 1080, height: 1920 };
        } else {
          state.project.resolution = { width: 1920, height: 1080 };
        }
        
        logger.action(`Auto-detected orientation from first video clip`, 'SUCCESS', { 
          orientation: clipOrientation,
          clipDimensions: { width: clipData.width, height: clipData.height },
          newResolution: state.project.resolution
        });
      }
      
      const newClip: Clip = {
        id: uuidv4(),
        trackId,
        trackNumber: track.trackNumber,
        ...clipData,
      } as Clip;
      logger.action(`Add ${clipData.type} clip`, 'SUCCESS', { 
        clipName: clipData.originalName, 
        trackName: track.name,
        duration: clipData.timelineDuration
      });
      track.clips.push(newClip);
      // Expand project duration if needed
      const end = newClip.timelinePosition + newClip.timelineDuration;
      if (end > state.project.duration) {
        state.project.duration = end + 10;
      }
      // Auto-update outPoint to end of last clip if not manually set
      if (!get().outPointManuallySet) {
        const allClips = state.project.tracks.flatMap(t => t.clips);
        const lastClipEnd = allClips.reduce((max, c) => Math.max(max, c.timelinePosition + c.timelineDuration), 0);
        state.project.outPoint = lastClipEnd;
      }
    }),

    updateClip: (trackId, clipId, updates) => set(state => {
      const track = state.project.tracks.find(t => t.id === trackId);
      if (!track) return;
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        logger.store('EditorStore', 'updateClip', { clipId, updates: Object.keys(updates) });
        Object.assign(clip, updates);
        
        // Auto-update outPoint if not manually set
        if (!get().outPointManuallySet) {
          const allClips = state.project.tracks.flatMap(t => t.clips);
          const lastClipEnd = allClips.reduce((max, c) => Math.max(max, c.timelinePosition + c.timelineDuration), 0);
          state.project.outPoint = lastClipEnd;
        }
      }
    }),

    removeClip: (trackId, clipId) => set(state => {
      const track = state.project.tracks.find(t => t.id === trackId);
      if (track) {
        const clip = track.clips.find(c => c.id === clipId);
        logger.action(`Remove clip`, 'SUCCESS', { clipName: clip?.originalName, trackName: track.name });
        track.clips = track.clips.filter(c => c.id !== clipId);
        
        // Auto-update outPoint if not manually set
        if (!get().outPointManuallySet) {
          const allClips = state.project.tracks.flatMap(t => t.clips);
          const lastClipEnd = allClips.reduce((max, c) => Math.max(max, c.timelinePosition + c.timelineDuration), 0);
          state.project.outPoint = lastClipEnd || 0;
        }
      }
    }),

    moveClip: (fromTrackId, toTrackId, clipId, newPosition) => set(state => {
      const fromTrack = state.project.tracks.find(t => t.id === fromTrackId);
      if (!fromTrack) return;
      const clipIdx = fromTrack.clips.findIndex(c => c.id === clipId);
      if (clipIdx === -1) return;

      const clipToMove = fromTrack.clips[clipIdx];
      const toTrack = state.project.tracks.find(t => t.id === toTrackId);
      if (toTrackId !== fromTrackId && toTrack && !canTrackAcceptClip(toTrack.type, clipToMove.type)) {
        logger.warn('Move clip blocked: incompatible track type', { clipType: clipToMove.type, toTrackType: toTrack.type });
        return;
      }

      const [clip] = fromTrack.clips.splice(clipIdx, 1);
      clip.timelinePosition = Math.max(0, newPosition);
      if (toTrackId !== fromTrackId && toTrack) {
        clip.trackId = toTrackId;
        clip.trackNumber = toTrack.trackNumber;
        toTrack.clips.push(clip);
        logger.action(`Move clip to different track`, 'SUCCESS', { clipName: clip.originalName, toTrack: toTrack.name, position: newPosition });
      } else {
        fromTrack.clips.push(clip);
        logger.store('EditorStore', 'reposition clip', { clipName: clip.originalName, newPosition });
      }
      
      // Auto-update outPoint if not manually set
      if (!get().outPointManuallySet) {
        const allClips = state.project.tracks.flatMap(t => t.clips);
        const lastClipEnd = allClips.reduce((max, c) => Math.max(max, c.timelinePosition + c.timelineDuration), 0);
        state.project.outPoint = lastClipEnd;
      }
    }),

    splitClip: (trackId, clipId, splitTime) => set(state => {
      const track = state.project.tracks.find(t => t.id === trackId);
      if (!track) return;
      const clip = track.clips.find(c => c.id === clipId);
      if (!clip) return;
      const relativeTime = splitTime - clip.timelinePosition;
      if (relativeTime <= 0 || relativeTime >= clip.timelineDuration) {
        logger.error('Split clip failed: invalid split time', new Error(`relativeTime: ${relativeTime}, duration: ${clip.timelineDuration}`));
        return;
      }

      const firstDuration = relativeTime;
      const secondDuration = clip.timelineDuration - relativeTime;
      const srcOffset = clip.srcStart + relativeTime;

      // Shrink first clip
      clip.timelineDuration = firstDuration;
      clip.srcEnd = srcOffset;

      // Create second clip
      const newClip: Clip = {
        ...JSON.parse(JSON.stringify(clip)),
        id: uuidv4(),
        timelinePosition: splitTime,
        timelineDuration: secondDuration,
        srcStart: srcOffset,
        srcEnd: clip.srcEnd + secondDuration,
      };
      track.clips.push(newClip);
      logger.action(`Split clip`, 'SUCCESS', { clipName: clip.originalName, at: splitTime, firstDuration, secondDuration });
      
      // Auto-update outPoint if not manually set
      if (!get().outPointManuallySet) {
        const allClips = state.project.tracks.flatMap(t => t.clips);
        const lastClipEnd = allClips.reduce((max, c) => Math.max(max, c.timelinePosition + c.timelineDuration), 0);
        state.project.outPoint = lastClipEnd;
      }
    }),

    extractAudioFromVideo: async (trackId, clipId) => {
      const state = get();
      console.log('[extractAudioFromVideo] called with trackId:', trackId, 'clipId:', clipId);
      const vTrack = state.project.tracks.find(t => t.id === trackId);
      if (!vTrack) {
        console.error('[extractAudioFromVideo] No video track found for trackId:', trackId);
        return;
      }
      const vClip = vTrack.clips.find(c => c.id === clipId);
      if (!vClip || vClip.type !== 'video') {
        logger.error('Extract audio failed: not a video clip', new Error(`clipId: ${clipId}`));
        return;
      }

      state.addSnackbar('info', 'Extracting audio... This may take a moment.');

      // Obtain the file blob (prefer localFile, then localUrl, then server fallback)
      let videoBlob: Blob | File | undefined = vClip.localFile;
      if (!videoBlob && vClip.localUrl) {
        try {
          logger.debug('[extractAudioFromVideo]  Fetching videoBlob from localUrl:', vClip.localUrl);
          videoBlob = await (await fetch(vClip.localUrl)).blob();
        } catch (e) {
          logger.error('[extractAudioFromVideo] Failed to fetch from localUrl:', e);
        }
      }
      if (!videoBlob) {
        try {
          const fileName = vClip.filePath.split(/[\\/]/).pop();
          const url = `http://localhost:3001/api/upload/file/${fileName}`;
          console.log('[extractAudioFromVideo] Fetching videoBlob from server:', url);
          videoBlob = await (await fetch(url)).blob();
        } catch(e) {
          console.error('[extractAudioFromVideo] Failed to fetch videoBlob from server:', e);
        }
      }
      
      if (!videoBlob) {
        console.error('[extractAudioFromVideo] Failed to retrieve video data for extraction.');
        state.addSnackbar('error', 'Failed to retrieve video data for extraction.');
        return;
      }

      try {
        console.log('[extractAudioFromVideo] Calling extractAudioLocally...');
        const audioFile = await extractAudioLocally(videoBlob, vClip.originalName);

        // Extract metadata for the audio file
        let meta;
        try {
          // Dynamically import to avoid circular dependency
          meta = (await import('../utils/mediaUtils')).extractLocalMetadata;
          meta = await meta(audioFile);
          logger.debug('[extractAudioFromVideo] Extracted metadata for audio file:', meta);
        } catch (err) {
          logger.error('Failed to extract metadata from audio file, using defaults', err);
          meta = { duration: 0, width: 0, height: 0, fps: 0, type: 'audio', thumbnailUrl: undefined };
        }

        // Create AssetMeta for the extracted audio with real metadata
        const assetId = uuidv4();
        const localUrl = URL.createObjectURL(audioFile);
        const asset: AssetMeta = {
          id: assetId,
          originalName: audioFile.name,
          filename: audioFile.name,
          filePath: '', // Will be set after upload
          localUrl,
          localFile: audioFile,
          size: audioFile.size,
          type: 'audio',
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          uploadStatus: 'uploading',
          thumbnail: meta.thumbnailUrl
        };

        logger.info('Audio extraction - new asset (pending upload):', asset);
        set(draft => {
          draft.assets.push(asset);
        });

        // Dispatch a custom event so MediaLibrary can pick up and upload this asset
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('media-library-upload', { detail: { asset, file: audioFile } }));
        }, 0);

        // Add extracted audio as a clip to the first audio track (or create one)
        set(draft => {
          // Mute the original video clip
          const draftVTrack = draft.project.tracks.find(t => t.id === trackId);
          const draftVClip = draftVTrack?.clips.find(c => c.id === clipId);
          // if (draftVClip) {
          //     draftVClip.volume = 0;
          // }

          // Find or create an audio track
          let aTrack = draft.project.tracks.find(t => t.type === 'audio');
          if (!aTrack) {
            const maxNum = draft.project.tracks.reduce((m, t) => Math.max(m, t.trackNumber), -1);
            aTrack = {
              id: uuidv4(),
              type: 'audio',
              trackNumber: maxNum + 1,
              name: `Audio ${draft.project.tracks.filter(t => t.type === 'audio').length + 1}`,
              muted: false,
              visible: true,
              clips: []
            };
            draft.project.tracks.push(aTrack);
            logger.action(`Create audio track for extraction`, 'SUCCESS', { trackName: aTrack.name });
            console.log('[extractAudioFromVideo] Created new audio track:', aTrack);
          }

          // Add the audio clip to the audio track
          const aClip: Clip = {
            id: uuidv4(),
            trackId: aTrack.id,
            trackNumber: aTrack.trackNumber,
            type: 'audio',
            originalName: audioFile.name,
            filePath: '', // Will be set after upload
            localUrl: localUrl,
            localFile: audioFile,
            timelinePosition: draftVClip ? draftVClip.timelinePosition : 0,
            timelineDuration: draftVClip ? draftVClip.timelineDuration ?? 0 : 0,
            srcStart: 0,
            srcEnd: 0,
            volume: 1,
            opacity: 1,
            transform: { x: 0, y: 0, scale: 1, rotation: 0 },
            effects: [],
            thumbnail: undefined,
            width: 0,
            height: 0,
            fps: 0,
          };
          aTrack.clips.push(aClip);
          logger.info('Audio extraction - new audio clip added to audio track:', aClip);

          // Update outPoint if not manually set
          if (!draft.outPointManuallySet) {
            const allClips = draft.project.tracks.flatMap(t => t.clips);
            draft.project.outPoint = allClips.reduce((max, c) => Math.max(max, c.timelinePosition + (c.timelineDuration || 0)), 0);
          }
        });

        get().addSnackbar('success', 'Audio extracted successfully.');
      } catch (err: any) {
        logger.error('Extraction failed', err);
        state.addSnackbar('error', `Audio extraction failed: ${err.message}`);
      }
    },

    setCursorTime: (time) => set(state => { state.cursorTime = Math.max(0, time); }),
    setPlaybackState: (s) => set(state => { state.playbackState = s; }),
    setSelectedClip: (id) => set(state => { state.selectedClipId = id; }),
    setInPoint: (t) => set(state => { state.project.inPoint = Math.max(0, t); }),
    setOutPoint: (t) => set(state => { 
      state.project.outPoint = Math.min(state.project.duration, t);
      state.outPointManuallySet = true; // Mark as manually set
      logger.action('Set outPoint manually', 'SUCCESS', { outPoint: t });
    }),
    setZoom: (zoom) => set(state => { state.zoom = Math.max(2, Math.min(300, zoom)); }),

    toggleTrackMute: (trackId) => set(state => {
      const t = state.project.tracks.find(t => t.id === trackId);
      if (t) {
        t.muted = !t.muted;
        logger.action(`${t.muted ? 'Mute' : 'Unmute'} track`, 'SUCCESS', { trackName: t.name });
      }
    }),

    toggleTrackVisible: (trackId) => set(state => {
      const t = state.project.tracks.find(t => t.id === trackId);
      if (t) {
        t.visible = !t.visible;
        logger.action(`${t.visible ? 'Show' : 'Hide'} track`, 'SUCCESS', { trackName: t.name });
      }
    }),

    setExportPanelOpen: (open) => set(state => { state.exportPanelOpen = open; }),

    setOrientation: (orientation) => set(state => {
      state.project.orientation = orientation;
      // Update resolution to match orientation
      if (orientation === 'portrait') {
        state.project.resolution = { width: 1080, height: 1920 };
      } else {
        state.project.resolution = { width: 1920, height: 1080 };
      }
      logger.action(`Set orientation`, 'SUCCESS', { orientation, resolution: state.project.resolution });
    }),

    undo: () => {
      const { history, historyIndex } = get();
      if (historyIndex > 0) {
        logger.action('Undo', 'SUCCESS', { fromIndex: historyIndex, toIndex: historyIndex - 1 });
        set(state => {
          state.historyIndex = historyIndex - 1;
          state.project = JSON.parse(JSON.stringify(history[historyIndex - 1]));
        });
      } else {
        logger.warn('Undo: already at beginning of history');
      }
    },

    redo: () => {
      const { history, historyIndex } = get();
      if (historyIndex < history.length - 1) {
        logger.action('Redo', 'SUCCESS', { fromIndex: historyIndex, toIndex: historyIndex + 1 });
        set(state => {
          state.historyIndex = historyIndex + 1;
          state.project = JSON.parse(JSON.stringify(history[historyIndex + 1]));
        });
      } else {
        logger.warn('Redo: already at end of history');
      }
    },

    loadProject: (project, assets) => set(state => {
      migrateLegacyCaptionTracks(project);
      ensureDefaultTracks(project);
      logger.action('Load project', 'SUCCESS', { projectName: project.projectName, assetCount: assets.length, trackCount: project.tracks.length });
      state.project = project;
      state.assets = assets;
      state.cursorTime = 0;
      state.selectedClipId = null;
      state.outPointManuallySet = false; // Reset flag on project load
    }),

    updateProjectName: (name) => set(state => {
      logger.action('Update project name', 'SUCCESS', { newName: name });
      state.project.projectName = name;
    }),

    setDraggedMediaType: (type) => set(state => { state.draggedMediaType = type; }),
  }))
);
