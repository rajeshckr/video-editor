import { useRef, useCallback, useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import Logger from '../utils/logger';
import type { Clip } from '../types';
import { api } from '../utils/api';

const logger = Logger.getInstance('Timeline');

const TRACK_LABEL_W = 240;
const TRACK_H = 52;
const RULER_H = 28;

export default function Timeline() {
  const {
    project, cursorTime, setCursorTime, zoom, setZoom,
    setInPoint, setOutPoint, selectedClipId, setSelectedClip,
    updateClip, removeClip, addClipToTrack, addSnackbar, extractAudioFromVideo, addTrack
  } = useEditorStore();

  const [isCaptioning, setIsCaptioning] = useState<Record<string, boolean>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ type: 'playhead' | 'inpoint' | 'outpoint' | 'clip' | 'clipresize'; clipId?: string; trackId?: string; edge?: 'left' | 'right'; startX: number; startTime: number; startDuration?: number; startSrc?: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, clip: Clip, trackId: string } | null>(null);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);

  const timeToX = (t: number) => t * zoom;
  const xToTime = (x: number) => Math.max(0, x / zoom);

  const totalWidth = Math.max(project.duration * zoom + 200, 800);

  // ── Ruler click ────────────────────────────────────────────────────────────
  const onRulerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && (e.target.closest('.playhead-handle') || e.target.closest('.marker-handle'))) return;
    const rect = scrollRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - TRACK_LABEL_W + scrollRef.current!.scrollLeft;
    setCursorTime(xToTime(x));
  }, [zoom, setCursorTime]);

  // ── Global mouse events for dragging ──────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const rect = scrollRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left - TRACK_LABEL_W + (scrollRef.current?.scrollLeft || 0);
      const t = Math.max(0, x / zoom);
      const d = dragging.current;

      if (d.type === 'playhead') { setCursorTime(t); return; }
      if (d.type === 'inpoint') { setInPoint(Math.min(t, project.outPoint - 0.1)); return; }
      if (d.type === 'outpoint') { setOutPoint(Math.max(t, project.inPoint + 0.1)); return; }

      if (d.type === 'clip' && d.clipId && d.trackId) {
        const dx = e.clientX - d.startX;
        const newTime = Math.max(0, d.startTime + dx / zoom);
        updateClip(d.trackId, d.clipId, { timelinePosition: newTime });
        dragging.current.startX = e.clientX;
        dragging.current.startTime = newTime;
        return;
      }

      if (d.type === 'clipresize' && d.clipId && d.trackId) {
        const dx = e.clientX - d.startX;
        const dt = dx / zoom;
        if (d.edge === 'right') {
          const newDur = Math.max(0.5, (d.startDuration || 1) + dt);
          updateClip(d.trackId, d.clipId, { timelineDuration: newDur, srcEnd: (d.startSrc || 0) + dt });
        } else {
          const clipPos = (d as any).clipPos as number;
          const newPos = clipPos + dt;
          const newDur = Math.max(0.5, (d.startDuration || 1) - dt);
          if (newPos >= 0 && newDur >= 0.5) {
            updateClip(d.trackId, d.clipId, { timelinePosition: newPos, timelineDuration: newDur, srcStart: (d.startSrc || 0) + dt });
          }
        }
        return;
      }
    };

    const onUp = () => { dragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [zoom, project, setCursorTime, setInPoint, setOutPoint, updateClip]);

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 0.87)); }
  };

  const handleZoomToFit = useCallback(() => {
    const clips = project.tracks.flatMap(t => t.clips || []);
    const maxClipEnd = clips.reduce((max, clip) => Math.max(max, clip.timelinePosition + clip.timelineDuration), 0);
    const fitEnd = Math.max(project.outPoint || 0, maxClipEnd);
    const spanSeconds = Math.max(0.1, fitEnd);
    const viewportWidth = scrollRef.current?.clientWidth || 1000;
    const timelineViewport = Math.max(120, viewportWidth - TRACK_LABEL_W);
    // Place farthest end (max clip end or outPoint) at 90% of visible timeline width.
    const targetEndPx = timelineViewport * 0.9;
    const fitZoom = targetEndPx / spanSeconds;
    const clamped = Math.max(2, Math.min(300, fitZoom));

    setZoom(clamped);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [project.outPoint, project.tracks, setZoom]);

  // ── Timeline drop ─────────────────────────────────────────────────────────
  const onTrackDrop = (e: React.DragEvent, trackId: string, trackType: string) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const { asset } = JSON.parse(raw);
    if (!asset) return;

    if (asset.type === 'video' && trackType !== 'video') { addSnackbar('error', 'Video clips must go on Video tracks.'); return; }
    if (asset.type === 'audio' && trackType !== 'audio') { addSnackbar('error', 'Audio clips must go on Audio tracks.'); return; }
    if ((asset.type === 'image' || asset.type === 'text') && trackType !== 'overlay') { addSnackbar('error', 'Images and Text must go on Overlay tracks.'); return; }
    const rect = scrollRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - TRACK_LABEL_W + scrollRef.current!.scrollLeft;
    const pos = Math.max(0, x / zoom);
    const clip: Omit<Clip, 'id' | 'trackId' | 'trackNumber'> = {
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
    addClipToTrack(trackId, clip);
  };

  // ── Tick marks ────────────────────────────────────────────────────────────
  const renderTicks = () => {
    const ticks = [];
    const step = zoom > 80 ? 5 : zoom > 40 ? 10 : 30;
    for (let t = 0; t <= project.duration + step; t += step) {
      const x = timeToX(t);
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      ticks.push(
        <g key={t}>
          <line x1={x} y1={0} x2={x} y2={RULER_H} stroke="#30363d" strokeWidth={1} />
          <text x={x + 3} y={RULER_H - 6} fill="#8b949e" fontSize={9} fontFamily="Inter, monospace">
            {`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
          </text>
        </g>
      );
    }
    return ticks;
  };

  const clipColor = (type: string) => {
    if (type === 'video') return { bg: '#3b1f7a', border: '#7c3aed', text: '#c4b5fd' };
    if (type === 'audio') return { bg: '#0c4a6e', border: '#0891b2', text: '#7dd3fc' };
    if (type === 'image') return { bg: '#7c2d12', border: '#ea580c', text: '#fdba74' };
    return { bg: '#78350f', border: '#d97706', text: '#fde68a' }; // text
  };

  // ── Auto-Captioning ────────────────────────────────────────────────────────
  const handleAutoCaption = async (clip: Clip) => {
    logger.action('Request auto caption', 'PENDING', { clipName: clip.originalName, filePath: clip.filePath });
    setIsCaptioning(prev => ({ ...prev, [clip.id]: true }));
    addSnackbar('info', `Running Whisper AI to generate captions... (This might take a minute)`);
    setContextMenu(null);

    try {
      logger.info('Sending caption request to backend', { filePath: clip.filePath });
      const resp = await api.post('/api/caption', { filePath: clip.filePath });

      if (!resp.ok) {
        const err = await resp.json().catch(()=>({}));
        const errorMsg = err.error || `HTTP ${resp.status}`;
        logger.error(`Caption request failed with status ${resp.status}`, new Error(errorMsg));
        throw new Error(errorMsg);
      }

      const { captions } = await resp.json();
      logger.info(`Received ${captions?.length || 0} captions from backend`);
      
      if (!captions || captions.length === 0) {
        const errMsg = "No speech detected or parsing failed.";
        logger.error('Caption generation returned empty result', new Error(errMsg));
        throw new Error(errMsg);
      }

      logger.info(`Processing ${captions.length} captions for insertion`);

      // Ensure we have an overlay track for the captions
      let overlayTrack = project.tracks.find(t => t.type === 'overlay' && t.name === 'Captions');
      if (!overlayTrack) {
        logger.info('Creating new Captions overlay track');
        addTrack('overlay');
        const newTrack = useEditorStore.getState().project.tracks.find(t => t.type === 'overlay' && t.name.includes('Overlay')); // Get the newly created one
        if (newTrack) {
          // Use the store method to safely update track name
          useEditorStore.getState().updateTrack(newTrack.id, { name: 'Captions' });
          overlayTrack = useEditorStore.getState().project.tracks.find(t => t.id === newTrack.id);
          logger.info('Captions track created and named');
        } else {
           overlayTrack = project.tracks.find(t => t.type === 'overlay');
        }
      }

      if (!overlayTrack) {
        const errMsg = "Could not find or create an overlay track";
        logger.error(errMsg, new Error(errMsg));
        throw new Error(errMsg);
      }

      // Insert all generated captions as editable text clips
      captions.forEach((cap: any, index: number) => {
        if (!cap.text || cap.text.trim() === '') {
          logger.debug(`Skipping empty caption at index ${index}`);
          return;
        }
        const duration = cap.end - cap.start;
        if (duration <= 0) {
          logger.debug(`Skipping caption with invalid duration at index ${index}: ${duration}`);
          return;
        }

        const newClip: Omit<Clip, 'id' | 'trackId' | 'trackNumber'> = {
           type: 'text',
           filePath: '',
           originalName: `Caption ${index+1}`,
           srcStart: 0,
           srcEnd: duration,
           timelinePosition: clip.timelinePosition + cap.start, // Offset by parent clip start
           timelineDuration: duration,
           volume: 1,
           opacity: 1,
           transform: { x: 0, y: 0, scale: 1, rotation: 0 },
           effects: [],
           text: cap.text.trim(),
           font: 'Inter',
           fontSize: 64,
           color: '#ffffff',
           y: project.resolution.height * 0.85, // Position near bottom
           animation: 'none'
        };
        
        addClipToTrack(overlayTrack.id, newClip);
      });

      logger.action('Auto caption', 'SUCCESS', { clipName: clip.originalName, captionCount: captions.length });
      addSnackbar('success', `Generated ${captions.length} captions successfully!`);

    } catch (err: any) {
      logger.error(`Caption generation failed`, err);
      addSnackbar('error', `Captions failed: ${err.message}`);
    } finally {
      setIsCaptioning(prev => ({ ...prev, [clip.id]: false }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] overflow-hidden">
      {/* Zoom controls */}
      {/* eslint-disable-next-line tailwindcss/classnames-order */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-[#30363d] shrink-0">
        <span className="text-[10px] text-[#8b949e]">Zoom</span>
        <button className="btn btn-ghost p-0.5 text-xs" onClick={() => setZoom(zoom * 0.8)}>−</button>
        <input type="range" min={2} max={300} value={zoom} onChange={e => setZoom(Number(e.target.value))}
          className="w-24 h-1 accent-blue-500" />
        <button className="btn btn-ghost p-0.5 text-xs" onClick={() => setZoom(zoom * 1.25)}>+</button>
        <span className="text-[10px] text-[#8b949e] w-10">{Math.round(zoom)}px/s</span>
        <button className="btn btn-ghost px-1.5 py-0.5 text-[11px] font-mono" onClick={handleZoomToFit} title="Zoom to fit (all clips + out point)">
          {'<->'}
        </button>
      </div>

      {/* Scrollable area */}
      <div ref={scrollRef} className="flex-1 overflow-auto relative" onWheel={onWheel}>
        <div style={{ width: TRACK_LABEL_W + totalWidth, position: 'relative', minHeight: '100%' }}>

          {/* Sticky label column */}
          <div style={{ position: 'sticky', left: 0, zIndex: 20, width: TRACK_LABEL_W, float: 'left', backgroundColor: '#161b22' }}>
            {/* Ruler corner */}
            <div style={{ height: RULER_H, borderBottom: '1px solid #30363d' }} className="flex items-center px-2">
              <span className="text-[10px] text-[#8b949e]">Tracks</span>
            </div>
            {/* Track labels */}
            {[...project.tracks].sort((a, b) => b.trackNumber - a.trackNumber).map(track => (
              <div 
                key={track.id} 
                style={{ height: TRACK_H, borderBottom: '1px solid #30363d' }}
                className={`flex items-center px-1 gap-1 track-${track.type} ${draggedTrackId === track.id ? 'opacity-50' : ''}`}
                draggable
                onDragStart={(e) => {
                  setDraggedTrackId(track.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('track/id', track.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const draggedId = e.dataTransfer.getData('track/id');
                  if (draggedId && draggedId !== track.id) {
                    useEditorStore.getState().reorderTrack(draggedId, track.id);
                  }
                  setDraggedTrackId(null);
                }}
                onDragEnd={() => setDraggedTrackId(null)}
              >
                {/* eslint-disable-next-line tailwindcss/classnames-order */}
                <div className="cursor-grab text-[#8b949e] px-1 opacity-50 hover:opacity-100 shrink-0" title="Drag to reorder track">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16"/></svg>
                </div>
                <span className="text-xs text-[#e6edf3] flex-1 truncate font-medium ml-1 select-none pointer-events-none">{track.name}</span>
                {track.type !== 'audio' && (
                  <button className="btn btn-ghost p-0.5" title="Toggle visibility"
                    onClick={() => useEditorStore.getState().toggleTrackVisible(track.id)}>
                    {track.visible ? '👁' : '🚫'}
                  </button>
                )}
                {(track.type === 'audio' || track.type === 'video') && (
                  <button className="btn btn-ghost p-0.5" title="Mute"
                    onClick={() => useEditorStore.getState().toggleTrackMute(track.id)}>
                    {track.muted ? '🔇' : '🔊'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Content area (scrolls horizontally) */}
          <div style={{ marginLeft: TRACK_LABEL_W, overflow: 'hidden' }}>
            {/* Ruler SVG */}
            <svg
              width={totalWidth} height={RULER_H}
              style={{ display: 'block', cursor: 'pointer', userSelect: 'none', background: '#161b22', borderBottom: '1px solid #30363d' }}
              onMouseDown={onRulerMouseDown}
            >
              {renderTicks()}

              {/* In/Out highlight */}
              <rect
                x={timeToX(project.inPoint)} y={0}
                width={Math.max(0, timeToX(project.outPoint) - timeToX(project.inPoint))}
                height={RULER_H}
                fill="rgba(59,130,246,0.15)"
              />

              {/* In Point marker */}
              <g className="marker-handle" style={{ cursor: 'ew-resize' }}
                onMouseDown={e => { e.stopPropagation(); dragging.current = { type: 'inpoint', startX: e.clientX, startTime: project.inPoint }; }}>
                <line x1={timeToX(project.inPoint)} y1={0} x2={timeToX(project.inPoint)} y2={RULER_H} stroke="#22c55e" strokeWidth={2} />
                <polygon points={`${timeToX(project.inPoint)},0 ${timeToX(project.inPoint)+10},0 ${timeToX(project.inPoint)},12`} fill="#22c55e" />
              </g>

              {/* Out Point marker */}
              <g className="marker-handle" style={{ cursor: 'ew-resize' }}
                onMouseDown={e => { e.stopPropagation(); dragging.current = { type: 'outpoint', startX: e.clientX, startTime: project.outPoint }; }}>
                <line x1={timeToX(project.outPoint)} y1={0} x2={timeToX(project.outPoint)} y2={RULER_H} stroke="#ef4444" strokeWidth={2} />
                <polygon points={`${timeToX(project.outPoint)},0 ${timeToX(project.outPoint)-10},0 ${timeToX(project.outPoint)},12`} fill="#ef4444" />
              </g>

              {/* Playhead */}
              <g className="playhead-handle" style={{ cursor: 'col-resize' }}
                onMouseDown={e => { e.stopPropagation(); dragging.current = { type: 'playhead', startX: e.clientX, startTime: cursorTime }; }}>
                <line x1={timeToX(cursorTime)} y1={0} x2={timeToX(cursorTime)} y2={RULER_H} stroke="#ef4444" strokeWidth={2} />
                <polygon points={`${timeToX(cursorTime)-6},0 ${timeToX(cursorTime)+6},0 ${timeToX(cursorTime)},10`} fill="#ef4444" />
              </g>
            </svg>

            {/* Track rows */}
            {[...project.tracks].sort((a, b) => b.trackNumber - a.trackNumber).map(track => (
              <div
                key={track.id}
                style={{ height: TRACK_H, width: totalWidth, position: 'relative', borderBottom: '1px solid #1c2128', background: '#0d1117' }}
                onDrop={e => onTrackDrop(e, track.id, track.type)}
                onDragOver={e => e.preventDefault()}
              >
                {/* Playhead line */}
                <div style={{ position: 'absolute', left: timeToX(cursorTime), top: 0, bottom: 0, width: 1, background: '#ef4444', zIndex: 5, pointerEvents: 'none' }} />

                {/* Clips */}
                {track.clips.map(clip => {
                  const colors = clipColor(clip.type);
                  const left = timeToX(clip.timelinePosition);
                  const width = Math.max(4, timeToX(clip.timelineDuration));
                  const isSelected = clip.id === selectedClipId;

                  return (
                    <div
                      key={clip.id}
                      style={{
                        position: 'absolute', left, top: 4, height: TRACK_H - 8, width,
                        background: colors.bg, border: `1px solid ${isSelected ? '#fff' : colors.border}`,
                        borderRadius: 4, cursor: 'grab', overflow: 'hidden',
                        boxShadow: isSelected ? `0 0 0 2px ${colors.border}` : undefined,
                        zIndex: isSelected ? 10 : 2,
                        userSelect: 'none',
                      }}
                      onMouseDown={e => {
                        e.stopPropagation();
                        setSelectedClip(clip.id);
                        dragging.current = {
                          type: 'clip', clipId: clip.id, trackId: track.id,
                          startX: e.clientX, startTime: clip.timelinePosition
                        };
                      }}
                      onContextMenu={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({ x: e.clientX, y: e.clientY, clip, trackId: track.id });
                      }}
                    >
                      {/* Left resize handle */}
                      <div className="clip-handle clip-handle-left"
                        onMouseDown={e => { e.stopPropagation(); dragging.current = { type: 'clipresize', clipId: clip.id, trackId: track.id, edge: 'left', startX: e.clientX, startTime: clip.timelinePosition, startDuration: clip.timelineDuration, startSrc: clip.srcStart, ...(({ clipPos: clip.timelinePosition }) as any) }; }} />

                      {/* Clip content */}
                      <div className="px-1.5 py-0.5 h-full flex flex-col justify-center gap-0.5 pointer-events-none">
                        {/* Thumbnail strip for video */}
                        {clip.type === 'video' && clip.thumbnail && (
                          <div className="absolute inset-0 w-full h-full opacity-20 bg-cover bg-center"
                            style={{ backgroundImage: `url(http://localhost:3001${clip.thumbnail})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />
                        )}
                        {/* Waveform bg for audio */}
                        {clip.type === 'audio' && <div className="absolute inset-0 waveform-bg opacity-40" />}

                        <span className="text-[10px] font-medium truncate relative z-10" style={{ color: colors.text }}>
                          {clip.type === 'text' ? `"${clip.text || 'Text'}"` : clip.originalName}
                        </span>
                        <span className="text-[9px] relative z-10" style={{ color: colors.text, opacity: 0.7 }}>
                          {clip.timelineDuration.toFixed(1)}s
                        </span>
                      </div>

                      {/* Right resize handle */}
                      <div className="clip-handle clip-handle-right"
                        onMouseDown={e => { e.stopPropagation(); dragging.current = { type: 'clipresize', clipId: clip.id, trackId: track.id, edge: 'right', startX: e.clientX, startTime: clip.timelinePosition, startDuration: clip.timelineDuration, startSrc: clip.srcEnd }; }} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => {e.preventDefault(); setContextMenu(null)}} />
          <div
            className="fixed z-50 bg-[#1c2128] border border-[#30363d] rounded-lg shadow-xl py-1 w-40 overflow-hidden"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-red-600 hover:text-white transition-colors"
              onClick={() => {
                removeClip(contextMenu.trackId, contextMenu.clip.id);
                setContextMenu(null);
              }}
            >
              Delete Clip
            </button>
            {contextMenu.clip.type === 'video' && (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-blue-600 hover:text-white transition-colors border-t border-[#30363d] mt-1 pt-1"
                onClick={() => {
                  extractAudioFromVideo(contextMenu.trackId, contextMenu.clip.id);
                  setContextMenu(null);
                  addSnackbar('success', 'Audio extracted to new track');
                }}
              >
                Extract Audio
              </button>
            )}
            {contextMenu.clip.type === 'audio' && (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-green-600 hover:text-white transition-colors border-t border-[#30363d] mt-1 pt-1 flex items-center justify-between pointer-events-auto"
                onClick={() => handleAutoCaption(contextMenu.clip)}
                disabled={isCaptioning[contextMenu.clip.id]}
              >
                {isCaptioning[contextMenu.clip.id] ? 'Generating...' : 'Auto-Caption (Whisper)'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
