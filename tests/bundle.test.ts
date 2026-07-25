import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cold-start guards.
 *
 * The engine payload was cut from 1.48 MB gzipped to 682 KB by importing the 33
 * Babylon symbols this game uses from their own modules instead of the barrel
 * (`src/core/rendering/babylon.ts`). That saving evaporates the moment ONE file
 * re-adds `from '@babylonjs/core'` — the barrel drags the whole engine back in,
 * and nothing about the game would visibly break, so no other test would catch
 * it. Same for `@babylonjs/loaders/glTF`, which registers glTF 1.0 and ~30
 * extensions the models do not use.
 *
 * These are cheap structural checks, not a size budget: the real size numbers
 * live in docs/26_SCALE_PASS.md and are re-measured per build.
 */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Root HTML pages are Vite ENTRY POINTS with inline module scripts, and their
 *  imports land in the SAME shared chunks as the game's. Two of the authoring
 *  tools imported the Babylon barrel inline, which quietly restored the entire
 *  engine to the shared vendor chunk the moment they joined the build inputs —
 *  a 800 KB regression that no test scanning only `src/` could ever see. */
function htmlEntryPoints(): string[] {
  return readdirSync('.').filter((f) => f.endsWith('.html'));
}

const FACADE = 'src/core/rendering/babylon.ts';
const GLTF_FACADE = 'src/core/rendering/gltf.ts';

describe('engine import discipline', () => {
  const files = sourceFiles('src');

  it('only the façade imports the Babylon barrel', () => {
    const offenders = files.filter(
      (f) => f !== FACADE && /from ['"]@babylonjs\/core['"]/.test(readFileSync(f, 'utf8'))
    );
    expect(
      offenders,
      `these import the @babylonjs/core barrel instead of ${FACADE} — it pulls the whole engine back into the bundle`
    ).toEqual([]);
  });

  it('only the loader façade registers glTF', () => {
    const offenders = files.filter(
      (f) => f !== GLTF_FACADE && /@babylonjs\/loaders\/glTF['"]/.test(readFileSync(f, 'utf8'))
    );
    expect(
      offenders,
      `these register the full glTF loader instead of importing ${GLTF_FACADE} (glTF 1.0 + ~30 unused extensions)`
    ).toEqual([]);
  });

  it('no HTML entry point imports the barrel inline', () => {
    const offenders = htmlEntryPoints().filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /from ['"]@babylonjs\/core['"]/.test(src) || /@babylonjs\/loaders\/glTF['"]/.test(src);
    });
    expect(
      offenders,
      'these HTML pages import Babylon directly — they share the vendor chunk with the game, ' +
        `so the whole engine comes back. Import ${FACADE} instead.`
    ).toEqual([]);
  });

  it('the façade names every symbol it exports from a deep path', () => {
    const src = readFileSync(FACADE, 'utf8');
    // Every export must come from a '@babylonjs/core/<path>' module, never the
    // bare package — a single bare re-export would undo the whole pass.
    const bare = /export\s*\{[^}]*\}\s*from\s*['"]@babylonjs\/core['"]/.test(src);
    expect(bare, 'the façade must not re-export from the barrel').toBe(false);
    expect(src).toMatch(/@babylonjs\/core\/Meshes\/mesh/);
  });

  it('the thin-instance side effect is registered', () => {
    // Deep imports leave Mesh.thinInstance* as do-nothing stubs unless this
    // module is imported. When that happened, `natureBatching` planted every
    // prop and drew none of them, and the pixel gate passed because BOTH paths
    // were equally empty. Never again.
    expect(readFileSync(FACADE, 'utf8')).toContain('@babylonjs/core/Meshes/thinInstanceMesh');
  });

  it('the glTF file-loader plugin is registered', () => {
    // Without glTFFileLoader the SceneLoader has no .glb handler and every
    // model load resolves EMPTY rather than throwing — a silent blank course.
    expect(readFileSync(GLTF_FACADE, 'utf8')).toContain('@babylonjs/loaders/glTF/glTFFileLoader');
  });
});
