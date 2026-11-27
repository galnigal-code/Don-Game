// Downloads the CC0 textures from Poly Haven (https://polyhaven.com, CC0) and recompresses them for phones.
// Run by hand:  node tools/fetch-textures.mjs   (needs network access to api.polyhaven.com and dl.polyhaven.org)
// Output: public/textures/<role>/{diff,nor}.jpg and docs/CREDITS.md. The files are committed, so the build never needs the network.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

// role -> Poly Haven asset id
const ASSETS = { road: 'asphalt_02', sand: 'sandy_gravel_02', rock: 'cliff_side' };
const DIFF_SIZE = 1024, NOR_SIZE = 512;

// curl honours the session's proxy settings (Node's fetch does not)
const curlJson = (url) => JSON.parse(execFileSync('curl', ['-sS', '--fail', '--max-time', '60', url], { maxBuffer: 64 * 1024 * 1024 }).toString());
const curlFile = (url, dest) => execFileSync('curl', ['-sS', '--fail', '--max-time', '120', '-o', dest, url]);

const tmp = mkdtempSync(join(tmpdir(), 'phtex-'));
const credits = [];
try {
  for (const [role, id] of Object.entries(ASSETS)) {
    const files = curlJson(`https://api.polyhaven.com/files/${id}`);
    const info = curlJson(`https://api.polyhaven.com/info/${id}`);
    const dir = join('public', 'textures', role);
    mkdirSync(dir, { recursive: true });
    for (const [map, key, size, q] of [['diff', 'Diffuse', DIFF_SIZE, 80], ['nor', 'nor_gl', NOR_SIZE, 82]]) {
      const src = files[key]?.['1k']?.jpg?.url;
      if (!src) throw new Error(`${id}: no 1k jpg for ${key}`);
      const raw = join(tmp, `${id}_${map}.jpg`);
      curlFile(src, raw);
      await sharp(raw).resize(size, size, { fit: 'cover' }).jpeg({ quality: q, mozjpeg: true }).toFile(join(dir, `${map}.jpg`));
      console.log(`${role}/${map}.jpg  <- ${id} ${key} (${size}px)`);
    }
    const authors = Object.entries(info.authors || {}).map(([n, w]) => `${n} (${w})`).join(', ');
    credits.push({ role, id, name: info.name, url: `https://polyhaven.com/a/${id}`, authors });
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

writeFileSync('docs/CREDITS.md', `# Credits

All textures are from **Poly Haven** (https://polyhaven.com) and are released under the **CC0 1.0 Universal** license (public domain, no attribution required; credited here anyway).
They are recompressed for mobile (colour 1024 px, normal map 512 px, JPEG). Everything else in the game (models, sounds, music) is generated in code.

| Use | Texture | Author(s) | Source | License |
|---|---|---|---|---|
${credits.map((c) => `| ${c.role} | ${c.name} (${c.id}) | ${c.authors} | ${c.url} | CC0 |`).join('\n')}
`);
console.log('docs/CREDITS.md written');
