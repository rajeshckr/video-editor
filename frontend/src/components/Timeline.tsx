import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import Logger from '../utils/logger';
import type { Clip } from '../types';
import { api } from '../utils/api';

const logger = Logger.getInstance('Timeline');

const TRACK_LABEL_W = 240;
const RULER_H = 28;

export default function Timeline() {
  const {
    project, cursorTime, setCursorTime, zoom, setZoom,
    setInPoint, setOutPoint, selectedClipId, setSelectedClip,
    updateClip, removeClip, addClipToTrack, addSnackbar, extractAudioFromVideo, addTrack, assets,
    draggedMediaType, splitClip, moveClip
  } = useEditorStore();

  const [isCaptioning, setIsCaptioning] = useState<Record<string, boolean>>({});
  const [viewportWidth, setViewportWidth] = useState(0);
  const [highlightedTrackId, setHighlightedTrackId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ type: 'playhead' | 'inpoint' | 'outpoint' | 'clip' | 'clipresize'; clipId?: string; trackId?: string; clipType?: string; edge?: 'left' | 'right'; startX: number; startTime: number; startDuration?: number; startSrc?: number; clipPos?: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, clip: Clip, trackId: string } | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const [draggedClipType, setDraggedClipType] = useState<string | null>(null);
  const [clipHoverTrackId, setClipHoverTrackId] = useState<string | null>(null);

  const timeToX = (t: number) => t * zoom;
  const xToTime = useCallback((x: number) => Math.max(0, x / zoom), [zoom]);

  const totalWidth = Math.max(project.duration * zoom + 200, 800);

  // Check if there are assets but no clips
  const hasAssets = assets.length > 0;
  const hasClips = project.tracks.some(t => t.clips.length > 0);

  // Calculate visible time range
  const timelineViewportWidth = Math.max(0, viewportWidth - TRACK_LABEL_W);
  const visibleSeconds = timelineViewportWidth / zoom;
  const formatVisibleTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Track viewport size
  useEffect(() => {
    const updateSize = () => {
      if (scrollRef.current) {
        setViewportWidth(scrollRef.current.clientWidth);
      }
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    if (scrollRef.current) {
      resizeObserver.observe(scrollRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      setContextMenuPos(null);
      return;
    }

    const clampMenuPosition = () => {
      const menuEl = contextMenuRef.current;
      const menuWidth = menuEl?.offsetWidth ?? 160;
      const menuHeight = menuEl?.offsetHeight ?? 120;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const edgePadding = 8;

      const clampedLeft = Math.max(edgePadding, Math.min(contextMenu.x, viewportWidth - menuWidth - edgePadding));
      const clampedTop = Math.max(edgePadding, Math.min(contextMenu.y, viewportHeight - menuHeight - edgePadding));

      setContextMenuPos({ left: clampedLeft, top: clampedTop });
    };

    // Measure once after render so we can clamp based on actual menu height.
    const rafId = window.requestAnimationFrame(clampMenuPosition);
    window.addEventListener('resize', clampMenuPosition);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', clampMenuPosition);
    };
  }, [contextMenu]);

  // ── Ruler click ────────────────────────────────────────────────────────────
  const onRulerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && (e.target.closest('.playhead-handle') || e.target.closest('.marker-handle'))) return;
    const rect = scrollRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - TRACK_LABEL_W + scrollRef.current!.scrollLeft;
    setCursorTime(xToTime(x));
  }, [xToTime, setCursorTime]);

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

        const sourceTrack = project.tracks.find(track => track.id === d.trackId);
        const hoverTarget = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const hoverTrackRow = hoverTarget?.closest('[data-track-id]') as HTMLElement | null;
        const hoverTrackId = hoverTrackRow?.dataset.trackId;
        const hoverTrackType = hoverTrackRow?.dataset.trackType;
        setClipHoverTrackId(hoverTrackId || null);

        const canMoveToHoverTrack = Boolean(
          sourceTrack && hoverTrackId && hoverTrackType && sourceTrack.type === hoverTrackType
        );
        const targetTrackId = canMoveToHoverTrack ? hoverTrackId! : d.trackId;

        if (targetTrackId !== d.trackId) {
          moveClip(d.trackId, targetTrackId, d.clipId, newTime);
          dragging.current.trackId = targetTrackId;
        } else {
          updateClip(d.trackId, d.clipId, { timelinePosition: newTime });
        }

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
          const clipPos = d.clipPos ?? 0;
          const newPos = clipPos + dt;
          const newDur = Math.max(0.5, (d.startDuration || 1) - dt);
          if (newPos >= 0 && newDur >= 0.5) {
            updateClip(d.trackId, d.clipId, { timelinePosition: newPos, timelineDuration: newDur, srcStart: (d.startSrc || 0) + dt });
          }
        }
        return;
      }
    };

    const onUp = () => {
      dragging.current = null;
      setDraggedClipType(null);
      setClipHoverTrackId(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [zoom, project, setCursorTime, setInPoint, setOutPoint, updateClip, moveClip]);

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

  const handleSplit = () => {
    if (!selectedClipId) {
      addSnackbar('info', 'Select a clip first');
      return;
    }
    for (const track of project.tracks) {
      const clip = track.clips.find(c => c.id === selectedClipId);
      if (clip) {
        const relativeTime = cursorTime - clip.timelinePosition;
        if (relativeTime <= 0 || relativeTime >= clip.timelineDuration) {
          addSnackbar('info', 'Position playhead within the clip to split');
          return;
        }
        splitClip(track.id, clip.id, cursorTime);
        break;
      }
    }
  };

  const handleAddTextClip = () => {
    let captionTrack = project.tracks.find(t => t.type === 'caption');
    if (!captionTrack) {
      addTrack('caption');
      captionTrack = useEditorStore.getState().project.tracks.find(t => t.type === 'caption');
    }

    if (!captionTrack) {
      addSnackbar('error', 'Unable to create a Text/Image track.');
      return;
    }

    const existingIds = new Set(captionTrack.clips.map(c => c.id));

    const clip: Omit<Clip, 'id' | 'trackId' | 'trackNumber'> = {
      type: 'text',
      filePath: '',
      originalName: 'Text: New Text',
      srcStart: 0,
      srcEnd: 5,
      timelinePosition: cursorTime,
      timelineDuration: 5,
      volume: 1,
      opacity: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      effects: [],
      text: 'New Text',
      font: 'Inter',
      fontSize: 48,
      color: '#ffffff',
      backgroundColor: '#000000',
      x: project.resolution.width / 2,
      y: project.resolution.height / 2,
      animation: 'none',
    };

    addClipToTrack(captionTrack.id, clip);

    const updatedTrack = useEditorStore.getState().project.tracks.find(t => t.id === captionTrack.id);
    const newClip = updatedTrack?.clips.find(c => !existingIds.has(c.id));
    if (newClip) {
      setSelectedClip(newClip.id);
    }
  };

  // Check if split is possible (clip selected and cursor within its bounds)
  const canSplit = useMemo(() => {
    if (!selectedClipId) return false;
    for (const track of project.tracks) {
      const clip = track.clips.find(c => c.id === selectedClipId);
      if (clip) {
        const relativeTime = cursorTime - clip.timelinePosition;
        return relativeTime > 0 && relativeTime < clip.timelineDuration;
      }
    }
    return false;
  }, [selectedClipId, cursorTime, project.tracks]);

  // ── Check if track can accept media type ──────────────────────────────────
  const canAcceptMediaType = (mediaType: string, trackType: string): boolean => {
    if (mediaType === 'video') return trackType === 'video';
    if (mediaType === 'audio') return trackType === 'audio';
    if (mediaType === 'image' || mediaType === 'text') return trackType === 'caption';
    return false;
  };

  // ── Timeline drop ─────────────────────────────────────────────────────────
  const onTrackDrop = (e: React.DragEvent, trackId: string, trackType: string) => {
    e.preventDefault();
    setHighlightedTrackId(null);
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const { asset } = JSON.parse(raw);
    if (!asset) return;

    if (asset.type === 'video' && trackType !== 'video') { addSnackbar('error', 'Video clips must go on Video tracks.'); return; }
    if (asset.type === 'audio' && trackType !== 'audio') { addSnackbar('error', 'Audio clips must go on Audio tracks.'); return; }
    if ((asset.type === 'image' || asset.type === 'text') && trackType !== 'caption') { addSnackbar('error', 'Images and Text must go on Text/Image tracks.'); return; }
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
          <line x1={x} y1={0} x2={x} y2={RULER_H} stroke="var(--editor-border-timeline)" strokeWidth={1} />
          <text x={x + 3} y={RULER_H - 6} fill="var(--timeline-label)" fontSize={9} fontFamily="Inter, monospace">
            {`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
          </text>
        </g>
      );
    }
    return ticks;
  };

  const clipColor = (type: string) => {
    if (type === 'video') return { bg: 'var(--clip-video)', border: 'var(--clip-video-border)', text: 'var(--clip-text-color)' };
    if (type === 'audio') return { bg: 'var(--clip-audio)', border: 'var(--clip-audio-border)', text: 'var(--clip-text-color)' };
    if (type === 'image') return { bg: 'var(--clip-image)', border: 'var(--clip-image-border)', text: 'var(--clip-text-color)' };
    return { bg: 'var(--clip-text-bg)', border: 'var(--clip-text-border)', text: 'var(--clip-text-color)' }; // text
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

      // Ensure we have a caption track for the captions
      let captionTrack = project.tracks.find(t => t.type === 'caption' && t.name === 'Captions');
      if (!captionTrack) {
        logger.info('Creating new Captions track');
        addTrack('caption');
        const newTrack = useEditorStore.getState().project.tracks.find(t => t.type === 'caption' && t.name.includes('Text/Image')); // Get the newly created one
        if (newTrack) {
          // Use the store method to safely update track name
          useEditorStore.getState().updateTrack(newTrack.id, { name: 'Captions' });
          captionTrack = useEditorStore.getState().project.tracks.find(t => t.id === newTrack.id);
          logger.info('Captions track created and named');
        } else {
           captionTrack = project.tracks.find(t => t.type === 'caption');
        }
      }

      if (!captionTrack) {
        const errMsg = "Could not find or create a caption track";
        logger.error(errMsg, new Error(errMsg));
        throw new Error(errMsg);
      }

      // Insert all generated captions as editable text clips
      captions.forEach((cap: { text?: string; start: number; end: number }, index: number) => {
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
        
        addClipToTrack(captionTrack.id, newClip);
      });

      logger.action('Auto caption', 'SUCCESS', { clipName: clip.originalName, captionCount: captions.length });
      addSnackbar('success', `Generated ${captions.length} captions successfully!`);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Caption generation failed`, err instanceof Error ? err : new Error(message));
      addSnackbar('error', `Captions failed: ${message}`);
    } finally {
      setIsCaptioning(prev => ({ ...prev, [clip.id]: false }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-editor-bg overflow-hidden relative">

      {/* Zoom controls */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-timeline shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-timeline-label">Zoom</span>
          <button className="btn btn-ghost p-0.5 text-xs" onClick={() => setZoom(zoom * 0.8)}>−</button>
          <input type="range" min={2} max={300} value={zoom} onChange={e => setZoom(Number(e.target.value))}
            className="w-24 h-1 accent-blue-500" />
          <button className="btn btn-ghost p-0.5 text-xs" onClick={() => setZoom(zoom * 1.25)}>+</button>
          <span className="text-[10px] text-timeline-label w-14 font-mono" title="Visible time range">
            {formatVisibleTime(visibleSeconds)}
          </span>
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost px-1.5 py-0.5 text-[11px] font-mono" onClick={handleZoomToFit} title="Zoom to fit (all clips + out point)">
              {'<->'}
            </button>
            <button
              className="btn btn-ghost p-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSplit}
              disabled={!canSplit}
              title={canSplit ? "Split Clip at Playhead (S)" : "Select a clip and position playhead to split"}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.242 3 3 0 004.243 4.242z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {/* Scrollable area */}
      <div ref={scrollRef} data-testid="timeline-scroll-area" className="flex-1 overflow-auto relative flex flex-col" onWheel={onWheel}>
        {/* Empty state hint - centered inside track lanes (excluding ruler + labels) */}
        {!hasClips && (
          <div
            className="absolute pointer-events-none z-30 flex items-center justify-center"
            style={{ left: TRACK_LABEL_W, right: 0, top: RULER_H, bottom: 0 }}
          >
            <div className="text-center px-6 py-4 bg-editor-bg rounded-lg border border-editor-border shadow-lg">
              <div className="mb-2">
                <svg className="w-10 h-10 text-hint mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                </svg>
              </div>
              <div className="text-sm text-hint font-medium mb-3">
                {hasAssets
                  ? "Drag and drop media to the appropriate track below"
                  : "Upload media first, then drag and drop to timeline"}
              </div>
              <div className="flex gap-6 justify-center text-xs">
                <div className="flex items-center gap-2 text-editor-text">
                  <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--clip-video)', border: '1px solid var(--clip-video-border)' }}></div>
                  <span>Video</span>
                </div>
                <div className="flex items-center gap-2 text-editor-text">
                  <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--clip-audio)', border: '1px solid var(--clip-audio-border)' }}></div>
                  <span>Audio</span>
                </div>
                <div className="flex items-center gap-2 text-editor-text">
                  <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--clip-image)', border: '1px solid var(--clip-image-border)' }}></div>
                  <span>Text/Caption</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ width: TRACK_LABEL_W + totalWidth, position: 'relative', height: '100%', display: 'flex' }} onDragLeave={() => { setHighlightedTrackId(null); }}>
        
          {/* Sticky label column */}
          <div style={{ position: 'sticky', left: 0, zIndex: 20, width: TRACK_LABEL_W, flex: '0 0 auto', backgroundColor: 'var(--editor-panel)', height: '100%' }}>
            {/* Ruler corner */}
            <div style={{ height: RULER_H, borderBottom: '1px solid var(--editor-border-timeline)' }} className="flex items-center justify-between px-2 gap-1">
              <span className="text-[10px] text-editor-muted font-semibold flex-1">Tracks</span>
              <div className="flex gap-0.5">
                <button 
                  className="btn btn-ghost p-0.5 text-editor-muted hover:text-editor-text" 
                  onClick={() => addTrack('video')} 
                  title="Add Video Track"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </button>
                <button 
                  className="btn btn-ghost p-0.5 text-editor-muted hover:text-editor-text" 
                  onClick={() => addTrack('audio')} 
                  title="Add Audio Track"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                </button>
                <button 
                  className="btn btn-ghost p-0.5 text-editor-muted hover:text-editor-text" 
                  onClick={handleAddTextClip}
                  title="Add Text Clip"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </button>
              </div>
            </div>
            {/* Track labels */}
            <div style={{ height: `calc(100% - ${RULER_H}px)`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              {[...project.tracks].sort((a, b) => b.trackNumber - a.trackNumber).map(track => (
                <div
                  key={track.id}
                  style={{ flex: 1, minHeight: '40px', borderBottom: '1px solid var(--editor-border-timeline)' }}
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
                  <div className="cursor-grab text-editor-muted px-1 opacity-60 hover:opacity-100 shrink-0" title="Drag to reorder track">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16"/></svg>
                  </div>
                  <span className="text-xs text-track-title flex-1 truncate font-medium ml-1 select-none pointer-events-none">{track.name}</span>
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
          </div>

          {/* Content area (scrolls horizontally) */}
          <div style={{ overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}>
            {/* Ruler SVG */}
            <svg
              width={totalWidth} height={RULER_H}
              style={{ display: 'block', cursor: 'pointer', userSelect: 'none', background: 'var(--editor-panel)', borderBottom: '1px solid var(--editor-border-timeline)' }}
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
                <line x1={timeToX(project.inPoint)} y1={0} x2={timeToX(project.inPoint)} y2={RULER_H} stroke="var(--in-point)" strokeWidth={2} />
                <polygon points={`${timeToX(project.inPoint)},0 ${timeToX(project.inPoint)+10},0 ${timeToX(project.inPoint)},12`} fill="var(--in-point)" />
              </g>

              {/* Out Point marker */}
              <g className="marker-handle" style={{ cursor: 'ew-resize' }}
                onMouseDown={e => { e.stopPropagation(); dragging.current = { type: 'outpoint', startX: e.clientX, startTime: project.outPoint }; }}>
                <line x1={timeToX(project.outPoint)} y1={0} x2={timeToX(project.outPoint)} y2={RULER_H} stroke="var(--playhead)" strokeWidth={2} />
                <polygon points={`${timeToX(project.outPoint)},0 ${timeToX(project.outPoint)-10},0 ${timeToX(project.outPoint)},12`} fill="var(--playhead)" />
              </g>

              {/* Playhead */}
              <g className="playhead-handle" style={{ cursor: 'col-resize' }}
                onMouseDown={e => { e.stopPropagation(); dragging.current = { type: 'playhead', startX: e.clientX, startTime: cursorTime }; }}>
                <line x1={timeToX(cursorTime)} y1={0} x2={timeToX(cursorTime)} y2={RULER_H} stroke="var(--playhead)" strokeWidth={2} />
                <polygon points={`${timeToX(cursorTime)-6},0 ${timeToX(cursorTime)+6},0 ${timeToX(cursorTime)},10`} fill="var(--playhead)" />
              </g>
            </svg>

            {/* Track rows */}
            <div style={{ height: `calc(100% - ${RULER_H}px)`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'auto' }}>
              {[...project.tracks].sort((a, b) => b.trackNumber - a.trackNumber).map(track => {
                const baseBg = draggedMediaType && canAcceptMediaType(draggedMediaType, track.type) ? 'var(--editor-track-hover, rgba(59,130,246,0.1))' : 'var(--editor-bg)';
                let bg = highlightedTrackId === track.id ? 'var(--editor-track-active, rgba(59,130,246,0.3))' : baseBg;
                const isClipHover = clipHoverTrackId === track.id;
                const canAcceptDraggedClip = draggedClipType ? draggedClipType === track.type : false;
                if (isClipHover && draggedClipType) {
                  bg = canAcceptDraggedClip ? 'rgba(34,197,94,0.16)' : 'rgba(239,68,68,0.16)';
                }

                return (
                <div
                  key={track.id}
                  data-testid="track-row"
                  data-track-id={track.id}
                  data-track-type={track.type}
                  style={{
                    flex: 1,
                    minHeight: '40px',
                    width: totalWidth,
                    position: 'relative',
                    borderBottom: '1px solid var(--editor-border-timeline)',
                    background: bg,
                    transition: 'background 0.15s, box-shadow 0.15s',
                    boxShadow: isClipHover && draggedClipType
                      ? `inset 0 0 0 1px ${canAcceptDraggedClip ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'}`
                      : undefined,
                    cursor: isClipHover && draggedClipType && !canAcceptDraggedClip ? 'not-allowed' : undefined,
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                  }}
                  onDragLeave={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (
                      e.clientY <= rect.top ||
                      e.clientY >= rect.bottom ||
                      e.clientX <= rect.left ||
                      e.clientX >= rect.right
                    ) {
                      setHighlightedTrackId(prev => (prev === track.id ? null : prev));
                    }
                  }}
                  onDrop={e => onTrackDrop(e, track.id, track.type)}
                  onDragOver={e => {
                    e.preventDefault();
                    const types = Array.from(e.dataTransfer.types);
                    const mediaType = types.find(t => t.startsWith('application/x-media-'))?.replace('application/x-media-', '');

                    if (mediaType && canAcceptMediaType(mediaType, track.type)) {
                      setHighlightedTrackId(track.id);
                    }
                  }}
                >
                  {/* Playhead line */}
                  <div style={{ position: 'absolute', left: timeToX(cursorTime), top: 0, bottom: 0, width: 1, background: 'var(--playhead)', zIndex: 5, pointerEvents: 'none' }} />

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
                          position: 'absolute', left, top: 4, bottom: 4, width,
                          background: colors.bg, border: `2px solid ${isSelected ? '#ffffff' : colors.border}`,
                          borderRadius: 4, cursor: 'grab', overflow: 'hidden',
                          boxShadow: isSelected ? `0 0 0 2px ${colors.border}, 0 0 10px rgba(0,0,0,0.25)` : undefined,
                          opacity: isSelected ? 1 : 0.7,
                          zIndex: isSelected ? 10 : 2,
                          userSelect: 'none',
                        }}
                        onMouseDown={e => {
                          e.stopPropagation();
                          setDraggedClipType(track.type);
                          setSelectedClip(clip.id);
                          dragging.current = {
                            type: 'clip', clipId: clip.id, trackId: track.id,
                            clipType: track.type,
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
                          onMouseDown={e => { e.stopPropagation(); dragging.current = { type: 'clipresize', clipId: clip.id, trackId: track.id, edge: 'left', startX: e.clientX, startTime: clip.timelinePosition, startDuration: clip.timelineDuration, startSrc: clip.srcStart, clipPos: clip.timelinePosition }; }} />

                        {/* Clip content */}
                        <div className="px-1.5 py-0.5 h-full flex flex-col justify-center gap-0.5 pointer-events-none">
                          {/* Thumbnail strip for video */}
                          {clip.type === 'video' && clip.thumbnail && (
                            <div className="absolute inset-0 w-full h-full opacity-50 bg-cover bg-center"
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
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => {e.preventDefault(); setContextMenu(null)}} />
          <div
            ref={contextMenuRef}
            className="fixed z-50 bg-(--editor-panel2) border border-editor-border rounded-lg shadow-xl py-1 w-40 overflow-hidden"
            style={{
              left: contextMenuPos?.left ?? contextMenu.x,
              top: contextMenuPos?.top ?? contextMenu.y,
            }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-editor-text hover:bg-red-600 hover:text-white transition-colors"
              onClick={() => {
                removeClip(contextMenu.trackId, contextMenu.clip.id);
                setContextMenu(null);
              }}
            >
              Delete Clip
            </button>
            {contextMenu.clip.type === 'video' && (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-editor-text hover:bg-blue-600 hover:text-white transition-colors border-t border-editor-border mt-1 pt-1"
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
                className="w-full text-left px-3 py-1.5 text-xs text-editor-text hover:bg-green-600 hover:text-white transition-colors border-t border-editor-border mt-1 pt-1 flex items-center justify-between pointer-events-auto"
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
