import { useEditorStore } from '../store/editorStore';

export default function Toolbar() {
  const {
    cursorTime, setExportPanelOpen,
  } = useEditorStore();

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-editor-panel border-b border-boundary shrink-0" style={{minHeight:'48px'}}>
      {/* Logo */}
      <div className="flex items-center gap-2 mr-3 shrink-0">
        <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-sm">C</div>
        <span className="text-white font-semibold text-sm hidden sm:block">CutStudio</span>
      </div>

      <div className="w-px h-6 bg-editor-border mx-1" />

      <div className="flex-1" />

      {/* Timecode */}
      <div className="bg-timecode rounded px-2 py-1 font-mono text-green-400 text-xs border border-editor-border hidden md:block">
        {formatTime(cursorTime)}
      </div>

      <div className="w-px h-6 bg-editor-border mx-1" />

      {/* Export */}
      <button className="btn btn-primary text-xs" onClick={() => setExportPanelOpen(true)} title="Export Video">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        Export
      </button>
    </div>
  );
}
