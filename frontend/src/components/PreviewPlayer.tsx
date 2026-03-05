import { useEffect, useRef, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { Clip } from '../types';

const API = 'http://localhost:3001';

export default function PreviewPlayer() {
  const {
    project, cursorTime, setCursorTime, playbackState, setPlaybackState,
  } = useEditorStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const startWallRef = useRef<number>(0);
  const startCursorRef = useRef<number>(0);

  const W = project.resolution.width;
  const H = project.resolution.height;
  const aspect = W / H;

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

        if (clip.type === 'image' && clip.thumbnail) {
          const img = new Image();
          img.src = `${API}${clip.thumbnail}`;
          ctx.globalAlpha = clip.opacity ?? 1;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          ctx.globalAlpha = 1;
        }

        if (clip.type === 'text') {
          ctx.save();
          ctx.globalAlpha = clip.opacity ?? 1;
          ctx.fillStyle = clip.color || '#ffffff';
          ctx.font = `${clip.fontSize || 48}px "${clip.font || 'Inter'}", sans-serif`;
          ctx.textAlign = 'center';
          const x = clip.x !== undefined ? (clip.x / W) * canvas.width : canvas.width / 2;
          const y = clip.y !== undefined ? (clip.y / H) * canvas.height : canvas.height / 2;
          // Text shadow for readability
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 4;
          ctx.fillText(clip.text || '', x, y);
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
        const src = `${API}/api/upload/file/${clip.filePath.split(/[\\/]/).pop()}`;
        if (!vid.src.includes(clip.filePath.split(/[\\/]/).pop()!)) { vid.src = src; vid.load(); }
        const clipOffset = cursorTime - clip.timelinePosition + clip.srcStart;
        if (Math.abs(vid.currentTime - clipOffset) > 0.1) vid.currentTime = clipOffset;
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
        const src = `${API}/api/upload/file/${aClip.filePath.split(/[\\/]/).pop()}`;
        if (!aRef.src.includes(aClip.filePath.split(/[\\/]/).pop()!)) { aRef.src = src; aRef.load(); }
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
            const src = `${API}/api/upload/file/${clip.filePath.split(/[\\/]/).pop()}`;
            if (!vid.src.includes(clip.filePath.split(/[\\/]/).pop()!)) {
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
            const src = `${API}/api/upload/file/${clip.filePath.split(/[\\/]/).pop()}`;
            if (!aRef.src.includes(clip.filePath.split(/[\\/]/).pop()!)) {
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
    <div className="flex flex-col items-center w-full max-h-full gap-2">
      {/* Video area */}
      <div className="relative bg-black rounded-lg overflow-hidden flex-shrink-0"
        style={{ width: '100%', maxWidth: '640px', aspectRatio: `${aspect}` }}>
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain"
          style={{ zIndex: 1 }}
          playsInline
          muted={false}
        />
        <canvas
          ref={canvasRef}
          width={640}
          height={Math.round(640 / aspect)}
          className="absolute inset-0 w-full h-full"
          style={{ zIndex: 2, pointerEvents: 'none' }}
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
      <div className="flex items-center gap-2">
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
