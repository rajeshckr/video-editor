import { useEditorStore } from '../store/editorStore';

export default function PropertiesPanel() {
  const { project, selectedClipId, updateClip, setTextEditorOpen, setSelectedClip } = useEditorStore();

  // Find selected clip and its track
  let selectedClip = null;
  let selectedTrackId = '';
  for (const track of project.tracks) {
    const clip = track.clips.find(c => c.id === selectedClipId);
    if (clip) { selectedClip = clip; selectedTrackId = track.id; break; }
  }

  if (!selectedClip) {
    return (
      <div className="flex flex-col h-full bg-editor-panel p-3">
        <div className="text-xs font-semibold text-editor-muted uppercase tracking-wider mb-3">Properties</div>
        <div className="text-xs text-hint text-center mt-8">Select a clip to edit its properties</div>
      </div>
    );
  }

  const update = (field: string, value: unknown) => updateClip(selectedTrackId, selectedClip!.id, { [field]: value });

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(2);
    return `${m}:${String(Math.floor(parseFloat(s))).padStart(2, '0')}.${String(Math.round((parseFloat(s) % 1) * 100)).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-editor-panel overflow-y-auto">
      <div className="px-3 py-2 border-b border-boundary flex items-center justify-between">
        <span className="text-xs font-semibold text-editor-muted uppercase tracking-wider">Properties</span>
        <button className="btn btn-ghost p-0.5" onClick={() => setSelectedClip(null)} title="Close">✕</button>
      </div>

      <div className="p-3 space-y-4 text-xs">
        {/* Clip info */}
        <div>
          <div className="text-editor-muted mb-1">Clip</div>
          <div className="text-editor-text font-medium truncate">{selectedClip.originalName || selectedClip.text}</div>
          <div className="text-editor-muted mt-0.5">{selectedClip.type} · {selectedClip.timelineDuration.toFixed(2)}s</div>
        </div>

        <hr className="border-editor-border" />

        {/* Timing - Readonly Summary */}
        <div className="space-y-2">
          <div className="text-editor-muted font-medium">Timing</div>
          <div className="bg-editor-bg rounded border border-editor-border p-2 space-y-1.5 font-mono text-[10px]">
            <div className="flex justify-between">
              <span className="text-editor-muted">Position:</span>
              <span className="text-editor-text">{formatTime(selectedClip.timelinePosition)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-editor-muted">Duration:</span>
              <span className="text-editor-text">{formatTime(selectedClip.timelineDuration)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-editor-muted">Src In:</span>
              <span className="text-editor-text">{formatTime(selectedClip.srcStart)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-editor-muted">Src Out:</span>
              <span className="text-editor-text">{formatTime(selectedClip.srcEnd)}</span>
            </div>
          </div>
        </div>

        <hr className="border-editor-border" />

        {/* Volume (audio/video) */}
        {(selectedClip.type === 'video' || selectedClip.type === 'audio') && (
          <div className="space-y-2">
            <div className="text-editor-muted font-medium">Audio</div>
            <label className="flex flex-col gap-0.5">
              <span className="text-editor-muted">Volume: {Math.round((selectedClip.volume || 1) * 100)}%</span>
              <input type="range" min={0} max={1} step={0.01} value={selectedClip.volume || 1}
                onChange={e => update('volume', parseFloat(e.target.value))} className="range-slider" />
            </label>
          </div>
        )}

        {/* Opacity */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-editor-muted font-medium">Visual</div>
            <label className="flex flex-col gap-0.5">
              <span className="text-editor-muted">Opacity: {Math.round((selectedClip.opacity ?? 1) * 100)}%</span>
              <input type="range" min={0} max={1} step={0.01} value={selectedClip.opacity ?? 1}
                onChange={e => update('opacity', parseFloat(e.target.value))} className="range-slider" />
            </label>
          </div>

          {(selectedClip.type === 'image' || selectedClip.type === 'video' || selectedClip.type === 'text') && (
            <div className="space-y-2">
              <div className="text-editor-muted font-medium">Transform</div>
              <label className="flex flex-col gap-0.5">
                <span className="text-editor-muted">Zoom: {(selectedClip.transform?.scale ?? 1).toFixed(1)}x</span>
                <input type="range" min={0.1} max={10} step={0.1} value={selectedClip.transform?.scale ?? 1}
                  onChange={e => update('transform', { ...(selectedClip.transform || {x:0,y:0,rotation:0}), scale: parseFloat(e.target.value) })} className="range-slider" />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-editor-muted">X Position: {Math.round(selectedClip.transform?.x ?? 0)}</span>
                <input type="range" min={-project.resolution.width} max={project.resolution.width} step={1} value={selectedClip.transform?.x ?? 0}
                  onChange={e => update('transform', { ...(selectedClip.transform || {y:0,scale:1,rotation:0}), x: parseFloat(e.target.value) })} className="range-slider" />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-editor-muted">Y Position: {Math.round(selectedClip.transform?.y ?? 0)}</span>
                <input type="range" min={-project.resolution.height} max={project.resolution.height} step={1} value={selectedClip.transform?.y ?? 0}
                  onChange={e => update('transform', { ...(selectedClip.transform || {x:0,scale:1,rotation:0}), y: parseFloat(e.target.value) })} className="range-slider" />
              </label>
            </div>
          )}
        </div>

        {/* Text-clip editor shortcut */}
        {selectedClip.type === 'text' && (
          <>
            <hr className="border-editor-border" />
            <button className="btn btn-primary w-full text-xs" onClick={() => setTextEditorOpen(true)}>
              ✏️ Edit Text
            </button>
          </>
        )}
      </div>
    </div>
  );
}
