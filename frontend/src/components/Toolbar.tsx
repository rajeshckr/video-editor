import { useEditorStore } from '../store/editorStore';

export default function Toolbar() {
  const {
    setPlaybackState, playbackState,
    cursorTime, setCursorTime, setExportPanelOpen, undo, redo,
    addTrack, splitClip, selectedClipId, project: { tracks }, setTextEditorOpen
  } = useEditorStore();

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;
  };

  const handleSplit = () => {
    if (!selectedClipId) return;
    for (const track of tracks) {
      const clip = track.clips.find(c => c.id === selectedClipId);
      if (clip) { splitClip(track.id, clip.id, cursorTime); break; }
    }
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[#161b22] border-b border-[#30363d] shrink-0" style={{minHeight:'48px'}}>
      {/* Logo */}
      <div className="flex items-center gap-2 mr-3 shrink-0">
        <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-sm">C</div>
        <span className="text-white font-semibold text-sm hidden sm:block">CutStudio</span>
      </div>

      <div className="w-px h-6 bg-[#30363d] mx-1" />

      {/* History */}
      <button className="btn btn-ghost p-1.5" onClick={undo} title="Undo (Ctrl+Z)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
      </button>
      <button className="btn btn-ghost p-1.5" onClick={redo} title="Redo (Ctrl+Y)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" /></svg>
      </button>

      <div className="w-px h-6 bg-[#30363d] mx-1" />

      {/* Playback */}
      <button className="btn btn-ghost p-1.5" onClick={() => setCursorTime(Math.max(0, cursorTime - 5))} title="Rewind 5s">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M11.5 12L20 18V6l-8.5 6zm-9 0L11 18V6l-8.5 6z"/></svg>
      </button>
      <button
        className="btn btn-primary p-2 rounded-full"
        onClick={() => setPlaybackState(playbackState === 'playing' ? 'paused' : 'playing')}
        title="Play/Pause (Space)"
      >
        {playbackState === 'playing'
          ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        }
      </button>
      <button className="btn btn-ghost p-1.5" onClick={() => setCursorTime(cursorTime + 5)} title="Forward 5s">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.5 12L4 6v12l8.5-6zm9 0L13 6v12l8.5-6z"/></svg>
      </button>

      <div className="w-px h-6 bg-[#30363d] mx-1" />

      {/* Split */}
      <button className="btn btn-ghost p-1.5" onClick={handleSplit} title="Split Clip at Playhead (S)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16M4 12h16"/></svg>
        <span className="text-xs hidden md:block">Split</span>
      </button>

      <div className="flex-1" />

      {/* Timecode */}
      <div className="bg-black rounded px-2 py-1 font-mono text-green-400 text-xs border border-[#30363d] hidden md:block">
        {formatTime(cursorTime)}
      </div>

      <div className="w-px h-6 bg-[#30363d] mx-1" />

      {/* Export */}
      <button className="btn btn-primary text-xs" onClick={() => setExportPanelOpen(true)} title="Export Video">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        Export
      </button>
    </div>
  );
}
