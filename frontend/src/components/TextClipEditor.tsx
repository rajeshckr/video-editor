import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { Clip } from '../types';

const FONTS = ['Inter', 'Arial', 'Georgia', 'Courier New', 'Impact', 'Trebuchet MS', 'Verdana'];
const ANIMATIONS = ['none', 'fade', 'slide-left', 'slide-right', 'zoom'];

export default function TextClipEditor() {
  const { project, setTextEditorOpen, addClipToTrack, updateClip, selectedClipId } = useEditorStore();

  // Find selected text clip if any
  const selectedClip = selectedClipId
    ? project.tracks.flatMap(t => t.clips).find(c => c.id === selectedClipId && c.type === 'text')
    : undefined;

  const [text, setText] = useState(selectedClip?.text || 'Hello World');
  const [font, setFont] = useState(selectedClip?.font || 'Inter');
  const [fontSize, setFontSize] = useState(selectedClip?.fontSize || 48);
  const [color, setColor] = useState(selectedClip?.color || '#ffffff');
  const [x, setX] = useState(selectedClip?.x ?? 960);
  const [y, setY] = useState(selectedClip?.y ?? 540);
  const [startTime, setStartTime] = useState(selectedClip?.timelinePosition ?? 0);
  const [duration, setDuration] = useState(selectedClip?.timelineDuration ?? 5);
  const [animation, setAnimation] = useState(selectedClip?.animation || 'none');

  const captionTrack = project.tracks.find(t => t.type === 'caption');

  const handleApply = () => {
    if (selectedClip && selectedClipId) {
      // Find the track
      for (const track of project.tracks) {
        const clip = track.clips.find(c => c.id === selectedClipId);
        if (clip) {
          updateClip(track.id, selectedClipId, { text, font, fontSize, color, x, y, timelinePosition: startTime, timelineDuration: duration, animation });
          break;
        }
      }
    } else {
      if (!captionTrack) { alert('Add a Text/Image track first'); return; }
      const clip: Omit<Clip, 'id' | 'trackId' | 'trackNumber'> = {
        type: 'text', filePath: '', originalName: `Text: ${text}`,
        srcStart: 0, srcEnd: duration, timelinePosition: startTime, timelineDuration: duration,
        volume: 1, opacity: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        effects: [], text, font, fontSize, color, x, y, animation,
      };
      addClipToTrack(captionTrack.id, clip);
    }
    setTextEditorOpen(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setTextEditorOpen(false)}>
      <div className="bg-editor-panel border border-editor-border rounded-xl p-6 w-96 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Text Clip</h2>
          <button className="btn btn-ghost p-1" onClick={() => setTextEditorOpen(false)}>✕</button>
        </div>

        {/* Text content */}
        <div>
          <label className="text-xs text-editor-muted mb-1 block">Text</label>
          <textarea className="input resize-none h-16" value={text} onChange={e => setText(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Font */}
          <div>
            <label className="text-xs text-editor-muted mb-1 block">Font</label>
            <select className="input" value={font} onChange={e => setFont(e.target.value)}>
              {FONTS.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          {/* Font Size */}
          <div>
            <label className="text-xs text-editor-muted mb-1 block">Size</label>
            <input className="input" type="number" value={fontSize} min={8} max={256} onChange={e => setFontSize(Number(e.target.value))} />
          </div>
          {/* Color */}
          <div>
            <label className="text-xs text-editor-muted mb-1 block">Color</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent border-0" />
              <input className="input flex-1" value={color} onChange={e => setColor(e.target.value)} />
            </div>
          </div>
          {/* Animation */}
          <div>
            <label className="text-xs text-editor-muted mb-1 block">Animation</label>
            <select className="input" value={animation} onChange={e => setAnimation(e.target.value)}>
              {ANIMATIONS.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
          {/* X Position */}
          <div>
            <label className="text-xs text-editor-muted mb-1 block">X Position</label>
            <input className="input" type="number" value={x} onChange={e => setX(Number(e.target.value))} />
          </div>
          {/* Y Position */}
          <div>
            <label className="text-xs text-editor-muted mb-1 block">Y Position</label>
            <input className="input" type="number" value={y} onChange={e => setY(Number(e.target.value))} />
          </div>
          {/* Start time */}
          <div>
            <label className="text-xs text-editor-muted mb-1 block">Start (s)</label>
            <input className="input" type="number" step="0.1" value={startTime} onChange={e => setStartTime(Number(e.target.value))} />
          </div>
          {/* Duration */}
          <div>
            <label className="text-xs text-editor-muted mb-1 block">Duration (s)</label>
            <input className="input" type="number" step="0.1" value={duration} min="0.1" onChange={e => setDuration(Number(e.target.value))} />
          </div>
        </div>

        {/* Preview */}
        <div className="bg-black rounded-lg h-20 flex items-center justify-center overflow-hidden border border-editor-border">
          <span style={{ fontFamily: font, fontSize: Math.min(fontSize, 40), color }}>{text || 'Preview'}</span>
        </div>

        <div className="flex gap-2 justify-end">
          <button className="btn btn-ghost" onClick={() => setTextEditorOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>
            {selectedClip ? 'Update Clip' : 'Add to Timeline'}
          </button>
        </div>
      </div>
    </div>
  );
}
