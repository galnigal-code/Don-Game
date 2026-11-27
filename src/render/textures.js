// Loads the CC0 surface textures (public/textures, see docs/CREDITS.md). Every failure is silent:
// a missing file simply means that surface keeps its flat procedural colour, so the game always runs.
import * as THREE from 'three';

export const SURFACES = ['road', 'sand', 'rock'];

function load(loader, url, srgb) {
  return new Promise((resolve) => {
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

/** Resolves to { road: {diff, nor}, sand: {...}, rock: {...} }; a map that failed to load is null. Never rejects. */
export async function loadSurfaceTextures(base = import.meta.env?.BASE_URL || '/') {
  const loader = new THREE.TextureLoader();
  const out = {};
  await Promise.all(SURFACES.map(async (name) => {
    const [diff, nor] = await Promise.all([
      load(loader, `${base}textures/${name}/diff.jpg`, true),
      load(loader, `${base}textures/${name}/nor.jpg`, false),
    ]);
    out[name] = { diff, nor };
  }));
  return out;
}

/**
 * Switches one material between flat colour and textured. `flags` = { tex, normal } from the quality level.
 * `tint` is the colour multiplied with the texture (white-ish), `flat` the colour used without it.
 */
export function applySurface(material, set, flags, { tint, flat, normalScale = 1, boost = 1 }) {
  const useTex = !!(flags.tex && set && set.diff);
  const useNor = !!(useTex && flags.normal && set.nor);
  const map = useTex ? set.diff : null, nor = useNor ? set.nor : null;
  if (material.map !== map || material.normalMap !== nor) { material.map = map; material.normalMap = nor; material.needsUpdate = true; }
  if (nor) material.normalScale.set(normalScale, normalScale);
  material.color.setHex(useTex ? tint : flat);
  if (useTex) material.color.multiplyScalar(boost);   // photo textures are darker than the flat colours they replace
}
