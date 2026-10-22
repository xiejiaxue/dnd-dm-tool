import { useEffect, useRef, useState } from 'react';
import { audioUrl, appleMusicAppUrl, appleMusicUrl, youtubeId, filterTracks, waterdeep, type Track } from '../music/catalog';
import { fileStore } from '../music/files';

type Settings = { volume: number; loop: boolean; bindings: Record<string, string>; custom: Track[] };
function read(): Settings {
  const fallback = { volume: 0.45, loop: true, bindings: {}, custom: [] };
  try {
    const data = JSON.parse(localStorage.getItem('dm-music-settings') ?? 'null');
    if (!data) return fallback;
    return { volume: typeof data.volume === 'number' && Number.isFinite(data.volume) ? Math.max(0, Math.min(1, data.volume)) : .45, loop: data.loop !== false, bindings: Object.fromEntries(Object.entries(data.bindings ?? {}).filter(([, v]) => typeof v === 'string' && (v === 'local' || audioUrl(v)))), custom: Array.isArray(data.custom) ? data.custom.filter((t: Track) => typeof t.id === 'string' && typeof t.title === 'string' && t.scene === '自选') : [] } as Settings;
  } catch { return fallback; }
}
export default function MusicBar() {
  const [settings, setSettings] = useState(read);
  const [library, setLibrary] = useState('深水城');
  const [scene, setScene] = useState('全部场景');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Track | null>(null);
  const [appleLink, setAppleLink] = useState('');
  const [source, setSource] = useState('');
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const sequence = useRef(0);
  const objectUrl = useRef('');
  useEffect(() => { try { localStorage.setItem('dm-music-settings', JSON.stringify(settings)); } catch { setError('浏览器无法保存设置。'); } }, [settings]);
  useEffect(() => { if (audio.current) audio.current.volume = settings.volume; }, [settings.volume, source]);
  useEffect(() => {
    if (source && audio.current) void audio.current.play().catch(() => setError('浏览器未自动播放，请点击播放。'));
  }, [source]);
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
  const stop = () => {
    sequence.current++; audio.current?.pause(); setPlaying(false); setSource(''); setSelected(null); setAppleLink('');
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = '';
  };
  const choose = async (track: Track, override?: string) => {
    const ticket = ++sequence.current;
    audio.current?.pause(); setPlaying(false); setSource(''); setSelected(track); setAppleLink(''); setError('');
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = '';
    const binding = override ?? settings.bindings[track.id];
    try {
      if (binding === 'local') {
        const blob = await fileStore(track.id);
        if (ticket !== sequence.current) return;
        if (!blob) throw new Error('本地音频已不存在，请重新导入。');
        objectUrl.current = URL.createObjectURL(blob); setSource(objectUrl.current);
      } else if (binding && appleMusicUrl(binding)) { setAppleLink(binding);  }
      else if (!binding && track.audio) { setSource(track.audio); }
      else if (!binding && track.appleMusic) { setAppleLink(track.appleMusic);  }
      else if (binding && youtubeId(binding)) { setSelected({ ...track, video: youtubeId(binding)! });  }
      else if (binding && audioUrl(binding)) setSource(binding);
      else if (!track.video) {  setError('请为这首曲目导入本地音频，或绑定可直接播放的 HTTPS 音频地址。'); }
    } catch (cause) { if (ticket === sequence.current) setError(cause instanceof Error ? cause.message : '无法读取音频。'); }
  };
  const tracks = library === '深水城' ? waterdeep : settings.custom;
  const scenes = ['全部场景', ...new Set(tracks.map(t => t.scene))];
  const bind = async (file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(file.name)) { setError('请选择音频文件。'); return; }
    const track = selected ?? { id: `custom-${crypto.randomUUID()}`, title: file.name.replace(/\.[^.]+$/, ''), artist: '本地音频', scene: '自选', note: '仅存放于当前浏览器' };
    try {
      await fileStore(track.id, file);
      setSettings(s => ({ ...s, custom: selected ? s.custom : [...s.custom, track], bindings: { ...s.bindings, [track.id]: 'local' } }));
      if (!selected) { setLibrary('自选'); setScene('全部场景'); }
      await choose(track, 'local');
    } catch { setError('保存音频失败，可能是浏览器存储空间不足。'); }
  };
  return <div className="music-tool-page"><header className="tool-heading"><div><span className="eyebrow">05 / MUSIC</span><h1>配乐</h1></div><span className="tool-status">主持人本机播放</span></header><section id="music-panel" className="music-bar" aria-label="主持人配乐">
    <div className="music-controls"><span className="music-now">{selected?.title ?? '选择深水城场景配乐'}<small>{source ? (source.startsWith('/music/') ? '本站音频 · 纯音乐' : '自选音频') : appleLink ? '在 Apple Music 中控制播放' : selected?.video ? '页内播放 · 使用下方播放器控件' : '主持人本机'}</small></span><button disabled={!source} onClick={() => { if (!audio.current) return; if (playing) audio.current.pause(); else void audio.current.play().catch(() => setError('无法播放，请检查音频格式或地址后重试。')); }}>{playing ? '暂停' : '播放'}</button><button disabled={!selected} onClick={stop}>{appleLink ? '取消选曲' : '停止'}</button><label>音量<input aria-label="配乐音量" disabled={!!appleLink || (!!selected?.video && !source)} type="range" min="0" max="1" step="0.01" value={settings.volume} onChange={e => setSettings(s => ({ ...s, volume: Number(e.target.value) }))} /></label><label><input type="checkbox" checked={settings.loop} disabled={!!appleLink || (!!selected?.video && !source)} onChange={e => setSettings(s => ({ ...s, loop: e.target.checked }))} />循环</label></div>
    <section className="music-library" aria-label="配乐库">

      <div className="music-filters"><select aria-label="选择歌单" value={library} onChange={e => { setLibrary(e.target.value); setScene('全部场景'); }}><option>深水城</option><option>自选</option></select><select aria-label="选择场景" value={scene} onChange={e => setScene(e.target.value)}>{scenes.map(s => <option key={s}>{s}</option>)}</select><input aria-label="搜索配乐" placeholder="搜索曲名、人物、用途" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="music-content"><div className="music-tracks">{filterTracks(tracks, scene, query).map(t => <button className={selected?.id === t.id ? 'selected' : ''} key={t.id} onClick={() => void choose(t)}><span>{t.title}<small>{t.artist} · {t.scene}</small></span><small>{t.note}</small><em>{!settings.bindings[t.id] && t.audio ? '站内播放' : appleMusicUrl(settings.bindings[t.id] ?? '') || (!settings.bindings[t.id] && t.appleMusic) ? 'Apple' : settings.bindings[t.id] ? '音频' : t.video ? '页内播放' : '待绑定'}</em></button>)}{filterTracks(tracks, scene, query).length === 0 && <p>暂无曲目。取消选曲后导入音频，即可添加自选曲目。</p>}</div>
      <div className="music-source"><strong>{selected?.title ?? '添加自选音频'}</strong>{selected?.audio && <div className="music-credits"><p>{selected.title} — {selected.artist}</p><p>{selected.duration?.replace(/^00:/, '')} · 器乐配乐 · 原始音频未修改</p><a href={selected.sourceUrl} target="_blank" rel="noreferrer">作者与曲目来源 ↗</a>{' · '}<a href={selected.licenseUrl} target="_blank" rel="noreferrer">{selected.license}</a><p>已按场景配好音乐，点击曲目即可在本站播放。</p>{settings.bindings[selected.id] && <button onClick={() => { setSettings(s => { const bindings = { ...s.bindings }; delete bindings[selected.id]; return { ...s, bindings }; }); void choose(selected, ''); }}>恢复本站配乐</button>}</div>}{selected && !selected.audio && <a href={selected.sourceUrl ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${selected.title} ${selected.artist} official soundtrack`)}`} target="_blank" rel="noreferrer">查找曲目来源 ↗</a>}{appleLink && <><a className="music-apple-link" href={appleMusicAppUrl(appleLink) ?? appleLink} onClick={() => audio.current?.pause()}>在本机音乐 App 播放 ↗</a><a href={appleLink} target="_blank" rel="noopener noreferrer">网页版备用链接 ↗</a>{selected?.appleEdition && <small>{selected.appleEdition}</small>}<p>点击会唤起本机“音乐”App，并请求播放所选曲目。首次使用请允许浏览器打开音乐 App；若未自动播放，请在 App 内点击播放。暂停、音量与循环由音乐 App 控制。</p></>}<p>导入后保存在当前浏览器。选中曲目时，导入会替换该曲目的播放来源。</p><label className="music-file">导入音频<input aria-label="导入音频" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" onChange={e => { const f = e.target.files?.[0]; if (f) void bind(f); e.target.value = ''; }} /></label>{selected && <><input aria-label="音频地址" placeholder="Apple Music、YouTube 链接或 HTTPS 音频直链" value={url} onChange={e => setUrl(e.target.value)} /><button onClick={() => { const valid = audioUrl(url); if (!valid) { setError('请输入有效的 Apple Music、YouTube 链接或 HTTPS 音频直链。'); return; } setSettings(s => ({ ...s, bindings: { ...s.bindings, [selected.id]: valid } })); void choose(selected, valid); }}>绑定地址</button><button onClick={stop}>取消选曲 / 添加自选</button></>}
      {selected?.video && !source && !appleLink && <><iframe key={selected.id} title={`${selected.title} 官方视频播放器`} referrerPolicy="strict-origin-when-cross-origin" src={`https://www.youtube-nocookie.com/embed/${selected.video}?playsinline=1&rel=0&loop=1&playlist=${selected.video}`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /><p>直接在上方播放器内点击播放，可控制暂停、音量与进度；默认循环。需要能够访问 YouTube，若无法加载，可导入本地音频在本站播放。</p></>}
      </div></div>
    </section>

    {error && <p className="music-error" role="status">{error}</p>}
    <audio ref={audio} controls={!!source} preload="metadata" aria-label="配乐播放器" className="w-full mt-3" src={source || undefined} loop={settings.loop} onPlay={() => { setPlaying(true); setError(''); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { if (source) setError('音频加载失败，请检查地址、网络或文件格式。'); }} />
  </section></div>;
}
