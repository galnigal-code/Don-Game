import { describe, it, expect } from 'vitest';
import { generateCode, normalizeCode, isValidCode, CODE_ALPHABET } from '../../src/net/room/codes.js';
import { cleanName, NAME_MAX } from '../../src/net/nameFilter.js';
import { parseClientMessage } from '../../src/net/protocol.js';
import { awardPoints, scoreTable } from '../../src/net/room/scoring.js';

describe('room codes', () => {
  it('alphabet has no I, L, O', () => { for (const c of 'ILO') expect(CODE_ALPHABET).not.toContain(c); });
  it('generated codes are valid and varied', () => {
    const set = new Set();
    for (let i = 0; i < 200; i++) { const c = generateCode(); expect(isValidCode(c)).toBe(true); set.add(c); }
    expect(set.size).toBeGreaterThan(150);
  });
  it('normalises user input', () => { expect(normalizeCode(' k-r tm ')).toBe('KRTM'); expect(normalizeCode('KRT')).toBe(''); expect(normalizeCode('KRTO')).toBe(''); expect(normalizeCode(null)).toBe(''); });
});
describe('nicknames', () => {
  it('limits length, strips invisible/bidi characters', () => { expect(cleanName('a'.repeat(40)).length).toBe(NAME_MAX); expect(cleanName('‮abc​')).toBe('abc'); });
  it('empty becomes the default', () => { expect(cleanName('   ')).toBe('שחקן'); expect(cleanName(undefined)).toBe('שחקן'); });
  it('filters bad words even when disguised', () => { expect(cleanName('F u c k')).toBe('שחקן'); expect(cleanName('sh1t')).toBe('שחקן'); });
  it('keeps normal names (Hebrew, emoji)', () => { expect(cleanName('דני 🚗')).toBe('דני 🚗'); expect(cleanName('Sara')).toBe('Sara'); });
});
describe('protocol validation', () => {
  const ok = (o) => parseClientMessage(JSON.stringify(o));
  it('accepts valid messages', () => { expect(ok({ t: 'ping', c: 1 })).toBeTruthy(); expect(ok({ t: 'emoji', e: '🔥' })).toBeTruthy(); expect(ok({ t: 'finish', raceTime: 80.5 })).toBeTruthy(); });
  it('rejects garbage', () => {
    for (const bad of [{ t: 'emoji', e: '💩' }, { t: 'finish', raceTime: -1 }, { t: 'finish', raceTime: 'x' }, { t: 'nope' }, { t: 'hello', v: 1, token: 'short', name: 'x', color: 1 }, null, 5]) expect(ok(bad)).toBeNull();
    expect(parseClientMessage('{bad json')).toBeNull(); expect(parseClientMessage('x'.repeat(2000))).toBeNull();
  });
});
describe('scoring', () => {
  it('10/7/5/3/2/1 for finishers, 0 for the rest and beyond 6', () => {
    const o = ['a', 'b', 'c', 'd', 'e', 'f'].map((t) => ({ token: t, finished: true })); o[5].finished = false;
    expect([...awardPoints(o).values()]).toEqual([10, 7, 5, 3, 2, 0]);
  });
  it('table sorts by points, then wins', () => {
    const m = new Map([['a', { name: 'a', color: 1, points: 5, wins: 0, races: 1 }], ['b', { name: 'b', color: 2, points: 5, wins: 1, races: 1 }], ['c', { name: 'c', color: 3, points: 9, wins: 0, races: 1 }]]);
    expect(scoreTable(m).map((s) => s.name)).toEqual(['c', 'b', 'a']);
  });
});
