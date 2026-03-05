import { useEffect, useRef } from 'react';
import Toolbar from './components/Toolbar';
import MediaLibrary from './components/MediaLibrary';
import PreviewPlayer from './components/PreviewPlayer';
import Timeline from './components/Timeline';
import TextClipEditor from './components/TextClipEditor';
import ExportPanel from './components/ExportPanel';
import SnackbarUI from './components/SnackbarUI';
import PropertiesPanel from './components/PropertiesPanel';
import { useEditorStore } from './store/editorStore';

export default function App() {
  const {
    project, exportPanelOpen, textEditorOpen, setPlaybackState, playbackState, addSnackbar
  } = useEditorStore();

  // Ref to keep track of the latest project state for the autosave interval
  const projRef = useRef(project);
  useEffect(() => {
    projRef.current = project;
  }, [project]);

  // Auto-save project every 30 seconds
  const saveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    saveRef.current = setInterval(async () => {
      try {
        const resp = await fetch('http://localhost:3001/api/project/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(projRef.current),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          addSnackbar('error', `Autosave failing: ${data.error || resp.status}`);
        }
      } catch (e: any) { 
        console.error('Autosave failed:', e);
        // Only show message occasionally to avoid spamming if server is fully down
      }
    }, 30000);
    return () => { if (saveRef.current) clearInterval(saveRef.current); };
  }, [addSnackbar]); // addSnackbar is a stable function, so it's safe to include

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
    <div className="flex flex-col h-screen bg-[#0d1117] overflow-hidden select-none">
      {/* Top Toolbar */}
      <Toolbar />

      {/* Middle section: Media Library + Preview + Properties */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        {/* Media Library */}
        <div className="w-64 flex-shrink-0 border-r border-[#30363d] overflow-auto">
          <MediaLibrary />
        </div>

        {/* Preview Player */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex items-center justify-center bg-[#0d1117] overflow-hidden p-2">
            <PreviewPlayer />
          </div>
        </div>

        {/* Properties Panel */}
        <div className="w-56 flex-shrink-0 border-l border-[#30363d] overflow-auto">
          <PropertiesPanel />
        </div>
      </div>

      {/* Timeline */}
      <div className="border-t border-[#30363d]" style={{ height: '280px', flexShrink: 0 }}>
        <Timeline />
      </div>

      {/* Modals */}
      {textEditorOpen && <TextClipEditor />}
      {exportPanelOpen && <ExportPanel />}
      <SnackbarUI />
    </div>
  );
}
