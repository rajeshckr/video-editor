import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type { Clip, Track, AssetMeta, Project, SnackbarMessage } from '../types';

interface EditorState {
  project: Project;
  assets: AssetMeta[];
  cursorTime: number;
  playbackState: 'playing' | 'paused';
  selectedClipId: string | null;
  zoom: number; // pixels per second
  textEditorOpen: boolean;
  exportPanelOpen: boolean;
  history: Project[];
  historyIndex: number;
  snackbars: SnackbarMessage[];

  // Actions
  addSnackbar: (type: SnackbarMessage['type'], message: string) => void;
  removeSnackbar: (id: string) => void;
  addAsset: (asset: AssetMeta) => void;
  addTrack: (type: Track['type']) => void;
  removeTrack: (trackId: string) => void;
  addClipToTrack: (trackId: string, clip: Omit<Clip, 'id' | 'trackId' | 'trackNumber'>) => void;
  updateClip: (trackId: string, clipId: string, updates: Partial<Clip>) => void;
  removeClip: (trackId: string, clipId: string) => void;
  moveClip: (fromTrackId: string, toTrackId: string, clipId: string, newPosition: number) => void;
  splitClip: (trackId: string, clipId: string, splitTime: number) => void;
  setCursorTime: (time: number) => void;
  setPlaybackState: (state: 'playing' | 'paused') => void;
  setSelectedClip: (clipId: string | null) => void;
  setInPoint: (t: number) => void;
  setOutPoint: (t: number) => void;
  setZoom: (zoom: number) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackVisible: (trackId: string) => void;
  setTextEditorOpen: (open: boolean) => void;
  setExportPanelOpen: (open: boolean) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (project: Project, assets: AssetMeta[]) => void;
  updateProjectName: (name: string) => void;
}

const DEFAULT_PROJECT: Project = {
  projectName: 'Untitled Project',
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  duration: 120,
  inPoint: 0,
  outPoint: 120,
  tracks: [
    { id: uuidv4(), type: 'video', trackNumber: 0, name: 'Video 1', muted: false, visible: true, clips: [] },
    { id: uuidv4(), type: 'audio', trackNumber: 1, name: 'Audio 1', muted: false, visible: true, clips: [] },
    { id: uuidv4(), type: 'overlay', trackNumber: 2, name: 'Overlay 1', muted: false, visible: true, clips: [] },
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
    textEditorOpen: false,
    exportPanelOpen: false,
    history: [],
    historyIndex: -1,
    snackbars: [],

    addSnackbar: (type, message) => set(state => {
      state.snackbars.push({ id: uuidv4(), type, message });
    }),

    removeSnackbar: (id) => set(state => {
      state.snackbars = state.snackbars.filter(s => s.id !== id);
    }),

    addAsset: (asset) => set(state => { state.assets.push(asset); }),

    addTrack: (type) => set(state => {
      const maxNum = state.project.tracks.reduce((m, t) => Math.max(m, t.trackNumber), -1);
      state.project.tracks.push({
        id: uuidv4(), type, trackNumber: maxNum + 1,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${state.project.tracks.filter(t => t.type === type).length + 1}`,
        muted: false, visible: true, clips: []
      });
    }),

    removeTrack: (trackId) => set(state => {
      state.project.tracks = state.project.tracks.filter(t => t.id !== trackId);
    }),

    addClipToTrack: (trackId, clipData) => set(state => {
      const track = state.project.tracks.find(t => t.id === trackId);
      if (!track) return;
      const newClip: Clip = {
        id: uuidv4(),
        trackId,
        trackNumber: track.trackNumber,
        ...clipData,
      } as Clip;
      track.clips.push(newClip);
      // Expand project duration if needed
      const end = newClip.timelinePosition + newClip.timelineDuration;
      if (end > state.project.duration) {
        state.project.duration = end + 10;
        if (state.project.outPoint < end) state.project.outPoint = end;
      }
    }),

    updateClip: (trackId, clipId, updates) => set(state => {
      const track = state.project.tracks.find(t => t.id === trackId);
      if (!track) return;
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) Object.assign(clip, updates);
    }),

    removeClip: (trackId, clipId) => set(state => {
      const track = state.project.tracks.find(t => t.id === trackId);
      if (track) track.clips = track.clips.filter(c => c.id !== clipId);
    }),

    moveClip: (fromTrackId, toTrackId, clipId, newPosition) => set(state => {
      const fromTrack = state.project.tracks.find(t => t.id === fromTrackId);
      if (!fromTrack) return;
      const clipIdx = fromTrack.clips.findIndex(c => c.id === clipId);
      if (clipIdx === -1) return;
      const [clip] = fromTrack.clips.splice(clipIdx, 1);
      clip.timelinePosition = Math.max(0, newPosition);
      if (toTrackId !== fromTrackId) {
        const toTrack = state.project.tracks.find(t => t.id === toTrackId);
        if (toTrack) {
          clip.trackId = toTrackId;
          clip.trackNumber = toTrack.trackNumber;
          toTrack.clips.push(clip);
        }
      } else {
        fromTrack.clips.push(clip);
      }
    }),

    splitClip: (trackId, clipId, splitTime) => set(state => {
      const track = state.project.tracks.find(t => t.id === trackId);
      if (!track) return;
      const clip = track.clips.find(c => c.id === clipId);
      if (!clip) return;
      const relativeTime = splitTime - clip.timelinePosition;
      if (relativeTime <= 0 || relativeTime >= clip.timelineDuration) return;

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
    }),

    setCursorTime: (time) => set(state => { state.cursorTime = Math.max(0, time); }),
    setPlaybackState: (s) => set(state => { state.playbackState = s; }),
    setSelectedClip: (id) => set(state => { state.selectedClipId = id; }),
    setInPoint: (t) => set(state => { state.project.inPoint = Math.max(0, t); }),
    setOutPoint: (t) => set(state => { state.project.outPoint = Math.min(state.project.duration, t); }),
    setZoom: (zoom) => set(state => { state.zoom = Math.max(20, Math.min(300, zoom)); }),

    toggleTrackMute: (trackId) => set(state => {
      const t = state.project.tracks.find(t => t.id === trackId);
      if (t) t.muted = !t.muted;
    }),

    toggleTrackVisible: (trackId) => set(state => {
      const t = state.project.tracks.find(t => t.id === trackId);
      if (t) t.visible = !t.visible;
    }),

    setTextEditorOpen: (open) => set(state => { state.textEditorOpen = open; }),
    setExportPanelOpen: (open) => set(state => { state.exportPanelOpen = open; }),

    undo: () => {
      const { history, historyIndex } = get();
      if (historyIndex > 0) {
        set(state => {
          state.historyIndex = historyIndex - 1;
          state.project = JSON.parse(JSON.stringify(history[historyIndex - 1]));
        });
      }
    },

    redo: () => {
      const { history, historyIndex } = get();
      if (historyIndex < history.length - 1) {
        set(state => {
          state.historyIndex = historyIndex + 1;
          state.project = JSON.parse(JSON.stringify(history[historyIndex + 1]));
        });
      }
    },

    loadProject: (project, assets) => set(state => {
      state.project = project;
      state.assets = assets;
      state.cursorTime = 0;
      state.selectedClipId = null;
    }),

    updateProjectName: (name) => set(state => { state.project.projectName = name; }),
  }))
);
