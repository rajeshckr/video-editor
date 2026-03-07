import { useEffect, useState, useRef } from 'react';
import Logger from './utils/logger';
import Toolbar from './components/Toolbar';
import MediaLibrary from './components/MediaLibrary';
import PreviewPlayer from './components/PreviewPlayer';
import Timeline from './components/Timeline';
import TextClipEditor from './components/TextClipEditor';
import ExportPanel from './components/ExportPanel';
import SnackbarUI from './components/SnackbarUI';
import PropertiesPanel from './components/PropertiesPanel';
import { useEditorStore } from './store/editorStore';

const logger = Logger.getInstance('App');

export default function App() {
  const {
    exportPanelOpen, textEditorOpen, setPlaybackState, playbackState, project
  } = useEditorStore();

  const [timelineHeight, setTimelineHeight] = useState(() => {
    const saved = localStorage.getItem('timelineHeight');
    return saved ? parseInt(saved) : 280;
  });
  const isDraggingRef = useRef(false);

  // Log app initialization
  useEffect(() => {
    logger.info('🚀 Video Editor Application Loaded');
  }, []);

  // Save timeline height to localStorage
  useEffect(() => {
    localStorage.setItem('timelineHeight', timelineHeight.toString());
  }, [timelineHeight]);

  // Ensure timeline height meets minimum when tracks change
  useEffect(() => {
    const ZOOM_CONTROLS_HEIGHT = 41;
    const RULER_HEIGHT = 28;
    const MIN_TRACK_HEIGHT = 40;
    const minTimelineHeight = ZOOM_CONTROLS_HEIGHT + RULER_HEIGHT + (project.tracks.length * MIN_TRACK_HEIGHT);
    
    if (timelineHeight < minTimelineHeight) {
      setTimelineHeight(minTimelineHeight);
    }
  }, [project.tracks.length]);

  // Handle timeline resize drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newHeight = window.innerHeight - e.clientY;
      
      // Calculate minimum height based on number of tracks
      // Zoom controls: ~41px, Ruler: 28px, Min track height: 40px each
      const ZOOM_CONTROLS_HEIGHT = 41;
      const RULER_HEIGHT = 28;
      const MIN_TRACK_HEIGHT = 40;
      const minTimelineHeight = ZOOM_CONTROLS_HEIGHT + RULER_HEIGHT + (project.tracks.length * MIN_TRACK_HEIGHT);
      
      setTimelineHeight(Math.max(minTimelineHeight, Math.min(600, newHeight)));
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [project.tracks.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === ' ') {
        e.preventDefault();
        setPlaybackState(playbackState === 'playing' ? 'paused' : 'playing');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [playbackState, setPlaybackState]);

  return (
    <div className="flex flex-col h-screen bg-editor-bg overflow-hidden select-none">
      {/* Top Toolbar */}
      <Toolbar />

      {/* Middle section: Media Library + Preview + Properties */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        {/* Media Library */}
        <div className="w-64 shrink-0 border-r border-boundary overflow-auto">
          <MediaLibrary />
        </div>

        {/* Preview Player */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex items-center justify-center bg-editor-bg overflow-hidden p-2">
            <PreviewPlayer />
          </div>
        </div>

        {/* Properties Panel */}
        <div className="w-56 shrink-0 border-l border-boundary overflow-auto">
          <PropertiesPanel />
        </div>
      </div>

      {/* Timeline with resize handle */}
      <div className="border-t border-boundary relative mt-auto" style={{ height: `${timelineHeight}px`, flexShrink: 0 }}>
        {/* Resize handle */}
        <div
          className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize z-10 group flex items-center justify-center"
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingRef.current = true;
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
          }}
        >
          {/* Handle grip */}
          <div className="flex items-center gap-1 px-3 py-0.5 rounded-full bg-editor-border/50 group-hover:bg-blue-500/70 transition-all">
            <div className="w-1 h-1 rounded-full bg-editor-muted group-hover:bg-white" />
            <div className="w-1 h-1 rounded-full bg-editor-muted group-hover:bg-white" />
            <div className="w-1 h-1 rounded-full bg-editor-muted group-hover:bg-white" />
          </div>
        </div>
        <Timeline />
      </div>

      {/* Modals */}
      {textEditorOpen && <TextClipEditor />}
      {exportPanelOpen && <ExportPanel />}
      <SnackbarUI />
    </div>
  );
}
