import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { LEVELS } from '../../src/render/quality.js';
import { SURFACES } from '../../src/render/textures.js';

describe('surface textures (V2-D)', () => {
  it('every texture file exists, is a reasonable size and is credited as CC0', () => {
    const credits = readFileSync('docs/CREDITS.md', 'utf8');
    let total = 0;
    for (const name of SURFACES) {
      for (const f of ['diff', 'nor']) {
        const p = `public/textures/${name}/${f}.jpg`;
        expect(existsSync(p), p).toBe(true);
        total += statSync(p).size;
      }
      expect(credits).toMatch(new RegExp(`\\| ${name} \\|.*CC0`));
    }
    expect(total).toBeLessThan(1.5 * 1024 * 1024);   // download budget
  });
  it('textures are off on the lowest tier and normal maps only from tier 2', () => {
    expect(LEVELS[0].tex).toBe(false);
    expect(LEVELS[1].tex).toBe(true); expect(LEVELS[1].normal).toBe(false);
    expect(LEVELS[2].normal).toBe(true);
    for (let i = 1; i < LEVELS.length; i++) { expect(LEVELS[i].tex || !LEVELS[i - 1].tex).toBe(true); expect(LEVELS[i].normal || !LEVELS[i - 1].normal).toBe(true); }
  });
});
