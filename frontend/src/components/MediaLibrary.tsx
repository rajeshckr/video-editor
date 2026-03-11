import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useEditorStore } from '../store/editorStore';
import type { AssetMeta, Clip } from '../types';
import { extractLocalMetadata } from '../utils/mediaUtils';
import { useEffect } from 'react';

const API = 'http://localhost:3001';
const ALLOWED = ['mp4','mov','mkv','webm','mp3','wav','aac','jpg','jpeg','png','webp'];

export default function MediaLibrary() {
  const { assets, addAsset, updateAsset, project, addClipToTrack, addSnackbar } = useEditorStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState<Record<string, number>>({}); // assetId -> progress (0-100)

  const doUpload = useCallback((asset: AssetMeta, file: File) => {

    //log using loggedr asset and file summary (without file content) for debugging upload issues
    console.log('[doUpload] Upload triggered for asset', {
      asset: asset,
      file: file
    } );
    

    setUploading(prev => ({ ...prev, [asset.id]: 0 }));
    updateAsset(asset.id, { uploadStatus: 'uploading' });
    
    const formData = new FormData();
    formData.append('file', file);
    
    const xhr = new XMLHttpRequest();
    
    // Track upload progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        setUploading(prev => ({ ...prev, [asset.id]: progress }));
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.success) {
            updateAsset(asset.id, { 
              uploadStatus: 'success',
              filePath: data.asset.filePath,
              thumbnail: asset.thumbnail || data.asset.thumbnail
            });
          } else {
            updateAsset(asset.id, { uploadStatus: 'failed' });
            addSnackbar('error', `Upload failed: ${data.error}`);
          }
        } catch {
          updateAsset(asset.id, { uploadStatus: 'failed' });
          addSnackbar('error', `Upload failed: Invalid response`);
        }
      } else {
        updateAsset(asset.id, { uploadStatus: 'failed' });
        addSnackbar('error', `Upload failed: HTTP ${xhr.status}`);
      }
      // Remove from uploading
      setUploading(prev => {
        const next = { ...prev };
        delete next[asset.id];
        return next;
      });
    });
    
    xhr.addEventListener('error', () => {
      updateAsset(asset.id, { uploadStatus: 'failed' });
      addSnackbar('error', `Upload error: ${file.name}`);
      setUploading(prev => {
        const next = { ...prev };
        delete next[asset.id];
        return next;
      });
    });
    
    xhr.addEventListener('abort', () => {
      updateAsset(asset.id, { uploadStatus: 'failed' });
      addSnackbar('error', `Upload cancelled: ${file.name}`);
      setUploading(prev => {
        const next = { ...prev };
        delete next[asset.id];
        return next;
      });
    });
    
    xhr.open('POST', 'http://localhost:3001/api/upload');
    xhr.send(formData);
  }, [updateAsset, addSnackbar]);

  // Listen for custom event to upload extracted audio assets
  // This ensures extracted audio is uploaded like other assets
  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ asset: AssetMeta, file: File }>;
      if (custom.detail && custom.detail.asset && custom.detail.file) {
        doUpload(custom.detail.asset, custom.detail.file);
      }
    };
    window.addEventListener('media-library-upload', handler);
    return () => window.removeEventListener('media-library-upload', handler);
  }, [doUpload]);

  const uploadFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED.includes(ext)) { addSnackbar('error', `File type .${ext} not supported`); return; }
    
    const assetId = uuidv4();
    const localUrl = URL.createObjectURL(file);
    
    let meta;
    try {
      meta = await extractLocalMetadata(file);
    } catch (err) {
      addSnackbar('error', `Could not read metadata for ${file.name}`);
      return;
    }

    const asset: AssetMeta = {
      id: assetId,
      originalName: file.name,
      filename: file.name,
      filePath: '', // Will be populated when upload succeeds
      localUrl,
      localFile: file,
      size: file.size,
      type: meta.type,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      uploadStatus: 'uploading',
      thumbnail: meta.thumbnailUrl // Optimistic local thumbnail
    };
    
    addAsset(asset);
    doUpload(asset, file);
  }, [addAsset, addSnackbar, doUpload]);

  const retryUpload = (asset: AssetMeta) => {
    if (asset.localFile) {
      doUpload(asset, asset.localFile);
    } else {
      addSnackbar('error', 'Original file is lost. Please remove and add again.');
    }
  };

  const failedAssets = assets.filter(a => a.uploadStatus === 'failed');
  const retryAll = () => {
    failedAssets.forEach(a => retryUpload(a));
  };

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files || []).forEach(file => uploadFile(file));
    e.target.value = '';
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    Array.from(e.dataTransfer.files).forEach(file => uploadFile(file));
  }, [uploadFile]);

  const onDragOver = (e: React.DragEvent) => { 
    e.preventDefault();
    e.stopPropagation();
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  // Drag asset from library onto timeline (native drag)
  const onAssetDragStart = (e: React.DragEvent, asset: AssetMeta) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ assetId: asset.id, asset }));
    e.dataTransfer.setData(`application/x-media-${asset.type}`, ''); // Custom type for sniffing
    e.dataTransfer.effectAllowed = 'copy';
    useEditorStore.getState().setDraggedMediaType(asset.type);
  };

  const onAssetDragEnd = () => {
    useEditorStore.getState().setDraggedMediaType(null);
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
    <div 
      className={`flex flex-col h-full bg-editor-panel transition-colors ${
        isDragging ? 'bg-blue-500/10 border-2 border-blue-500 border-dashed' : ''
      }`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-boundary">
        <span className="text-xs font-semibold text-editor-muted uppercase tracking-wider">Media</span>
        <button className="btn btn-ghost p-1" onClick={() => inputRef.current?.click()} title="Add files">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
          </svg>
        </button>
        <input ref={inputRef} type="file" multiple accept={ALLOWED.map(e => `.${e}`).join(',')} onChange={onFilePick} className="hidden" />
      </div>

      {/* Asset list */}
      {/* Asset list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {assets.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <div className="mb-3">
              <svg className="w-16 h-16 text-hint mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
              </svg>
            </div>
            <div className="text-sm text-hint font-medium mb-2">
              No media added yet
            </div>
            <div className="text-xs text-hint leading-relaxed max-w-50">
              Click the <span className="text-editor-text">+</span> button above or drag and drop files to begin
            </div>
            <div className="text-[10px] text-hint mt-3">
              Supported: MP4, MOV, MKV, WebM, MP3, WAV, JPG, PNG
            </div>
          </div>
        )}
        {assets.map(asset => (
          <div
            key={asset.id}
            draggable
            onDragStart={e => onAssetDragStart(e, asset)}
            onDragEnd={onAssetDragEnd}
            className="flex flex-col gap-1 p-2 rounded-md hover:bg-(--editor-panel2) cursor-grab active:cursor-grabbing border border-transparent hover:border-editor-border transition-colors group"
          >
            <div className="flex items-center gap-2">
              {/* Thumbnail or icon */}
              <div className="w-12 h-8 shrink-0 rounded overflow-hidden bg-editor-bg flex items-center justify-center">
                {asset.thumbnail
                  ? <img src={asset.thumbnail.startsWith('data:') ? asset.thumbnail : `${API}${asset.thumbnail}`} alt="" className="w-full h-full object-cover" />
                  : <span className="text-base">{iconForType(asset.type)}</span>
                }
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-editor-text truncate font-medium" title={asset.originalName}>
                  {asset.originalName}
                </div>
                <div className="text-[10px] text-editor-muted flex items-center gap-1">
                  {formatDuration(asset.duration)}
                  {asset.uploadStatus === 'failed' && (
                    <svg className="w-3 h-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <title>Upload Failed</title>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                  )}
                </div>
              </div>
              {/* Quick-add button */}
              <button
                className="btn btn-ghost p-1 opacity-0 group-hover:opacity-100 text-xs"
                title="Add to timeline"
                onClick={() => {
                  // Find first compatible track
                  const trackType = asset.type === 'audio' ? 'audio' : (asset.type === 'image' ? 'image' : 'video');
                  const track = project.tracks.find(t => t.type === trackType);
                  if (!track) { addSnackbar('error', `No ${trackType} track found. Add one from the toolbar.`); return; }
                  // Find first free position
                  const pos = track.clips.reduce((max, c) => Math.max(max, c.timelinePosition + c.timelineDuration), 0);
                  const clipData: Omit<Clip, 'id' | 'trackId' | 'trackNumber'> = {
                    type: asset.type === 'image' ? 'image' : asset.type,
                    filePath: asset.filePath,
                    localUrl: asset.localUrl,
                    localFile: asset.localFile,
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
            
            {/* Upload Status Row */}
            {asset.uploadStatus === 'uploading' && (
              <div className="flex items-center gap-2 mt-1 px-1">
                <div className="w-full bg-editor-panel rounded h-1.5 overflow-hidden">
                  <div 
                    className="bg-blue-500 h-full transition-all duration-150"
                    style={{ width: `${uploading[asset.id] || 0}%` }}
                  />
                </div>
                <div className="text-[10px] font-mono text-editor-muted whitespace-nowrap">
                  {uploading[asset.id] || 0}%
                </div>
              </div>
            )}
            {asset.uploadStatus === 'failed' && (
              <div className="flex items-center mt-1 px-1">
                <button 
                  onClick={(e) => { e.stopPropagation(); retryUpload(asset); }}
                  className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline cursor-pointer"
                >
                  Retry Upload
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {failedAssets.length > 0 && (
        <div className="px-2 pb-2 shrink-0">
          <button 
            className="w-full btn bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs flex items-center justify-center gap-2 py-2"
            onClick={retryAll}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Retry All Failed Uploads
          </button>
        </div>
      )}
    </div>
  );
}
