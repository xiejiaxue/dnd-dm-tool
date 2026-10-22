import hosted from './hosted.json';
export type Track = { id: string; title: string; artist: string; scene: string; note: string; video?: string; appleMusic?: string; appleEdition?: string; audio?: string; sourceUrl?: string; license?: string; licenseUrl?: string; originalTitle?: string; duration?: string };
const originalPresets: Track[] = [
  { id: 'city', title: 'Merchants of Novigrad', artist: 'The Witcher 3', scene: '城区', note: '白天街市、购物、公开联络', appleMusic: 'https://music.apple.com/us/album/eiforr-merchants-of-novigrad-from-the-witcher-3-game/1505362410?i=1505362699', appleEdition: 'Percival 的 Eiforr 版本' },
  { id: 'night', title: 'City of Intrigues', artist: 'The Witcher 3', scene: '城区', note: '夜间跟踪、调查与派系交易', appleMusic: 'https://music.apple.com/us/album/city-of-intrigues/1333501415?i=1333502478' },
  { id: 'combat', title: 'Dancing with the Source', artist: 'Divinity: Original Sin 2', scene: '通用战斗', note: '帮派冲突、守卫与追逐战', appleMusic: 'https://music.apple.com/us/album/dancing-with-the-source/1870657767?i=1870658110' },
  { id: 'intense', title: 'Silver for Monsters', artist: 'The Witcher 3', scene: '通用战斗', note: '强敌出现、战斗升级', appleMusic: 'https://music.apple.com/us/album/silver-for-monsters/1333501415?i=1333502475' },
  { id: 'tavern', title: 'Amber Ale', artist: 'Divinity: Original Sin 2', scene: '酒馆经营', note: '巨魔颅庄园日常营业', appleMusic: 'https://music.apple.com/us/album/amber-ale/1870657767?i=1870658459' },
  { id: 'festival', title: 'A Story You Won’t Believe', artist: 'The Witcher 3', scene: '酒馆经营', note: '开业、节庆、热闹的酒桌', appleMusic: 'https://music.apple.com/us/album/a-story-you-wont-believe/1333501415?i=1333502536' },
  { id: 'scarborough', title: 'Scarborough Fair / Canticle', artist: 'Simon & Garfunkel', scene: '酒馆经营', note: '吟游诗人演出、打烊后的温柔时刻；日常推荐自备器乐版', video: '-Jj4s9I-53g', appleMusic: 'https://music.apple.com/us/album/scarborough-fair-canticle/1467438660?i=1467438670' },
  { id: 'void', title: 'Symphony of the Void', artist: 'Divinity: Original Sin 2', scene: '眼魔', note: '潜入巢穴、诡异与压迫', appleMusic: 'https://music.apple.com/us/album/symphony-of-the-void/1870657767?i=1870657785' },
  { id: 'beholder', title: 'Rip & Tear', artist: 'Mick Gordon / DOOM', scene: '眼魔', note: '眼魔决战 · 快节奏重摇滚／工业金属，失真吉他与密集鼓点；无说唱', video: 'zZMg9ryeWOw', sourceUrl: 'https://www.youtube.com/watch?v=zZMg9ryeWOw' },
  { id: 'manshoon', title: 'Emhyr var Emreis', artist: 'The Witcher 3', scene: '曼松', note: '克隆体、权力与法师密室', appleMusic: 'https://music.apple.com/us/album/emhyr-var-emreis/1333501415?i=1333502472' },
  { id: 'wizard', title: 'Dark Chest of Wonders（器乐版）', artist: 'Nightwish', scene: '曼松', note: '曼松决战 · 交响摇滚／金属：管弦乐、电吉他与强劲鼓点；官方器乐重制版', video: '4fjhQkJfcOQ', sourceUrl: 'https://www.youtube.com/watch?v=4fjhQkJfcOQ' },
  { id: 'noble', title: 'Reflections from the Past', artist: 'Divinity: Original Sin 2', scene: '卡萨兰特', note: '贵族晚宴与家族悲剧', appleMusic: 'https://music.apple.com/us/album/reflections-from-the-past/1870657767?i=1870658104' },
  { id: 'cult', title: 'Deacons of the Deep', artist: 'Dark Souls III', scene: '卡萨兰特', note: '邪教仪式、献祭揭露', appleMusic: 'https://music.apple.com/us/album/deacons-of-the-deep/1777194407?i=1777194828' },
  { id: 'devil', title: '神怒之日 · Dies irae', artist: '威尔第 / 卡拉扬 / 维也纳爱乐', scene: '卡萨兰特', note: '地狱决战 · 《安魂曲》的末日审判，猛烈管弦乐与合唱', video: 'uncqBlFwnSw', sourceUrl: 'https://www.youtube.com/watch?v=uncqBlFwnSw' },
  { id: 'jarlaxle', title: 'Jack Sparrow', artist: 'Hans Zimmer', scene: '贾拉索', note: '登场、谈判、海上嘉年华', video: 'JZeNYaTmVP4', appleMusic: 'https://music.apple.com/us/album/jack-sparrow/1445882013?i=1445882015' },
  { id: 'pirate', title: 'Tank!', artist: 'SEATBELTS / 菅野洋子', scene: '贾拉索', note: '大乐队爵士 · 铜管齐奏、快速节奏与萨克斯独奏；贾拉索一边决斗一边戏弄对手', video: 'UFFa0QoHWvE', sourceUrl: 'https://www.youtube.com/watch?v=UFFa0QoHWvE' },
];
const tavernNotes: Record<string, string> = {
  tavern: 'Swing jazz · 轻松摇摆，巨魔颅庄园日常营业',
  festival: 'Swing jazz · 热闹铜管，开业与节庆；短曲循环',
  scarborough: 'Swing jazz · 钢琴三重奏，深夜酒桌与打烊',
};
export const waterdeep: Track[] = originalPresets.map(original => {
  if (['pirate', 'devil', 'wizard', 'beholder'].includes(original.id)) return original;
  const recording = hosted.find(track => track.id === original.id)!;
  return { scene: original.scene, originalTitle: original.title,
    note: tavernNotes[original.id] ?? original.note.replace('；有人声', '；器乐版氛围替代'), ...recording };
});
export function audioUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function filterTracks(tracks: Track[], scene: string, query: string) {
  return tracks.filter(t => (scene === '全部场景' || t.scene === scene) && `${t.title} ${t.originalTitle ?? ''} ${t.artist} ${t.scene} ${t.note}`.toLowerCase().includes(query.trim().toLowerCase()));
}
export function youtubeId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname) ? (url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : url.searchParams.get('v')) : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

export function appleMusicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'music.apple.com' && !url.username && !url.password && /^\/[a-z]{2}\/(album|song)\/.+\/\d+$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

/** Use the URL scheme registered by the native Music app, retaining the song ID. */
export function appleMusicAppUrl(value: string): string | null {
  const valid = appleMusicUrl(value);
  if (!valid) return null;
  const url = new URL(valid);
  url.searchParams.set('app', 'itunes');
  url.searchParams.set('autoplay', 'true');
  return url.href.replace(/^https:/, 'musics:');
}
