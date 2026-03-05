import { useEditorStore } from '../store/editorStore';

const API = 'http://localhost:3001';

export default function Toolbar() {
  const {
    project, updateProjectName, setPlaybackState, playbackState,
    cursorTime, setCursorTime, setExportPanelOpen, undo, redo,
    addTrack, splitClip, selectedClipId, project: { tracks }, addSnackbar, setTextEditorOpen
  } = useEditorStore();

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;
  };

  const handleSave = async () => {
    try {
      const resp = await fetch(`${API}/api/project/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${resp.status}`);
      }
      addSnackbar('success', 'Project saved successfully');
    } catch (e: any) { addSnackbar('error', `Save failed: ${e.message || e}`); }
  };

  const handleLoad = async () => {
    try {
      const res = await fetch(`${API}/api/project/load`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${res.status}`);
      }
      const { project: loaded } = await res.json();
      if (loaded) {
        useEditorStore.getState().loadProject(loaded, loaded.assets || []);
        addSnackbar('success', 'Project loaded successfully');
      }
    } catch (e: any) { addSnackbar('error', `Load failed: ${e.message || e}`); }
  };

  const handleSplit = () => {
    if (!selectedClipId) return;
    for (const track of tracks) {
      const clip = track.clips.find(c => c.id === selectedClipId);
      if (clip) { splitClip(track.id, clip.id, cursorTime); break; }
    }
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex-shrink-0" style={{minHeight:'48px'}}>
      {/* Logo */}
      <div className="flex items-center gap-2 mr-3 flex-shrink-0">
        <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-sm">C</div>
        <span className="text-white font-semibold text-sm hidden sm:block">CutStudio</span>
      </div>

      {/* Project Name */}
      <input
        className="input w-40 text-sm"
        value={project.projectName}
        onChange={e => updateProjectName(e.target.value)}
        title="Project Name"
      />

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

      {/* Add Track */}
      <button className="btn btn-ghost p-1.5 text-xs flex items-center gap-1" onClick={() => addTrack('video')} title="Add Video Track">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      </button>
      <button className="btn btn-ghost p-1.5 text-xs flex items-center gap-1" onClick={() => addTrack('audio')} title="Add Audio Track">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
      </button>

      <div className="w-px h-6 bg-[#30363d] mx-1" />

      {/* Add Elements */}
      <button className="btn btn-ghost p-1.5 text-xs font-semibold" onClick={() => setTextEditorOpen(true)} title="Add Text Overlay">
        + Text
      </button>

      <div className="flex-1" />

      {/* Timecode */}
      <div className="bg-black rounded px-2 py-1 font-mono text-green-400 text-xs border border-[#30363d] hidden md:block">
        {formatTime(cursorTime)}
      </div>

      <div className="w-px h-6 bg-[#30363d] mx-1" />

      {/* Project actions */}
      <button className="btn btn-ghost text-xs" onClick={handleLoad} title="Load Project">Load</button>
      <button className="btn btn-ghost text-xs" onClick={handleSave} title="Save Project">Save</button>
      <button className="btn btn-primary text-xs" onClick={() => setExportPanelOpen(true)} title="Export Video">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        Export
      </button>
    </div>
  );
}
