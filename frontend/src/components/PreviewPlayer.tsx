import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { Clip } from '../types';

const API = 'http://localhost:3001';

export default function PreviewPlayer() {
  const {
    project, cursorTime, setCursorTime, playbackState, setPlaybackState, setOrientation,
  } = useEditorStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const orientationRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const startWallRef = useRef<number>(0);
  const startCursorRef = useRef<number>(0);
  const [canvasViewport, setCanvasViewport] = useState({ width: 640, height: 360 });

  const W = project.resolution.width;
  const H = project.resolution.height;
  const aspect = W / H;

  // Fit preview to available space while preserving project aspect ratio.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      const topControlsHeight = orientationRef.current?.offsetHeight ?? 0;
      const bottomControlsHeight = controlsRef.current?.offsetHeight ?? 0;

      // Container uses p-2 and gap-2, so reserve space for controls + spacing.
      const reservedVerticalSpace = topControlsHeight + bottomControlsHeight + 32;
      const availableWidth = Math.max(0, containerWidth - 16);
      const availableHeight = Math.max(0, containerHeight - reservedVerticalSpace);

      if (availableWidth === 0 || availableHeight === 0) return;

      let nextWidth = availableWidth;
      let nextHeight = nextWidth / aspect;

      if (nextHeight > availableHeight) {
        nextHeight = availableHeight;
        nextWidth = nextHeight * aspect;
      }

      setCanvasViewport({
        width: Math.floor(nextWidth),
        height: Math.floor(nextHeight),
      });
    };

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries.length) return;
      measure();
    });

    resizeObserver.observe(container);
    if (orientationRef.current) resizeObserver.observe(orientationRef.current);
    if (controlsRef.current) resizeObserver.observe(controlsRef.current);

    // Initial sizing on mount and when project orientation/resolution changes.
    measure();

    return () => resizeObserver.disconnect();
  }, [aspect]);

  // Find active video clip at a given time
  const getActiveVideoClip = (t: number, proj = project): Clip | null => {
    let best: Clip | null = null;
    let bestTrack = -1;
    for (const track of proj.tracks) {
      if (!track.visible || track.type === 'audio') continue;
      for (const clip of track.clips) {
        if (clip.type !== 'video') continue;
        if (t >= clip.timelinePosition && t < clip.timelinePosition + clip.timelineDuration) {
          if (track.trackNumber > bestTrack) { best = clip; bestTrack = track.trackNumber; }
        }
      }
    }
    return best;
  };

  // Draw canvas overlays (images, text) for given cursor time
  const drawOverlays = useCallback((t: number, proj = project) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const W = proj.resolution.width;
    const H = proj.resolution.height;

    for (const track of [...proj.tracks].sort((a, b) => a.trackNumber - b.trackNumber)) {
      if (!track.visible) continue;
      for (const clip of track.clips) {
        if (t < clip.timelinePosition || t >= clip.timelinePosition + clip.timelineDuration) continue;

        if (clip.type === 'video') {
          const vid = videoRef.current;
          if (vid && vid.readyState >= 2) {
            // Check if this clip is the currently playing video in the hidden video element
            const src = clip.localUrl || `${API}/api/upload/file/${clip.filePath.split(/[\\/]/).pop()}`;
            if (vid.src.includes(src.split('/').pop()!)) {
              ctx.save();
              ctx.globalAlpha = clip.opacity ?? 1;
              
              const tr = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
              // Calculate natural aspect ratio fitting
              const vw = vid.videoWidth;
              const vh = vid.videoHeight;
              const scaleToFit = Math.min(canvas.width / (vw || 1), canvas.height / (vh || 1));
              const iw = vw * scaleToFit * tr.scale;
              const ih = vh * scaleToFit * tr.scale;
              const cx = canvas.width / 2 + tr.x;
              const cy = canvas.height / 2 + tr.y;

              ctx.translate(cx, cy);
              ctx.rotate(tr.rotation * Math.PI / 180);
              ctx.drawImage(vid, -iw / 2, -ih / 2, iw, ih);
              ctx.restore();
            }
          }
        }

        if (clip.type === 'image') {
          const filename = clip.filePath.split(/[\\/]/).pop();
          if (filename) {
            let img = imageCache.current[filename];
            if (!img) {
              img = new Image();
              img.onload = () => {
                const liveProj = useEditorStore.getState().project;
                const liveTime = useEditorStore.getState().cursorTime;
                drawOverlays(liveTime, liveProj);
              };
              img.src = clip.localUrl || `${API}/api/upload/file/${filename}`;
              imageCache.current[filename] = img;
            }
            if (img.complete && img.naturalHeight !== 0) {
              ctx.save();
              ctx.globalAlpha = clip.opacity ?? 1;
              
              const tr = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
              const scaleToFit = Math.min(canvas.width / (img.naturalWidth || 1), canvas.height / (img.naturalHeight || 1));
              const iw = img.naturalWidth * scaleToFit * tr.scale;
              const ih = img.naturalHeight * scaleToFit * tr.scale;
              const baseX = clip.x !== undefined ? (clip.x / W) * canvas.width : canvas.width / 2;
              const baseY = clip.y !== undefined ? (clip.y / H) * canvas.height : canvas.height / 2;
              const cx = baseX + tr.x;
              const cy = baseY + tr.y;

              ctx.translate(cx, cy);
              ctx.rotate(tr.rotation * Math.PI / 180);
              ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
              ctx.restore();
            }
          }
        }

        if (clip.type === 'text') {
          ctx.save();
          const tr = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
          const clipDuration = Math.max(0.001, clip.timelineDuration || 0);
          const localT = Math.max(0, t - clip.timelinePosition);
          const inDuration = Math.min(0.35, clipDuration / 2);
          const outStart = Math.max(inDuration, clipDuration - inDuration);

          let animAlpha = 1;
          let animOffsetX = 0;
          let animScale = 1;

          if (clip.animation === 'fade' && inDuration > 0) {
            if (localT < inDuration) animAlpha = localT / inDuration;
            else if (localT > outStart) animAlpha = (clipDuration - localT) / inDuration;
          }

          if (clip.animation === 'slide-left' && inDuration > 0) {
            const p = Math.min(1, localT / inDuration);
            animOffsetX = (1 - p) * -80;
          }

          if (clip.animation === 'slide-right' && inDuration > 0) {
            const p = Math.min(1, localT / inDuration);
            animOffsetX = (1 - p) * 80;
          }

          if (clip.animation === 'zoom' && inDuration > 0) {
            const p = Math.min(1, localT / inDuration);
            animScale = 0.7 + (0.3 * p);
          }

          ctx.globalAlpha = (clip.opacity ?? 1) * Math.max(0, Math.min(1, animAlpha));
          ctx.fillStyle = clip.color || '#ffffff';
          const effectiveFontSize = (clip.fontSize || 48) * (tr.scale || 1) * animScale;
          ctx.font = `${Math.max(1, effectiveFontSize)}px "${clip.font || 'Inter'}", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const baseX = clip.x !== undefined ? (clip.x / W) * canvas.width : canvas.width / 2;
          const baseY = clip.y !== undefined ? (clip.y / H) * canvas.height : canvas.height / 2;
          const x = baseX + tr.x + animOffsetX;
          const y = baseY + tr.y;
          // Text shadow for readability
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 4;
          ctx.translate(x, y);
          ctx.rotate((tr.rotation || 0) * Math.PI / 180);

          if (clip.backgroundColor) {
            const metrics = ctx.measureText(clip.text || '');
            const textWidth = metrics.width;
            const textHeight = Math.max(1, effectiveFontSize * 1.2);
            const padX = Math.max(6, effectiveFontSize * 0.2);
            const padY = Math.max(3, effectiveFontSize * 0.12);
            ctx.fillStyle = clip.backgroundColor;
            ctx.fillRect(
              -(textWidth / 2) - padX,
              -(textHeight / 2) - padY,
              textWidth + (padX * 2),
              textHeight + (padY * 2)
            );
            ctx.fillStyle = clip.color || '#ffffff';
          }

          ctx.fillText(clip.text || '', 0, 0);
          ctx.restore();
        }
      }
    }
  }, [project, W, H]);

  // Sync video element to cursor time
  useEffect(() => {
    if (playbackState === 'playing') return;
    const vid = videoRef.current;
    if (vid) {
      const clip = getActiveVideoClip(cursorTime);
      if (clip) {
        const track = project.tracks.find(t => t.id === clip.trackId);
        vid.muted = track?.muted || false;
        vid.volume = clip.volume ?? 1;
        const src = clip.localUrl || `${API}/api/upload/file/${clip.filePath.split(/[\\/]/).pop()}`;
        if (!vid.src.includes(src.split('/').pop()!)) { 
          vid.src = src; 
          vid.load();
          vid.onloadeddata = () => drawOverlays(cursorTime, project);
        }
        const clipOffset = cursorTime - clip.timelinePosition + clip.srcStart;
        if (Math.abs(vid.currentTime - clipOffset) > 0.1) {
          vid.currentTime = clipOffset;
          vid.pause(); // Force preview update
        }
      } else {
        vid.src = '';
      }
    }

    // Sync audio tracks
    for (const track of project.tracks) {
      if (track.type !== 'audio') continue;
      const aRef = audioRefs.current[track.id];
      if (!aRef) continue;
      const aClip = track.clips.find(c => cursorTime >= c.timelinePosition && cursorTime < c.timelinePosition + c.timelineDuration);
      if (aClip && !track.muted && track.visible) {
        const src = aClip.localUrl || `${API}/api/upload/file/${aClip.filePath.split(/[\\/]/).pop()}`;
        if (!aRef.src.includes(aClip.filePath.split(/[\\/]/).pop()!) && (!aClip.localUrl || aRef.src !== aClip.localUrl)) { aRef.src = src; aRef.load(); }
        aRef.volume = aClip.volume ?? 1;
        const clipOffset = cursorTime - aClip.timelinePosition + aClip.srcStart;
        if (Math.abs(aRef.currentTime - clipOffset) > 0.1) aRef.currentTime = clipOffset;
      } else {
        if (aRef.src) { aRef.pause(); aRef.removeAttribute('src'); aRef.load(); }
      }
    }

    drawOverlays(cursorTime);
  }, [cursorTime, playbackState, project]);

  // Playback loop
  useEffect(() => {
    if (playbackState === 'playing') {
      startWallRef.current = performance.now();
      startCursorRef.current = cursorTime;

      const tick = () => {
        const proj = useEditorStore.getState().project;
        const elapsed = (performance.now() - startWallRef.current) / 1000;
        const newTime = startCursorRef.current + elapsed;
        const outPoint = proj.outPoint;

        if (newTime >= outPoint) {
          setCursorTime(proj.inPoint);
          setPlaybackState('paused');
          return;
        }

        setCursorTime(newTime);
        drawOverlays(newTime, proj);

        // Sync video
        const vid = videoRef.current;
        if (vid) {
          const clip = getActiveVideoClip(newTime, proj);
          if (clip) {
            const track = proj.tracks.find(t => t.id === clip.trackId);
            vid.muted = track?.muted || false;
            vid.volume = clip.volume ?? 1;
            const src = clip.localUrl || `${API}/api/upload/file/${clip.filePath.split(/[\\/]/).pop()}`;
            if (!vid.src.includes(clip.filePath.split(/[\\/]/).pop()!) && (!clip.localUrl || vid.src !== clip.localUrl)) {
              vid.src = src; vid.load();
            }
            if (vid.paused) vid.play().catch(() => {});
            const clipOffset = newTime - clip.timelinePosition + clip.srcStart;
            if (Math.abs(vid.currentTime - clipOffset) > 0.25) vid.currentTime = clipOffset;
          } else {
            if (!vid.paused) vid.pause();
          }
        }

        // Sync audio
        for (const track of proj.tracks) {
          if (track.type !== 'audio') continue;
          const aRef = audioRefs.current[track.id];
          if (!aRef) continue;
          
          if (track.muted || !track.visible) {
            if (!aRef.paused) aRef.pause();
            continue;
          }

          const clip = track.clips.find(c => newTime >= c.timelinePosition && newTime < c.timelinePosition + c.timelineDuration);
          if (clip) {
            const src = clip.localUrl || `${API}/api/upload/file/${clip.filePath.split(/[\\/]/).pop()}`;
            if (!aRef.src.includes(clip.filePath.split(/[\\/]/).pop()!) && (!clip.localUrl || aRef.src !== clip.localUrl)) {
              aRef.src = src; aRef.load();
            }
            aRef.volume = clip.volume ?? 1;
            if (aRef.paused) aRef.play().catch(() => {});
            const clipOffset = newTime - clip.timelinePosition + clip.srcStart;
            if (Math.abs(aRef.currentTime - clipOffset) > 0.25) aRef.currentTime = clipOffset;
          } else {
            if (!aRef.paused) aRef.pause();
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafRef.current);
      videoRef.current?.pause();
      Object.values(audioRefs.current).forEach(a => a?.pause());
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [playbackState]);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;
  };

  const frameStep = (dir: number) => {
    setCursorTime(Math.max(0, cursorTime + dir * (1 / (project.fps || 30))));
  };

  return (
    <div ref={containerRef} className="flex flex-col items-center w-full h-full gap-2 overflow-hidden p-2">
      {/* Orientation toggle buttons */}
      <div ref={orientationRef} className="flex items-center gap-2 bg-editor-panel p-2 rounded-lg border border-boundary shrink-0">
        <span className="text-xs text-editor-muted mr-1">Orientation:</span>
        <button
          className={`p-1.5 rounded transition-colors ${
            project.orientation === 'landscape'
              ? 'bg-blue-600 text-white'
              : 'bg-(--editor-bg) text-editor-muted hover:bg-editor-border'
          }`}
          onClick={() => setOrientation('landscape')}
          title="Landscape (16:9)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="2" y="6" width="20" height="12" rx="2" strokeWidth="2"/>
          </svg>
        </button>
        <button
          className={`p-1.5 rounded transition-colors ${
            project.orientation === 'portrait'
              ? 'bg-blue-600 text-white'
              : 'bg-(--editor-bg) text-editor-muted hover:bg-editor-border'
          }`}
          onClick={() => setOrientation('portrait')}
          title="Portrait (9:16)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="2" width="12" height="20" rx="2" strokeWidth="2"/>
          </svg>
        </button>
      </div>
      
      {/* Video area */}
      <div className="relative rounded-lg overflow-hidden shrink-0 shadow-sm border border-canvas"
        style={{ 
          background: 'var(--editor-canvas)',

          width: `${canvasViewport.width}px`, 
          height: `${canvasViewport.height}px`,
          maxWidth: '100%'
        }}>
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain opacity-0 pointer-events-none"
          playsInline
          muted={false}
        />
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="absolute inset-0 w-full h-full object-contain"
          style={{ zIndex: 2 }}
        />
        {/* Timecode overlay */}
        <div className="absolute bottom-2 right-2 bg-black/70 text-green-400 font-mono text-xs px-2 py-0.5 rounded" style={{ zIndex: 3 }}>
          {formatTime(cursorTime)}
        </div>
      </div>

      <div className="hidden">
        {project.tracks.filter(t => t.type === 'audio').map(track => (
          <audio key={track.id} ref={el => { audioRefs.current[track.id] = el; }} />
        ))}
      </div>

      {/* Controls */}
      <div ref={controlsRef} className="flex items-center gap-2 shrink-0">
        <button className="btn btn-ghost p-1.5" onClick={() => frameStep(-1)} title="Step back 1 frame">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm.5 6L20 18V6z"/></svg>
        </button>
        <button className="btn btn-ghost p-1.5" onClick={() => setCursorTime(Math.max(0, cursorTime - 5))} title="Rewind 5s">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M11.5 12L20 18V6zm-9 0L11 18V6z"/></svg>
        </button>
        <button
          className="btn btn-primary rounded-full p-2"
          onClick={() => setPlaybackState(playbackState === 'playing' ? 'paused' : 'playing')}
        >
          {playbackState === 'playing'
            ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          }
        </button>
        <button className="btn btn-ghost p-1.5" onClick={() => setCursorTime(cursorTime + 5)} title="Forward 5s">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6zm3.5 0H19v12h-2.5z"/></svg>
        </button>
        <button className="btn btn-ghost p-1.5" onClick={() => frameStep(1)} title="Step forward 1 frame">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
        </button>
      </div>
    </div>
  );
}
