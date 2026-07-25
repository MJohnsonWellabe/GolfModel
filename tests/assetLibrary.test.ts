import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { ASSET_GROUPS, ASSET_LIBRARY, footprint, placementFor, referencedModels } from '../src/data/assetLibrary';

/**
 * The asset library must match the models that actually ship.
 *
 * A catalog entry for a model that is not there is worse than no catalog: the
 * designer places it, the plan view draws it happily, and the hole renders with
 * a hole in it. Nothing else in the build would notice — the loader treats a
 * missing prop as an empty load.
 *
 * So this walks the real directories, in both directions.
 */
describe('asset library', () => {
  const dirs: Record<string, string> = { nature: 'assets/models/nature', props: 'assets/models/props' };

  it('every listed model exists on disk', () => {
    const missing = referencedModels().filter(({ dir, key }) => !existsSync(`${dirs[dir]}/${key}.glb`));
    expect(
      missing.map((m) => `${m.dir}/${m.key}.glb`),
      'these are offered in the Hole Builder but do not ship — placing one renders nothing'
    ).toEqual([]);
  });

  it('offers every tree, rock and prop that ships', () => {
    // The other direction: a model added to the pack but never catalogued is a
    // model no designer can find. Scoped to the categories the library covers —
    // ground scatter, clouds and mountains are theme-level, not placeable.
    const listed = new Set(referencedModels().map((m) => m.key));
    const placeablePrefixes = /^(tree_|rock_|stone_|canyon_|mesa_|dunes_|rocks_)/;
    const shipped = readdirSync(dirs.nature)
      .filter((f) => f.endsWith('.glb'))
      .map((f) => f.replace(/\.glb$/, ''))
      .filter((k) => placeablePrefixes.test(k));
    const uncatalogued = shipped.filter((k) => !listed.has(k));
    expect(uncatalogued, 'these ship but are not offered in the Hole Builder').toEqual([]);

    const shippedProps = readdirSync(dirs.props)
      .filter((f) => f.endsWith('.glb'))
      .map((f) => f.replace(/\.glb$/, ''));
    expect(shippedProps.filter((k) => !listed.has(k)), 'props that ship but are not offered').toEqual([]);
  });

  it('has unique ids and a group for everything', () => {
    const ids = ASSET_LIBRARY.map((a) => a.id);
    expect(new Set(ids).size, 'duplicate asset ids').toBe(ids.length);
    for (const a of ASSET_LIBRARY) {
      expect(a.label.length, a.id).toBeGreaterThan(0);
      expect(ASSET_GROUPS).toContain(a.group);
    }
  });

  it('turns every asset into placeable JSON', () => {
    // A library entry that produces nothing is a dead chip in the UI.
    for (const a of ASSET_LIBRARY) {
      const p = placementFor(a, 500, 600);
      expect(p, `${a.id} produced no placement`).toBeTruthy();
      expect(p!.field.length).toBeGreaterThan(0);
      expect(p!.value).toBeTruthy();
    }
  });

  it('places things where they were dropped', () => {
    const tree = ASSET_LIBRARY.find((a) => a.kind === 'trees')!;
    const p = placementFor(tree, 500, 600)!;
    const poly = (p.value as { polygon: number[][] }).polygon;
    const cx = poly.reduce((a, q) => a + q[0], 0) / poly.length;
    const cy = poly.reduce((a, q) => a + q[1], 0) / poly.length;
    expect(cx).toBeCloseTo(500, 0);
    expect(cy).toBeCloseTo(600, 0);

    const prop = ASSET_LIBRARY.find((a) => a.kind === 'prop')!;
    expect(placementFor(prop, 123.44, 456.78)!.value).toMatchObject({ x: 123.4, y: 456.8 });
  });

  it('a hollow is a dome that goes down', () => {
    // The one place the library encodes intent rather than a model: the same
    // elevation primitive reads as a mound or a punchbowl by its sign.
    const mound = placementFor(ASSET_LIBRARY.find((a) => a.id === 'elevation:dome')!, 0, 0)!;
    const hollow = placementFor(ASSET_LIBRARY.find((a) => a.id === 'elevation:hollow')!, 0, 0)!;
    expect((mound.value as { h: number }).h).toBeGreaterThan(0);
    expect((hollow.value as { h: number }).h).toBeLessThan(0);
    expect((hollow.value as { shape: string }).shape).toBe('dome');
  });

  it('generates a closed, centred footprint', () => {
    const poly = footprint(100, 200, 50, 8);
    expect(poly).toHaveLength(8);
    // Both coordinates are rounded to 0.1 px for a compact JSON, so the radius
    // can move by up to √2·0.05 ≈ 0.071.
    for (const [x, y] of poly) {
      expect(Math.abs(Math.hypot(x - 100, y - 200) - 50)).toBeLessThan(0.08);
    }
  });
});
