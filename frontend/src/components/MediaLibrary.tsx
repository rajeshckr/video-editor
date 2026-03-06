import { useCallback, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { AssetMeta, Clip } from '../types';
import { api } from '../utils/api';


const API = 'http://localhost:3001';
const ALLOWED = ['mp4','mov','mkv','webm','mp3','wav','aac','jpg','jpeg','png','webp'];

export default function MediaLibrary() {
  const { assets, addAsset, project, addClipToTrack, addSnackbar } = useEditorStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const uploadFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED.includes(ext)) { addSnackbar('error', `File type .${ext} not supported`); return; }
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.upload('/api/upload', formData);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        addAsset(data.asset as AssetMeta);
        addSnackbar('success', `Added ${file.name}`);
      } else {
        addSnackbar('error', `Upload failed: ${data.error || `HTTP error ${res.status}`}`);
      }
    } catch (e: any) { addSnackbar('error', `Upload error: ${e.message || e}`); }
  };

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files || []).forEach(uploadFile);
    e.target.value = '';
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    Array.from(e.dataTransfer.files).forEach(uploadFile);
  }, []);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  // Drag asset from library onto timeline (native drag)
  const onAssetDragStart = (e: React.DragEvent, asset: AssetMeta) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ assetId: asset.id, asset }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const formatDuration = (s: number) => {
    if (!s) return '--';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2,'0')}`;
  };

  const iconForType = (type: string) => {
    if (type === 'video') return '🎬';
    if (type === 'audio') return '🎵';
    return '🖼️';
  };

  return (
    <div className="flex flex-col h-full bg-[#161b22]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363d]">
        <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Media</span>
        <button className="btn btn-ghost p-1" onClick={() => inputRef.current?.click()} title="Add files">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
          </svg>
        </button>
        <input ref={inputRef} type="file" multiple accept={ALLOWED.map(e => `.${e}`).join(',')} onChange={onFilePick} className="hidden" />
      </div>

      {/* Drop zone */}
      <div
        className="m-2 rounded-lg border-2 border-dashed border-[#30363d] p-4 text-center text-xs text-[#8b949e] hover:border-blue-500 hover:text-blue-400 transition-colors cursor-pointer"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onClick={() => inputRef.current?.click()}
      >
        <div className="text-2xl mb-1">📂</div>
        <div>Drop files here</div>
        <div className="text-[10px] mt-1 text-[#8b949e]">video · audio · image</div>
      </div>

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {assets.length === 0 && (
          <div className="text-center text-[#8b949e] text-xs mt-4">No media yet</div>
        )}
        {assets.map(asset => (
          <div
            key={asset.id}
            draggable
            onDragStart={e => onAssetDragStart(e, asset)}
            className="flex items-center gap-2 p-2 rounded-md hover:bg-[#1c2128] cursor-grab active:cursor-grabbing border border-transparent hover:border-[#30363d] transition-colors group"
          >
            {/* Thumbnail or icon */}
            <div className="w-12 h-8 shrink-0 rounded overflow-hidden bg-[#0d1117] flex items-center justify-center">
              {asset.thumbnail
                ? <img src={`${API}${asset.thumbnail}`} alt="" className="w-full h-full object-cover" />
                : <span className="text-base">{iconForType(asset.type)}</span>
              }
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[#e6edf3] truncate font-medium" title={asset.originalName}>
                {asset.originalName}
              </div>
              <div className="text-[10px] text-[#8b949e]">{formatDuration(asset.duration)}</div>
            </div>
            {/* Quick-add button */}
            <button
              className="btn btn-ghost p-1 opacity-0 group-hover:opacity-100 text-xs"
              title="Add to timeline"
              onClick={() => {
                // Find first compatible track
                const trackType = asset.type === 'audio' ? 'audio' : (asset.type === 'image' ? 'overlay' : 'video');
                const track = project.tracks.find(t => t.type === trackType);
                if (!track) { addSnackbar('error', `No ${trackType} track found. Add one from the toolbar.`); return; }
                // Find first free position
                const pos = track.clips.reduce((max, c) => Math.max(max, c.timelinePosition + c.timelineDuration), 0);
                const clipData: Omit<Clip, 'id' | 'trackId' | 'trackNumber'> = {
                  type: asset.type === 'image' ? 'image' : asset.type,
                  filePath: asset.filePath,
                  originalName: asset.originalName,
                  srcStart: 0,
                  srcEnd: asset.duration,
                  timelinePosition: pos,
                  timelineDuration: asset.duration || 5,
                  volume: 1,
                  opacity: 1,
                  transform: { x: 0, y: 0, scale: 1, rotation: 0 },
                  effects: [],
                  thumbnail: asset.thumbnail,
                  width: asset.width,
                  height: asset.height,
                  fps: asset.fps,
                };
                addClipToTrack(track.id, clipData);
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
