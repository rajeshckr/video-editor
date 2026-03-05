import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';

const API = 'http://localhost:3001';

export default function ExportPanel() {
  const { project, setExportPanelOpen, setInPoint, setOutPoint, addSnackbar } = useEditorStore();
  const [format, setFormat] = useState('mp4');
  const [resolution, setResolution] = useState('source');
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [error, setError] = useState('');

  const inPoint = project.inPoint;
  const outPoint = project.outPoint;

  const handleExport = async () => {
    setStatus('rendering');
    setProgress(0);
    setError('');

    const res = project.resolution;
    let width = res.width, height = res.height;
    if (resolution === '1080p') { width = 1920; height = 1080; }
    if (resolution === '720p') { width = 1280; height = 720; }

    try {
      const resp = await fetch(`${API}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: { ...project, resolution: { width, height } },
          inPoint,
          outPoint,
          outputFormat: format,
        }),
      });

      const { jobId, error: err } = await resp.json().catch((e) => ({ error: e.message || `HTTP error ${resp.status}` }));
      if (!resp.ok || err) { 
        setStatus('error'); 
        setError(err || `HTTP error ${resp.status}`); 
        addSnackbar('error', `Export failed: ${err || resp.status}`);
        return; 
      }

      // Open SSE stream for progress
      const evtSource = new EventSource(`${API}/api/render/progress/${jobId}`);
      evtSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        setProgress(data.progress || 0);
        if (data.status === 'done') {
          evtSource.close();
          setStatus('done');
          setDownloadUrl(`${API}/api/render/download/${jobId}`);
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
    } catch (e: any) {
      setStatus('error');
      setError(e.message || 'Network error');
      addSnackbar('error', `Render error: ${e.message || e}`);
    }
  };

  const toTC = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${sec.toFixed(2).padStart(5,'0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setExportPanelOpen(false)}>
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 w-[420px] space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Export Video</h2>
          <button className="btn btn-ghost p-1" onClick={() => setExportPanelOpen(false)}>✕</button>
        </div>

        {/* In/Out range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#8b949e] mb-1 block">🟢 In Point (s)</label>
            <input className="input text-xs" type="number" step="0.1" value={inPoint.toFixed(2)}
              onChange={e => setInPoint(parseFloat(e.target.value))} />
            <div className="text-[10px] text-[#8b949e] mt-0.5">{toTC(inPoint)}</div>
          </div>
          <div>
            <label className="text-xs text-[#8b949e] mb-1 block">🔴 Out Point (s)</label>
            <input className="input text-xs" type="number" step="0.1" value={outPoint.toFixed(2)}
              onChange={e => setOutPoint(parseFloat(e.target.value))} />
            <div className="text-[10px] text-[#8b949e] mt-0.5">{toTC(outPoint)}</div>
          </div>
        </div>

        <div className="bg-[#0d1117] rounded-lg p-2 text-xs text-[#8b949e]">
          Export range: <span className="text-blue-400 font-medium">{(outPoint - inPoint).toFixed(2)}s</span>
        </div>

        {/* Format */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#8b949e] mb-1 block">Format</label>
            <select className="input text-xs" value={format} onChange={e => setFormat(e.target.value)}>
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WEBM (VP8)</option>
              <option value="mov">MOV (H.264)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#8b949e] mb-1 block">Resolution</label>
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
            <div className="flex justify-between text-xs text-[#8b949e]">
              <span>Rendering…</span><span>{progress}%</span>
            </div>
            <div className="w-full bg-[#30363d] rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-xs text-red-400">{error}</div>
        )}

        {status === 'done' && (
          <a href={downloadUrl} download className="btn btn-primary w-full justify-center text-xs">
            ⬇ Download {format.toUpperCase()}
          </a>
        )}

        <div className="flex gap-2 justify-end">
          <button className="btn btn-ghost text-xs" onClick={() => setExportPanelOpen(false)}>Cancel</button>
          {status !== 'done' && (
            <button className="btn btn-primary text-xs" onClick={handleExport} disabled={status === 'rendering'}>
              {status === 'rendering' ? '⏳ Rendering…' : '🎬 Export'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
