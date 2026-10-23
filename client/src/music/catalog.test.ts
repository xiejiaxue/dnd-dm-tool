import { describe, expect, it } from 'vitest';
import { appleMusicAppUrl, appleMusicUrl, audioUrl, filterTracks, waterdeep, youtubeId } from './catalog';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import credits from '../../public/music/credits.json';
describe('music sources and scene selection', () => {
  it('rejects active, insecure and credentialed URLs', () => {
    for (const value of ['javascript:alert(1)', 'data:audio/mp3;base64,x', 'http://example.com/a.mp3', 'https://user:secret@example.com/a.mp3', '/a.mp3']) expect(audioUrl(value)).toBeNull();
    expect(audioUrl('https://example.com/a.mp3')).toBe('https://example.com/a.mp3');
  });
  it('only accepts genuine YouTube hosts and valid IDs', () => {
    expect(youtubeId('https://youtu.be/JZeNYaTmVP4')).toBe('JZeNYaTmVP4');
    expect(youtubeId('https://www.youtube.com/watch?v=JZeNYaTmVP4')).toBe('JZeNYaTmVP4');
    expect(youtubeId('https://youtube.com.evil.test/watch?v=JZeNYaTmVP4')).toBeNull();
    expect(youtubeId('https://youtu.be/bad')).toBeNull();
  });
  it('covers each required scene and searches within the chosen scene', () => {
    for (const scene of ['城区','通用战斗','酒馆经营','眼魔','曼松','卡萨兰特','贾拉索']) expect(filterTracks(waterdeep, scene, '').length).toBeGreaterThan(0);
    expect(filterTracks(waterdeep, '酒馆经营', 'scarborough')[0]?.id).toBe('scarborough');
    expect(filterTracks(waterdeep, '曼松', 'scarborough')).toEqual([]);
    expect(new Set(waterdeep.map(t => t.id)).size).toBe(waterdeep.length);
  });
});

describe('Apple Music links', () => {
  it('every preset ships a playable, attributed recording with matching source checksum', () => {
    for (const track of waterdeep.filter(t => t.audio)) {
      expect(track.audio).toMatch(/^\/music\/[a-z]+-v\d+\.mp3$/);
      const path = new URL(`../../public${track.audio}`, import.meta.url);
      expect(existsSync(path)).toBe(true);
      const credit = credits.find(c => c.id === track.id)!;
      expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(credit.sha256);
      expect(track.license).toBe('CC BY 4.0');
      expect(track.sourceUrl).toMatch(/^https:\/\/incompetech.com\//);
      expect(track.licenseUrl).toBe('https://creativecommons.org/licenses/by/4.0/');
      expect(credit.seconds).toBeGreaterThan(30);
      expect(credit.instruments).not.toMatch(/choir|voice|vocal|singer/i);
      expect(track.appleMusic).toBeUndefined();
    }
    // Reads and hashes every shipped recording (about 108 MiB). That takes well under a second on a
    // warm cache but has passed vitest's 5 s default right after `npm ci` or beside other heavy suites.
  }, 30_000);
  it('embeds official recordings for Jarlaxle and the infernal battle', () => {
    const track = waterdeep.find(t => t.id === 'pirate')!;
    expect(track.title).toBe('Tank!');
    expect(track.note).toContain('铜管');
    expect(track.audio).toBeUndefined();
    expect(track.appleMusic).toBeUndefined();
    expect(track.video).toBe('UFFa0QoHWvE');
    const devil = waterdeep.find(t => t.id === 'devil')!;
    expect(devil.appleMusic).toBeUndefined();
    expect(devil.video).toBe('uncqBlFwnSw');
  });
  it('uses instrumental swing jazz for all tavern slots', () => {
    const tavern = filterTracks(waterdeep, '酒馆经营', '');
    expect(tavern.map(t => t.title)).toEqual(['George Street Shuffle', 'Hot Swing', 'Shades of Spring']);
    expect(tavern.every(t => t.note.includes('Swing jazz'))).toBe(true);
  });
  it('distinguishes Apple Music pages from direct audio and rejects lookalike hosts', () => {
    expect(appleMusicUrl('https://music.apple.com/us/album/test/123?i=456')).toBeTruthy();
    for (const value of ['https://music.apple.com.evil.test/us/album/test/123', 'https://example.com/song.mp3', 'https://music.apple.com/us/search?term=test', 'http://music.apple.com/us/album/test/123']) expect(appleMusicUrl(value)).toBeNull();
  });
});

describe('native Apple Music links', () => {
  it('keeps the selected song and storefront while requesting native playback', () => {
    const link = appleMusicAppUrl('https://music.apple.com/us/album/amber-ale/1870657767?i=1870658459');
    const url = new URL(link!);
    expect(url.protocol).toBe('musics:');
    expect(url.hostname).toBe('music.apple.com');
    expect(url.pathname).toBe('/us/album/amber-ale/1870657767');
    expect(url.searchParams.get('i')).toBe('1870658459');
    expect(url.searchParams.get('autoplay')).toBe('true');
  });
  it('never generates a native link for an untrusted destination', () => {
    expect(appleMusicAppUrl('https://music.apple.com.evil.test/us/album/test/123')).toBeNull();
    expect(appleMusicAppUrl('javascript:alert(1)')).toBeNull();
  });
});
