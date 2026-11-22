import { useEffect, useRef, useState } from 'react';
import './launchHome.css';

const backgroundVideo = import.meta.env.VITE_LUM_HOME_VIDEO;
const backgroundPoster = import.meta.env.VITE_LUM_HOME_POSTER;
const playbackKey = 'lum:homeVideoPaused:v1';
function initialPaused() {
  try { const saved = localStorage.getItem(playbackKey); if (saved !== null) return saved === '1'; } catch { /* Storage is optional. */ }
  // The desktop background is an independently controlled video, not a UI effect.
  return import.meta.env.VITE_LUM_DESKTOP !== '1' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function LaunchHome({ onSettings }: { onSettings: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(initialPaused);
  const [playing, setPlaying] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || videoFailed) return;
    let disposed = false;
    const update = () => {
      if (paused || document.hidden) { video.pause(); return; }
      void video.play().catch((error: unknown) => {
        // A hidden page or an effect cleanup can cancel an in-flight play request.
        if (!disposed && error instanceof DOMException && error.name !== 'AbortError') setPaused(true);
      });
    };
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', update);
      video.pause();
    };
  }, [paused, videoFailed]);

  function togglePlayback() {
    const next = videoFailed ? false : playing;
    if (videoFailed) { setVideoFailed(false); videoRef.current?.load(); }
    setPaused(next);
    try { localStorage.setItem(playbackKey, next ? '1' : '0'); } catch { /* Playback still works. */ }
  }

  return <main className="lumLaunchHome">
    <div className="lumLaunchBackdrop" aria-hidden="true" style={backgroundPoster ? { backgroundImage: `url("${backgroundPoster}")` } : undefined}>
      {backgroundVideo && <video ref={videoRef} className={videoFailed ? 'lumLaunchVideoFailed' : undefined}
        src={backgroundVideo} poster={backgroundPoster}
        muted loop playsInline preload="metadata" disablePictureInPicture tabIndex={-1}
        onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onError={() => { setVideoFailed(true); setPlaying(false); }}/>}
    </div>
    <div className="lumLaunchScroll">
    <header className="lumLaunchUtility"><span>Lum · 影纪</span><div className="lumLaunchUtilityActions">
      {backgroundVideo && <button type="button" className="lumLaunchPlayback"
        aria-label={videoFailed ? '重试背景视频' : playing ? '暂停背景视频' : '播放背景视频'}
        title={videoFailed ? '视频暂不可用，点击重新加载' : '背景视频独立于界面动效设置'}
        onClick={togglePlayback}>
        <span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span>
        {videoFailed ? '重试背景' : playing ? '暂停背景' : '播放背景'}
      </button>}
      <a href="/?view=settings" onClick={event=>{event.preventDefault();onSettings();}}>设置 <span aria-hidden="true">↗</span></a>
    </div></header>
    <div className="lumLaunchContent">
      <div className="lumLaunchIdentity">
      <div className="lumLaunchBrand"><img src="/brand/lumLogo.png" alt="Lum 影纪" draggable={false}/></div>
      <h1>Lum · 影纪：让想象先成为画面</h1>
      <p className="lumLaunchEnglish" lang="en">Lum — Trace the light, record the scene</p>
      </div>
      <nav className="lumLaunchEntries" aria-label="创作入口">
        <a href="/?view=writing" className="lumLaunchEntry">
          <span className="lumLaunchIcon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 6h12M7 6v21h18V16M18 19l-5 1 1-5L25 4l4 4-11 11ZM22 7l4 4M11 25h10"/></svg></span>
          <div><h2>写作</h2><p>从一句灵感，到完整故事。</p><small>剧本 · 小说 · 交稿</small></div><span className="lumLaunchArrow" aria-hidden="true">↗</span>
        </a>
        <a href="/?view=canvas" className="lumLaunchEntry">
          <span className="lumLaunchIcon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="5" width="10" height="10" rx="3"/><rect x="19" y="17" width="10" height="10" rx="3"/><path d="M13 10h4a7 7 0 0 1 7 7M19 22h-4a7 7 0 0 1-7-7"/></svg></span>
          <div><h2>无限画布</h2><p>让画面连接，让想象展开。</p><small>图片 · 视频 · 三维预演</small></div><span className="lumLaunchArrow" aria-hidden="true">↗</span>
        </a>
      </nav>
    </div>
    <footer>记录灵感的光，创造自己的影纪。</footer>
    </div>
  </main>;
}
