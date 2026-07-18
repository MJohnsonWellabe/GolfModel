// One-shot regrade of the Wild Valley fescue cards (heather_fescue_a/b/c)
// from the source pack's olive-green to sunlit straw-gold, IN the glbs
// (playtest: "brighter, longer grass, more vibrant — think Sand Valley").
//
// Two things happen per texture, working on raw RGBA:
//  1. Opaque texels get a warm recomb + contrast compression toward pale
//     straw (material-level fixes could not do this: the cards' baked
//     normals defeat dynamic lighting, and emissive paths ignore the flat
//     color once an emissive texture is bound).
//  2. Transparent texels get straw RGB bled underneath. The source stored
//     BLACK under its alpha, so every mipmap level averaged the blades
//     toward black — the actual cause of the "dark scrub" look at distance.
//
// Destructive in place (originals recoverable from git history):
//   node scripts/regrade-fescue-gold.mjs
import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const io = new NodeIO();
const grade = (r, g, b) => {
  let nr = 1.18 * r + 0.18 * g;
  let ng = 0.14 * r + 1.0 * g;
  let nb = 0.04 * r + 0.1 * g + 0.6 * b;
  nr = 0.62 * nr + 88; ng = 0.62 * ng + 88; nb = 0.62 * nb + 88;
  return [Math.min(255, nr), Math.min(255, ng), Math.min(255, nb)];
};
const STRAW = [201, 178, 118];
for (const name of ['heather_fescue_a', 'heather_fescue_b', 'heather_fescue_c']) {
  const path = `assets/models/nature/${name}.glb`;
  const doc = await io.read(path);
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const { data, info } = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) {
        data[i] = STRAW[0]; data[i + 1] = STRAW[1]; data[i + 2] = STRAW[2];
      } else {
        const [r, g, b] = grade(data[i], data[i + 1], data[i + 2]);
        data[i] = r; data[i + 1] = g; data[i + 2] = b;
      }
    }
    const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    tex.setImage(new Uint8Array(out));
    tex.setMimeType('image/png');
  }
  await io.write(path, doc);
  console.log(name, 'regraded');
}
