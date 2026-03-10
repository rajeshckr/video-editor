import { useEffect, useState, useRef } from 'react';
import Logger from './utils/logger';
import Toolbar from './components/Toolbar';
import MediaLibrary from './components/MediaLibrary';
import PreviewPlayer from './components/PreviewPlayer';
import Timeline from './components/Timeline';
import ExportPanel from './components/ExportPanel';
import SnackbarUI from './components/SnackbarUI';
import PropertiesPanel from './components/PropertiesPanel';
import { useEditorStore } from './store/editorStore';

const logger = Logger.getInstance('App');
const TABLET_BREAKPOINT = 1024;
const TABLET_ICON_RAIL_WIDTH = 48;
const VERTICAL_SPLITTER_HITBOX = 12;
const MIN_PREVIEW_WIDTH = 320;
const MIN_MEDIA_PANEL_WIDTH = 180;
const MIN_PROPERTIES_PANEL_WIDTH = 180;
const MIN_EXPLORER_PANEL_WIDTH = 180;
const ZOOM_CONTROLS_HEIGHT = 41;
const RULER_HEIGHT = 28;
const MIN_TRACK_HEIGHT = 40;

type ExplorerTab = 'media' | 'properties';
type VerticalDragTarget = 'media' | 'properties' | 'explorer' | null;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const getMinTimelineHeight = (trackCount: number) =>
  ZOOM_CONTROLS_HEIGHT + RULER_HEIGHT + (trackCount * MIN_TRACK_HEIGHT);

export default function App() {
  const {
    exportPanelOpen, setPlaybackState, playbackState, project
  } = useEditorStore();

  const [timelineHeight, setTimelineHeight] = useState(() => {
    const saved = localStorage.getItem('timelineHeight');
    return saved ? parseInt(saved) : 280;
  });
  const [isTabletLayout, setIsTabletLayout] = useState(() => window.innerWidth <= TABLET_BREAKPOINT);
  const [activeExplorerTab, setActiveExplorerTab] = useState<ExplorerTab>('media');
  const [mediaPanelWidth, setMediaPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('mediaPanelWidth'));
    return Number.isFinite(saved) && saved > 0 ? saved : 256;
  });
  const [propertiesPanelWidth, setPropertiesPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('propertiesPanelWidth'));
    return Number.isFinite(saved) && saved > 0 ? saved : 224;
  });
  const [explorerPanelWidth, setExplorerPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('explorerPanelWidth'));
    return Number.isFinite(saved) && saved > 0 ? saved : 280;
  });
  const isTimelineDraggingRef = useRef(false);
  const activeVerticalDragRef = useRef<VerticalDragTarget>(null);
  const middleSectionRef = useRef<HTMLDivElement>(null);
  const minTimelineHeight = getMinTimelineHeight(project.tracks.length);
  const effectiveTimelineHeight = Math.max(timelineHeight, minTimelineHeight);

  // Log app initialization
  useEffect(() => {
    logger.info('🚀 Video Editor Application Loaded');
  }, []);

  // Save timeline height to localStorage
  useEffect(() => {
    localStorage.setItem('timelineHeight', timelineHeight.toString());
  }, [timelineHeight]);

  useEffect(() => {
    localStorage.setItem('mediaPanelWidth', String(Math.round(mediaPanelWidth)));
  }, [mediaPanelWidth]);

  useEffect(() => {
    localStorage.setItem('propertiesPanelWidth', String(Math.round(propertiesPanelWidth)));
  }, [propertiesPanelWidth]);

  useEffect(() => {
    localStorage.setItem('explorerPanelWidth', String(Math.round(explorerPanelWidth)));
  }, [explorerPanelWidth]);

  // Handle timeline resize drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isTimelineDraggingRef.current) return;
      const newHeight = window.innerHeight - e.clientY;

      setTimelineHeight(Math.max(minTimelineHeight, Math.min(600, newHeight)));
    };

    const handleMouseUp = () => {
      isTimelineDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [minTimelineHeight]);

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

  // Switch to icon-based explorer navigation on tablet widths and below.
  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${TABLET_BREAKPOINT}px)`);
    const handleLayoutChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsTabletLayout(event.matches);
    };

    handleLayoutChange(mediaQuery);

    mediaQuery.addEventListener('change', handleLayoutChange);
    return () => mediaQuery.removeEventListener('change', handleLayoutChange);
  }, []);

  // Handle vertical splitters for side panel resizing.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const dragTarget = activeVerticalDragRef.current;
      const middle = middleSectionRef.current;
      if (!dragTarget || !middle) return;

      const rect = middle.getBoundingClientRect();
      const totalWidth = rect.width;
      if (totalWidth <= 0) return;

      if (dragTarget === 'explorer') {
        const maxExplorerWidth = Math.max(
          MIN_EXPLORER_PANEL_WIDTH,
          totalWidth - TABLET_ICON_RAIL_WIDTH - MIN_PREVIEW_WIDTH - VERTICAL_SPLITTER_HITBOX,
        );
        const desiredWidth = e.clientX - rect.left - TABLET_ICON_RAIL_WIDTH;
        setExplorerPanelWidth(clamp(desiredWidth, MIN_EXPLORER_PANEL_WIDTH, maxExplorerWidth));
        return;
      }

      if (isTabletLayout) return;

      if (dragTarget === 'media') {
        const maxMediaWidth = Math.max(
          MIN_MEDIA_PANEL_WIDTH,
          totalWidth - propertiesPanelWidth - MIN_PREVIEW_WIDTH - (VERTICAL_SPLITTER_HITBOX * 2),
        );
        const desiredWidth = e.clientX - rect.left;
        setMediaPanelWidth(clamp(desiredWidth, MIN_MEDIA_PANEL_WIDTH, maxMediaWidth));
      }

      if (dragTarget === 'properties') {
        const maxPropertiesWidth = Math.max(
          MIN_PROPERTIES_PANEL_WIDTH,
          totalWidth - mediaPanelWidth - MIN_PREVIEW_WIDTH - (VERTICAL_SPLITTER_HITBOX * 2),
        );
        const desiredWidth = rect.right - e.clientX;
        setPropertiesPanelWidth(clamp(desiredWidth, MIN_PROPERTIES_PANEL_WIDTH, maxPropertiesWidth));
      }
    };

    const handleMouseUp = () => {
      if (!activeVerticalDragRef.current) return;
      activeVerticalDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isTabletLayout, mediaPanelWidth, propertiesPanelWidth]);

  const startVerticalDrag = (target: Exclude<VerticalDragTarget, null>, e: React.MouseEvent) => {
    e.preventDefault();
    activeVerticalDragRef.current = target;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const splitterClassName =
    'relative w-3 shrink-0 cursor-col-resize group flex items-center justify-center select-none';

  return (
    <div className="flex flex-col h-screen bg-editor-bg overflow-hidden select-none">
      {/* Top Toolbar */}
      <Toolbar />

      {/* Middle section: explorer panels + preview */}
      <div ref={middleSectionRef} className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        {isTabletLayout ? (
          <>
            {/* Explorer icon rail */}
            <div
              className="shrink-0 border-r border-boundary bg-editor-panel2 flex flex-col items-center py-2 gap-2"
              style={{ width: `${TABLET_ICON_RAIL_WIDTH}px` }}
            >
              <button
                data-testid="explorer-tab-media"
                className={`p-2 rounded transition-colors ${
                  activeExplorerTab === 'media'
                    ? 'bg-blue-600 text-white'
                    : 'text-editor-muted hover:bg-editor-border'
                }`}
                title="Media Explorer"
                onClick={() => setActiveExplorerTab('media')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth="2" />
                  <rect x="14" y="3" width="7" height="7" rx="1" strokeWidth="2" />
                  <rect x="3" y="14" width="7" height="7" rx="1" strokeWidth="2" />
                  <rect x="14" y="14" width="7" height="7" rx="1" strokeWidth="2" />
                </svg>
              </button>
              <button
                data-testid="explorer-tab-properties"
                className={`p-2 rounded transition-colors ${
                  activeExplorerTab === 'properties'
                    ? 'bg-blue-600 text-white'
                    : 'text-editor-muted hover:bg-editor-border'
                }`}
                title="Properties Explorer"
                onClick={() => setActiveExplorerTab('properties')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="9" cy="7" r="2" strokeWidth="2" />
                  <circle cx="15" cy="12" r="2" strokeWidth="2" />
                  <circle cx="11" cy="17" r="2" strokeWidth="2" />
                </svg>
              </button>
            </div>

            {/* Active explorer panel */}
            <div className="shrink-0 border-r border-boundary overflow-auto" style={{ width: `${explorerPanelWidth}px` }}>
              {activeExplorerTab === 'media' ? <MediaLibrary /> : <PropertiesPanel />}
            </div>

            {/* Tablet splitter */}
            <div
              className={splitterClassName}
              title="Resize explorer"
              data-testid="splitter-explorer"
              onMouseDown={(e) => startVerticalDrag('explorer', e)}
            >
              <div className="h-full w-0.5" style={{ backgroundColor: 'var(--editor-border-boundary)' }} />
              <div
                className="absolute z-10 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 px-1 py-2 rounded-full border"
                style={{ backgroundColor: 'var(--editor-panel2)', borderColor: 'var(--editor-border-boundary)' }}
              >
                <div className="w-1 h-1 rounded-full bg-editor-muted" />
                <div className="w-1 h-1 rounded-full bg-editor-muted" />
                <div className="w-1 h-1 rounded-full bg-editor-muted" />
              </div>
            </div>

            {/* Preview Player */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="flex-1 flex items-center justify-center bg-editor-bg overflow-hidden p-2">
                <PreviewPlayer />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Media Library */}
            <div className="shrink-0 border-r border-boundary overflow-auto" style={{ width: `${mediaPanelWidth}px` }}>
              <MediaLibrary />
            </div>

            {/* Left splitter */}
            <div
              className={splitterClassName}
              title="Resize media panel"
              data-testid="splitter-media"
              onMouseDown={(e) => startVerticalDrag('media', e)}
            >
              <div className="h-full w-0.5" style={{ backgroundColor: 'var(--editor-border-boundary)' }} />
              <div
                className="absolute z-10 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 px-1 py-2 rounded-full border"
                style={{ backgroundColor: 'var(--editor-panel2)', borderColor: 'var(--editor-border-boundary)' }}
              >
                <div className="w-1 h-1 rounded-full bg-editor-muted" />
                <div className="w-1 h-1 rounded-full bg-editor-muted" />
                <div className="w-1 h-1 rounded-full bg-editor-muted" />
              </div>
            </div>

            {/* Preview Player */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="flex-1 flex items-center justify-center bg-editor-bg overflow-hidden p-2">
                <PreviewPlayer />
              </div>
            </div>

            {/* Right splitter */}
            <div
              className={splitterClassName}
              title="Resize properties panel"
              data-testid="splitter-properties"
              onMouseDown={(e) => startVerticalDrag('properties', e)}
            >
              <div className="h-full w-0.5" style={{ backgroundColor: 'var(--editor-border-boundary)' }} />
              <div
                className="absolute z-10 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 px-1 py-2 rounded-full border"
                style={{ backgroundColor: 'var(--editor-panel2)', borderColor: 'var(--editor-border-boundary)' }}
              >
                <div className="w-1 h-1 rounded-full bg-editor-muted" />
                <div className="w-1 h-1 rounded-full bg-editor-muted" />
                <div className="w-1 h-1 rounded-full bg-editor-muted" />
              </div>
            </div>

            {/* Properties Panel */}
            <div className="shrink-0 border-l border-boundary overflow-auto" style={{ width: `${propertiesPanelWidth}px` }}>
              <PropertiesPanel />
            </div>
          </>
        )}
      </div>

      {/* Timeline with resize handle */}
      <div className="border-t border-boundary relative mt-auto" style={{ height: `${effectiveTimelineHeight}px`, flexShrink: 0 }}>
        {/* Resize handle */}
        <div
          className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize z-10 group flex items-center justify-center"
          onMouseDown={(e) => {
            e.preventDefault();
            isTimelineDraggingRef.current = true;
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
          }}
        >
          {/* Handle grip */}
          <div
            className="flex items-center gap-1 px-3 py-0.5 rounded-full border transition-all"
            style={{ backgroundColor: 'var(--editor-panel2)', borderColor: 'var(--editor-border-boundary)' }}
          >
            <div className="w-1 h-1 rounded-full bg-editor-muted" />
            <div className="w-1 h-1 rounded-full bg-editor-muted" />
            <div className="w-1 h-1 rounded-full bg-editor-muted" />
          </div>
        </div>
        <Timeline />
      </div>

      {/* Modals */}
      {exportPanelOpen && <ExportPanel />}
      <SnackbarUI />
    </div>
  );
}
