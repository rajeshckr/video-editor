import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { api } from '../utils/api';

export default function ExportPanel() {
  const { project, assets, setExportPanelOpen, setInPoint, setOutPoint, addSnackbar } = useEditorStore();
  const [format, setFormat] = useState('mp4');
  const [resolution, setResolution] = useState('source');
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [error, setError] = useState('');

  const inPoint = project.inPoint;
  const outPoint = project.outPoint;

  const getRenderedFileName = () => {
    const safeTitle = (project.projectName || 'studio_video').trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
    const baseName = safeTitle.length > 0 ? safeTitle : 'studio_video';
    return `${baseName}.${format}`;
  };

  const previewAndUpload = () => {
    if (!downloadUrl) {
      return;
    }

    const absoluteUrl = new URL(downloadUrl, window.location.origin).toString();
    const payload = {
      url: absoluteUrl,
      fileName: getRenderedFileName(),
      mimeType: format === 'webm' ? 'video/webm' : 'video/mp4',
    };

    window.parent.postMessage({ type: 'EDITOR_EXPORT_URL', payload }, '*');
    setExportPanelOpen(false);
    addSnackbar('success', 'Sent render to upload screen');
  };

  const handleExport = async () => {
    setStatus('rendering');
    setProgress(0);
    setError('');

    const res = project.resolution;
    let width = res.width, height = res.height;
    if (resolution === '1080p') { width = 1920; height = 1080; }
    if (resolution === '720p') { width = 1280; height = 720; }

    try {
      // Denormalize: enrich clips with asset fields for the backend
      const enrichedTracks = project.tracks.map(track => ({
        ...track,
        clips: track.clips.map(clip => {
          if (!clip.assetId) return clip;
          const asset = assets.find(a => a.id === clip.assetId);
          if (!asset) return clip;
          return {
            ...clip,
            filePath: asset.filePath,
            thumbnail: asset.thumbnail,
            width: asset.width,
            height: asset.height,
            fps: asset.fps,
          };
        })
      }));

      const resp = await api.post('/api/render', {
        project: { ...project, resolution: { width, height }, tracks: enrichedTracks, assets },
        inPoint,
        outPoint,
        outputFormat: format,
      });

      const { jobId, error: err } = await resp.json().catch((e) => ({ error: e.message || `HTTP error ${resp.status}` }));
      if (!resp.ok || err) { 
        setStatus('error'); 
        setError(err || `HTTP error ${resp.status}`); 
        addSnackbar('error', `Export failed: ${err || resp.status}`);
        return; 
      }

      // Open SSE stream for progress
      const evtSource = new EventSource(`${api.getApiBaseUrl()}/api/render/progress/${jobId}`);
      evtSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        setProgress(data.progress || 0);
        if (data.status === 'done') {
          evtSource.close();
          setStatus('done');
          setDownloadUrl(`${api.getApiBaseUrl()}/api/render/download/${jobId}`);
          addSnackbar('success', 'Render completed successfully');
        }
        if (data.status === 'error') {
          evtSource.close();
          setStatus('error');
          setError(data.error || 'Render failed');
          addSnackbar('error', `Render failed: ${data.error}`);
        }
      };
      evtSource.onerror = () => { 
        evtSource.close(); 
        setStatus('error'); 
        setError('Connection lost'); 
        addSnackbar('error', 'Render connection lost');
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus('error');
      setError(message || 'Network error');
      addSnackbar('error', `Render error: ${message}`);
    }
  };

  const toTC = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${sec.toFixed(2).padStart(5,'0')}`;
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 modal-overlay" onClick={() => setExportPanelOpen(false)}>
      <div className="bg-editor-panel border border-editor-border rounded-xl p-6 w-105 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-editor-text">Export Video</h2>
          <button className="btn btn-ghost p-1" onClick={() => setExportPanelOpen(false)}>✕</button>
        </div>

        {/* In/Out range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-editor-muted mb-1 block">🟢 In Point (s)</label>
            <input className="input text-xs" type="number" step="0.1" value={inPoint.toFixed(2)}
              onChange={e => setInPoint(parseFloat(e.target.value))} />
            <div className="text-[10px] text-editor-muted mt-0.5">{toTC(inPoint)}</div>
          </div>
          <div>
            <label className="text-xs text-editor-muted mb-1 block">🔴 Out Point (s)</label>
            <input className="input text-xs" type="number" step="0.1" value={outPoint.toFixed(2)}
              onChange={e => setOutPoint(parseFloat(e.target.value))} />
            <div className="text-[10px] text-editor-muted mt-0.5">{toTC(outPoint)}</div>
          </div>
        </div>

        <div className="bg-editor-bg rounded-lg p-2 text-xs text-editor-muted">
          Export range: <span className="text-editor-accent font-medium">{(outPoint - inPoint).toFixed(2)}s</span>
        </div>

        {/* Format */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-editor-muted mb-1 block">Format</label>
            <select className="input text-xs" value={format} onChange={e => setFormat(e.target.value)}>
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WEBM (VP8)</option>
              <option value="mov">MOV (H.264)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-editor-muted mb-1 block">Resolution</label>
            <select className="input text-xs" value={resolution} onChange={e => setResolution(e.target.value)}>
              <option value="source">Source ({project.resolution.width}×{project.resolution.height})</option>
              <option value="1080p">1080p (1920×1080)</option>
              <option value="720p">720p (1280×720)</option>
            </select>
          </div>
        </div>

        {/* Progress */}
        {status === 'rendering' && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-editor-muted">
              <span>Rendering…</span><span>{progress}%</span>
            </div>
            <div className="w-full bg-editor-border rounded-full h-2">
              <div className="progress-bar h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="error-message border rounded-lg p-3 text-xs">{error}</div>
        )}

        {status === 'done' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button className="btn btn-primary w-full justify-center text-xs gap-2" onClick={previewAndUpload}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M14 3h7v7" />
                <path d="M10 14L21 3" />
                <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
              </svg>
              <span>Preview and Upload</span>
            </button>
            <a
              href={downloadUrl}
              download={getRenderedFileName()}
              className="btn btn-ghost w-full justify-center text-xs gap-2 border border-editor-border"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              <span>Download {format.toUpperCase()}</span>
            </a>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button className="btn btn-ghost text-xs" onClick={() => setExportPanelOpen(false)}>Cancel</button>
          {status !== 'done' && (
            <button className="btn btn-primary text-xs" onClick={handleExport} disabled={status === 'rendering'}>
              {status === 'rendering' ? 'Rendering...' : 'Export'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
