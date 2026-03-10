import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';

const FONTS = ['Inter', 'Arial', 'Georgia', 'Courier New', 'Impact', 'Trebuchet MS', 'Verdana'];
const ANIMATIONS = ['none', 'fade', 'slide-left', 'slide-right', 'zoom'];

function normalizeHexRgb(value?: string) {
  if (!value) return '#000000';
  const hex = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(1, 7)}`;
  return '#000000';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function PropertiesPanel() {
  const [activeTab, setActiveTab] = useState<'basic' | 'style' | 'position'>('basic');
  const { project, selectedClipId, updateClip, setSelectedClip } = useEditorStore();

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
  const isText = selectedClip.type === 'text';
  const isImage = selectedClip.type === 'image';
  const tr = selectedClip.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
  const anchorX = isText ? (selectedClip.x ?? (project.resolution.width / 2)) : (project.resolution.width / 2);
  const anchorY = isText ? (selectedClip.y ?? (project.resolution.height / 2)) : (project.resolution.height / 2);
  const absoluteX = anchorX + tr.x;
  const absoluteY = anchorY + tr.y;
  const bgColorValue = selectedClip.backgroundColor || '#000000';
  const bgRgb = normalizeHexRgb(bgColorValue);
  const isTransparentBg = bgColorValue === 'transparent';

  if (!isText && !isImage) {
    return (
      <div className="flex flex-col h-full bg-editor-panel p-3">
        <div className="text-xs font-semibold text-editor-muted uppercase tracking-wider mb-3">Properties</div>
        <div className="text-xs text-hint text-center mt-8">Select a text or image clip to edit properties.</div>
      </div>
    );
  }

  const effectiveTab: 'basic' | 'style' | 'position' = isImage
    ? 'position'
    : activeTab;

  return (
    <div className="flex flex-col h-full bg-editor-panel overflow-y-auto">
      <div className="px-3 py-2 border-b border-boundary flex items-center justify-between">
        <span className="text-xs font-semibold text-editor-muted uppercase tracking-wider">Properties</span>
        <button className="btn btn-ghost p-0.5" onClick={() => setSelectedClip(null)} title="Close">✕</button>
      </div>

      <div className="px-3 pt-3">
        <div className={`grid ${isImage ? 'grid-cols-1' : 'grid-cols-3'} gap-1 bg-editor-bg p-1 rounded border border-editor-border text-[11px]`}>
          {!isImage && (
            <>
              <button
                className={`py-1 rounded ${effectiveTab === 'basic' ? 'bg-blue-600 text-white' : 'text-editor-muted hover:bg-editor-border'}`}
                onClick={() => setActiveTab('basic')}
              >
                Basic
              </button>
              <button
                className={`py-1 rounded ${effectiveTab === 'style' ? 'bg-blue-600 text-white' : 'text-editor-muted hover:bg-editor-border'}`}
                onClick={() => setActiveTab('style')}
              >
                Style
              </button>
            </>
          )}
          <button
            className={`py-1 rounded ${effectiveTab === 'position' ? 'bg-blue-600 text-white' : 'text-editor-muted hover:bg-editor-border'}`}
            onClick={() => setActiveTab('position')}
          >
            Position
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3 text-xs">
        {effectiveTab === 'basic' && (
          <>
            {isText ? (
              <>
                <div>
                  <label className="text-xs text-editor-muted mb-1 block">Text</label>
                  <textarea
                    className="input resize-none h-16"
                    value={selectedClip.text || ''}
                    onChange={e => {
                      const lines = e.target.value.split('\n').slice(0, 2);
                      update('text', lines.join('\n'));
                    }}
                  />
                </div>

                <div>
                  <label className="text-xs text-editor-muted mb-1 block">Animation</label>
                  <select
                    className="input"
                    value={selectedClip.animation || 'none'}
                    onChange={e => update('animation', e.target.value)}
                  >
                    {ANIMATIONS.map(animation => <option key={animation}>{animation}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <div className="text-xs text-editor-muted bg-editor-bg border border-editor-border rounded p-3">
                Basic settings are available for text clips. Use Style and Position for image clips.
              </div>
            )}
          </>
        )}

        {effectiveTab === 'style' && (
          <>
            <div>
              <label className="text-xs text-editor-muted mb-1 block">Opacity: {Math.round((selectedClip.opacity ?? 1) * 100)}%</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedClip.opacity ?? 1}
                onChange={e => update('opacity', Number(e.target.value))}
                className="range-slider w-full"
              />
            </div>

            {isText && (
              <>
            <div>
              <label className="text-xs text-editor-muted mb-1 block">Font</label>
              <select
                className="input"
                value={selectedClip.font || 'Inter'}
                onChange={e => update('font', e.target.value)}
              >
                {FONTS.map(font => <option key={font}>{font}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-editor-muted mb-1 block">Font Size</label>
              <input
                className="input"
                type="number"
                min={8}
                max={256}
                value={selectedClip.fontSize || 48}
                onChange={e => update('fontSize', Number(e.target.value))}
              />
            </div>

            <div>
              <label className="text-xs text-editor-muted mb-1 block">Color</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={selectedClip.color || '#ffffff'}
                  onChange={e => update('color', e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                />
                <input
                  className="input flex-1"
                  value={selectedClip.color || '#ffffff'}
                  onChange={e => update('color', e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-editor-muted mb-1 block">Background Color</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[12px] text-editor-muted select-none">
                  <input
                    type="radio"
                    name="text-bg-mode"
                    checked={isTransparentBg}
                    onChange={() => update('backgroundColor', 'transparent')}
                  />
                  <svg className="w-4 h-4" viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="1" y="1" width="14" height="14" rx="2" fill="#f5f5f5" stroke="#999" />
                    <path d="M2 10 L6 10 L6 14 L2 14 Z M6 6 L10 6 L10 10 L6 10 Z M10 2 L14 2 L14 6 L10 6 Z" fill="#c7c7c7" />
                    <path d="M3 13 L13 3" stroke="#777" strokeWidth="1.4" />
                  </svg>
                  <span>Transparent</span>
                </label>

                <label className="flex items-center gap-2 text-[12px] text-editor-muted select-none">
                  <input
                    type="radio"
                    name="text-bg-mode"
                    checked={!isTransparentBg}
                    onChange={() => update('backgroundColor', bgRgb)}
                  />
                  <span>Pick Color</span>
                </label>

                <div className={`flex gap-2 items-center ${isTransparentBg ? 'opacity-50' : ''}`}>
                  <input
                    type="color"
                    value={bgRgb}
                    disabled={isTransparentBg}
                    onChange={e => update('backgroundColor', normalizeHexRgb(e.target.value))}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                  />
                  <input
                    className="input flex-1"
                    value={bgRgb}
                    disabled={isTransparentBg}
                    onChange={e => update('backgroundColor', e.target.value)}
                    placeholder="#RRGGBB"
                  />
                </div>
              </div>
            </div>
              </>
            )}
          </>
        )}

        {effectiveTab === 'position' && (
          <div className="space-y-2">
            <div>
              <label className="text-xs text-editor-muted mb-1 block">Opacity: {Math.round((selectedClip.opacity ?? 1) * 100)}%</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedClip.opacity ?? 1}
                onChange={e => update('opacity', Number(e.target.value))}
                className="range-slider w-full"
              />
            </div>
            <div>
              <label className="text-xs text-editor-muted mb-1 block">Zoom: {tr.scale.toFixed(1)}x</label>
              <input
                className="range-slider w-full"
                type="range"
                min={0.1}
                max={5}
                step={0.1}
                value={tr.scale}
                onChange={e => update('transform', { ...tr, scale: clamp(Number(e.target.value), 0.1, 5) })}
              />
            </div>
            <div>
              <label className="text-xs text-editor-muted mb-1 block">X: {Math.round(absoluteX)}</label>
              <input
                className="range-slider w-full"
                type="range"
                min={0}
                max={project.resolution.width}
                step={1}
                value={clamp(absoluteX, 0, project.resolution.width)}
                onChange={e => {
                  const nextAbsX = clamp(Number(e.target.value), 0, project.resolution.width);
                  update('transform', { ...tr, x: nextAbsX - anchorX });
                }}
              />
            </div>
            <div>
              <label className="text-xs text-editor-muted mb-1 block">Y: {Math.round(absoluteY)}</label>
              <input
                className="range-slider w-full"
                type="range"
                min={0}
                max={project.resolution.height}
                step={1}
                value={clamp(absoluteY, 0, project.resolution.height)}
                onChange={e => {
                  const nextAbsY = clamp(Number(e.target.value), 0, project.resolution.height);
                  update('transform', { ...tr, y: nextAbsY - anchorY });
                }}
              />
            </div>
          </div>
        )}

        <div className="pt-2 border-t border-editor-border text-[11px] text-editor-muted">
          Clip Type: <span className="text-editor-text font-medium">{selectedClip.type}</span>
        </div>
      </div>
    </div>
  );
}
