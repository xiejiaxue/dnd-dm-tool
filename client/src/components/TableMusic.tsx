import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connection, useScene } from '../ws';
import { waterdeep, type Track } from '../music/catalog';
import { expectedPosition, readListenerSettings, saveListenerSettings } from '../music/table-music';
import type { TableMusic as SharedMusic } from '../types';
import CampaignIcon from './CampaignIcon';

// Only the site's own recordings can play for the whole table: every member's
// browser can fetch them, unlike local files or third-party players.
const SHARED_TRACKS = waterdeep.filter((track): track is Track & { audio: string } => Boolean(track.audio));
/** A remote change within this many seconds of the local playhead is not worth an audible jump. */
const DRIFT_SECONDS = 1.5;
// Tracks are played from downloaded copies: a streamed static file is not
// always seekable, and a late joiner has to start mid-track. Keep a few.
const downloads = new Map<string, Promise<string>>();
const KEEP_DOWNLOADS = 3;

function download(url: string): Promise<string> {
  const known = downloads.get(url);
  if (known) { downloads.delete(url); downloads.set(url, known); return known; }
  const pending = fetch(url).then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  }).then(blob => URL.createObjectURL(blob));
  pending.catch(() => downloads.delete(url));
  downloads.set(url, pending);
  for (const [oldUrl, oldDownload] of downloads) {
    if (downloads.size <= KEEP_DOWNLOADS) break;
    downloads.delete(oldUrl);
    void oldDownload.then(objectUrl => URL.revokeObjectURL(objectUrl), () => {});
  }
  return pending;
}

/**
 * The DM picks a track for the table; every browser plays it from the same
 * point. Each listener keeps their own volume and can mute it.
 */
export default function TableMusic({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { role, campaign } = useScene();
  const music = campaign?.music;
  const isDm = role === 'dm';
  const audio = useRef<HTMLAudioElement>(null);
  const [listener, setListener] = useState(readListenerSettings);
  const [blocked, setBlocked] = useState(false);
  const [sceneFilter, setSceneFilter] = useState('全部场景');
  // The playable copy of the current track: an object URL, or the file itself if downloading failed.
  const [source, setSource] = useState<{ url: string; src: string } | null>(null);
  useEffect(() => saveListenerSettings(listener), [listener]);
  useEffect(() => {
    const url = music?.url;
    if (!url) return;
    let current = true;
    void download(url).then(src => { if (current) setSource({ url, src }); }, () => { if (current) setSource({ url, src: url }); });
    return () => { current = false; };
  }, [music?.url]);
  const src = music && source?.url === music.url ? source.src : null;

  const sync = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    if (!music || !src) { element.pause(); if (!music) { element.removeAttribute('src'); element.load(); setBlocked(false); } return; }
    if (element.getAttribute('src') !== src) element.src = src;
    element.loop = music.loop;
    const position = expectedPosition(music, Date.now(), element.duration);
    if (position === null) { element.pause(); return; }
    if (element.readyState > 0 && Math.abs(element.currentTime - position) > (music.playing ? DRIFT_SECONDS : 0.25)) element.currentTime = position;
    if (music.playing) void element.play().then(() => setBlocked(false), () => setBlocked(true));
    else element.pause();
  }, [music, src]);
  useEffect(sync, [sync]);
  useEffect(() => {
    if (audio.current) { audio.current.volume = listener.volume; audio.current.muted = listener.muted; }
  }, [listener]);

  const send = (next: Omit<SharedMusic, 'updatedAt'> | null) => connection.sendOps([{ op: 'setMusic', music: next && { ...next, updatedAt: Date.now() } }]);
  const playTrack = (track: Track & { audio: string }) => send({ trackId: track.id, title: track.title, url: track.audio, playing: true, position: 0, loop: music?.loop ?? true });
  const pause = () => music && send({ ...music, playing: false, position: audio.current?.currentTime ?? expectedPosition(music, Date.now(), NaN) ?? 0 });
  const resume = () => music && send({ ...music, playing: true, position: expectedPosition(music, Date.now(), audio.current?.duration ?? NaN) ?? 0 });
  const scenes = useMemo(() => ['全部场景', ...new Set(SHARED_TRACKS.map(track => track.scene))], []);
  const tracks = SHARED_TRACKS.filter(track => sceneFilter === '全部场景' || track.scene === sceneFilter);
  const playing = Boolean(music?.playing);

  return <>
    <audio ref={audio} preload="auto" onLoadedMetadata={sync} onEnded={() => { if (isDm && music && !music.loop) send({ ...music, playing: false, position: 0 }); }} aria-hidden="true" />
    {(isDm || music) && <button className={`btn-quiet ${playing ? 'text-accent' : ''}`} aria-expanded={open} onClick={() => onOpenChange(!open)}
      title={music ? `${playing ? '正在播放' : '已暂停'}：${music.title}` : '给全桌播放配乐'}><CampaignIcon name="music" /><span>配乐</span></button>}
    {blocked && music?.playing && !listener.muted && <button className="table-music-unblock" onClick={() => { void audio.current?.play().then(() => setBlocked(false), () => setBlocked(true)); }}>
      <CampaignIcon name="music" />点击收听 DM 配乐：{music.title}
    </button>}
    {open && <div className="campaign-music-popover" role="dialog" aria-label="全桌配乐">
      <div>
        <div className="flex items-center justify-between"><span className="panel-label">{isDm ? '全桌配乐' : 'DM 配乐'}</span><button aria-label="关闭" onClick={() => onOpenChange(false)}><CampaignIcon name="close" /></button></div>
        <div className="table-music-now">
          <strong>{music?.title ?? '未播放'}</strong>
          <small>{music ? (!src ? '正在载入曲目…' : playing ? '所有人同步播放中' : '已暂停') : isDm ? '选一首曲目，玩家会同步听到' : ''}</small>
        </div>
        {isDm && music && <div className="table-music-controls">
          <button className="btn-xs" onClick={playing ? pause : resume}>{playing ? '暂停' : '继续'}</button>
          <button className="btn-xs" onClick={() => send(null)}>停止</button>
          <label><input type="checkbox" checked={music.loop} onChange={event => send({ ...music, loop: event.target.checked, position: audio.current?.currentTime ?? music.position })} />循环</label>
        </div>}
        <div className="table-music-controls">
          <label className="table-music-volume">我的音量<input type="range" min={0} max={1} step={0.01} value={listener.volume} aria-label="我的配乐音量" onChange={event => setListener(current => ({ ...current, volume: Number(event.target.value) }))} /></label>
          <label><input type="checkbox" checked={listener.muted} onChange={event => setListener(current => ({ ...current, muted: event.target.checked }))} />静音</label>
        </div>
        {isDm && <>
          <select className="field-sm" aria-label="按场景筛选配乐" value={sceneFilter} onChange={event => setSceneFilter(event.target.value)}>{scenes.map(scene => <option key={scene}>{scene}</option>)}</select>
          <ul className="table-music-tracks">
            {tracks.map(track => <li key={track.id}>
              <button className={music?.trackId === track.id ? 'is-active' : ''} onClick={() => playTrack(track)}>
                <span>{track.title}<small>{track.scene} · {track.note}</small></span>
                <em>{music?.trackId === track.id ? (playing ? '播放中' : '已暂停') : '全桌播放'}</em>
              </button>
            </li>)}
          </ul>
          <p className="text-[11px] text-muted">只同步本站配乐。自己导入的音频请在「配乐」页本机播放。</p>
        </>}
      </div>
    </div>}
  </>;
}
