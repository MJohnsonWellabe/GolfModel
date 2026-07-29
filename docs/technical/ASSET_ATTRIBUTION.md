# Asset Attribution

Third-party art used in Bite-Sized Golf, with source and license. All entries
are CC0 (public domain) or CC-BY (attribution required). New assets must be
recorded here before use.

## Poly Haven skies (polyhaven.com) — CC0 (public domain)

Downloaded 2026-07-29 (owner: "I want courses to have their own unique skies
and clouds", stylised from CC0 sources). Eight `*_puresky` HDRIs — sky only, no
ground — are the STRUCTURAL SOURCE for each course's sky DOME. (They were the
source for the clouds too until the clouds were rebuilt from the CC0 pack
below; `convert-skies.mjs` still measures a cloud's lit/shade colours when
checking a new style, but writes only the ramp.) Nothing
photographic ships: `scripts/convert-skies.mjs` reads each equirect, measures
its real horizon ramp, cloud field and solar aureole, and repaints them as flat
posterised bands (see the script header for the recipe). The committed outputs
in `assets/textures/sky/` are a few KB of painted bands, not a photo.

The raw 8192×4096 tonemapped JPGs (~17MB each) are NEVER committed; the script
caches them in `node_modules/.cache/golf-skies/` and re-downloads on demand.

| Sky style | Poly Haven asset | Authors | Used by |
|---|---|---|---|
| `storm_canyon` | [Table Mountain 1 (Pure Sky)](https://polyhaven.com/a/table_mountain_1_puresky) | Greg Zaal, Jarod Guest | Red Hollow |
| `sea_haze` | [Kloofendal Misty Morning (Pure Sky)](https://polyhaven.com/a/kloofendal_misty_morning_puresky) | Greg Zaal | Sable Bay |
| `links_coast` | [Aristea Wreck (Pure Sky)](https://polyhaven.com/a/aristea_wreck_puresky) | Greg Zaal, Jarod Guest | Port Johnson Links |
| `alpine_clear` | [Drakensberg Solitary Mountain (Pure Sky)](https://polyhaven.com/a/drakensberg_solitary_mountain_puresky) | Dimitrios Savva, Jarod Guest | Timberline East |
| `alpine_broken` | [Rocky Ridge (Pure Sky)](https://polyhaven.com/a/rocky_ridge_puresky) | Greg Zaal, Jarod Guest | Timberline West |
| `prairie_gold` | [Qwantani Sunset (Pure Sky)](https://polyhaven.com/a/qwantani_sunset_puresky) | Greg Zaal, Jarod Guest | Wild Prairie |
| `autumn_overcast` | [Overcast Soil (Pure Sky)](https://polyhaven.com/a/overcast_soil_puresky) | Jarod Guest, Sergej Majboroda | Maple Vale |
| `parkland_bright` | [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | Greg Zaal, Jarod Guest | Wildwood Glen |

Asset ids and author lists above were read back from `api.polyhaven.com/info/<id>`
and checked against the `src:` fields in `scripts/convert-skies.mjs` — that
script is the only thing that decides which file is used, so it is the authority
here. Several sources were tried and dropped during authoring (wasteland_clouds,
rustig_koppie, farm_field, sunflowers, kloppenheim_05); the script header records
why. Crediting one of those would credit the wrong artists, which is worse than
no entry at all.

License: every Poly Haven HDRI is released CC0 1.0
(https://polyhaven.com/license, http://creativecommons.org/publicdomain/zero/1.0/)
— no attribution required; the authors are credited here as good practice, as
with the Kenney packs below.

## OpenGameArt cloud alphas — CC0 (public domain)

Downloaded 2026-07-29. `fx_cloudalphas` by **WickedInsignia** — ten 2048x2048
cloud alphas, released CC0 ("I hereby release these assets into the public
domain under the CC0 license"): <https://opengameart.org/content/clouds-with-transparency>

These are the cloud BILLBOARDS on every course. The Poly Haven skies above give
each course its dome ramp and still do; the clouds used to be cut out of the
same HDRIs and posterised, and that was the one part of the painted skies that
did not work (owner: "I'm liking the color changes on the sky so they look
unique but the clouds look bad"). A posterised photo crop came out as a smooth
ellipse, a torn scrap with rectangular blocks in it, or a grey smear, depending
on the source — the approach was wrong, not the tuning.

`scripts/convert-clouds.mjs` keeps **only the alpha** of each source and throws
the photograph's colour away: the pack is VFX smoke, grey-brown, and the owner's
note was "just make the clouds whiter instead of grey smoke". What ships is five
quantised GREYSCALE silhouettes (~80KB total, shared by all eight courses);
`src/slice3d/course3d.ts` turns luminance back into alpha and lays that course's
own lit/shade ramp over it, so the clouds are tinted from the course's `sunTint`,
`skyTop` and `haze` and never from a photograph.

| File (assets/textures/sky/) | Source | Role |
|---|---|---|
| `cloud_cumulus1.png` | FX_CloudAlpha03 | the densest, most cloud-like of the ten |
| `cloud_cumulus2.png` | FX_CloudAlpha06 | a broader, more broken mass |
| `cloud_cumulus3.png` | FX_CloudAlpha09 | the airiest of the three |
| `cloud_cirrus1.png` | FX_CloudAlpha07 | thin high streak |
| `cloud_cirrus2.png` | FX_CloudAlpha02 | thin high streak |

The 28MB source zip is never committed; `convert-clouds.mjs` caches it in
`node_modules/.cache/golf-clouds/` and re-downloads on demand. CC0 requires no
attribution; the author is credited here as good practice, as elsewhere in this
file.

## Kenney (www.kenney.nl) — CC0 (public domain)

CC0 requires no attribution; credited here as good practice. Downloaded
2026-07-21 from the official kenney.nl asset packs.

| File (assets/models/props/) | Source pack | Kenney model | Use |
|---|---|---|---|
| `rowboat.glb` | Pirate Kit 2.1 | `boat-row-small` | Rowboat/dinghy on the water |
| `bench.glb` | Furniture Kit | `bench` | Park bench (Wildwood parkland) |
| `fence.glb` | Nature Kit | `fence_simple` | Wooden rail fence (parkland / links margins) |
| `bridge_stone.glb` | Nature Kit | `bridge_stone` | Stone footbridge (creek crossings) |
| `castle.glb` | Quaternius (via poly.pizza, CC0) | `Wonder_SecondAge_Level3` | Assembled stone fortress backdrop landmark (Port Johnson links) |
| `clubhouse.glb` | Poly by Google (via poly.pizza, CC-BY) | `Palace` | Grand estate landmark behind Wild Prairie h2 green |

The `clubhouse.glb` was downloaded 2026-07-22 as a real CC0 model (owner: "go
get assets to use") from poly.pizza, replacing the earlier hand-authored
placeholder GLB.

## Self-authored (no third-party source)

`lighthouse.glb` is **not** third-party art and was previously listed above as
Kenney Pirate Kit's `tower-complete-large`. It is generated by
`scripts/gen-lighthouse.mjs` — see `docs/roadmap/POLISH_PASS.md` for why the
lighthouse, sailboat and dune had to be hand-authored rather than sourced. A
register that credits somebody else's pack for our own geometry is worse than
no entry, so it is recorded here instead.

## Quaternius alpine pines (via poly.pizza) — CC0

Downloaded 2026-07-22 (owner: "find a better conifer tree asset"). Detailed
layered conifers with clean Bark_NormalTree / Leaves_Pine slots, used for the
Timberline East/West forest in place of the blobby firs.

| File (assets/models/nature/) | Source | Use |
|---|---|---|
| `tree_pine_q1.glb` | Quaternius pine (poly.pizza, CC0) | Alpine pine — lighter silhouette (~1.6k tris) |
| `tree_pine_q2.glb` | Quaternius pine (poly.pizza, CC0) | Alpine pine — fuller silhouette (~3.4k tris) | The `castle.glb` was first a Kenney castle KIT sampler (all
159 pieces incl. knights/siege engines — it rendered as scattered parts, not a
castle); it was replaced 2026-07-22 with Quaternius's single assembled
`Wonder_SecondAge_Level3` fortress (CC0, via poly.pizza).

Pre-existing Kenney/Quaternius assets (trees, rocks, grasses, the original
`bridge.glb`, mountains) predate this file; see the in-code comments in
`scripts/courses/*.mjs` and `src/slice3d/natureModels.ts` noting "CC0 assets
(Kenney / Quaternius)".

License text: Creative Commons Zero (CC0 1.0),
http://creativecommons.org/publicdomain/zero/1.0/ — "You can use this content
for personal, educational, and commercial purposes."

## Log cabin (via poly.pizza) — CC-BY

Downloaded 2026-07-23 (owner: Wild Prairie #2 — the Palace clubhouse "didn't fit
... what about a giant log cabin"). A single assembled low-poly timber lodge
(~3.3k tris, Y-up, one merged mesh + door), placed as `assets/models/props/
logcabin.glb` and used as the giant landmark behind Wild Prairie h2's green.

| File (assets/models/props/) | Source | License |
|---|---|---|
| `logcabin.glb` | "Log cabin" by Poly by Google, via poly.pizza (https://poly.pizza/m/f7uccD5iyz0) | **CC-BY 4.0** — attribution required |

License text: Creative Commons Attribution (CC-BY 4.0),
https://creativecommons.org/licenses/by/4.0/ — attribution to Poly by Google.

## Locker Room backdrop (ambientCG Planks023A) — CC0

Downloaded 2026-07-29 (owner: "the locker room button once you go into that menu
needs a graphic of one of the historic golf locker rooms"). Photographs of the
real champions locker rooms are all copyrighted, so the backdrop is a CC0 wood
plank photo used as the actual timber GRAIN with the room painted over it in the
game's own flat-shaded language (owner chose "photo base, painted over").

| File | Source | License |
|---|---|---|
| `assets/marketing/img/locker-room.png` | Built by `scripts/gen-locker-art.mjs` from ambientCG "Planks023A" (https://ambientcg.com/view?id=Planks023A), `Planks023A_1K-JPG_Color.jpg` only | **CC0 1.0** |

Regenerate with `node scripts/gen-locker-art.mjs <Planks023A_1K-JPG_Color.jpg>`;
the script is deterministic, so a re-run reproduces the committed file. Output is
1600x900 and palette-quantised, matching the cap `scripts/optimize-marketing.mjs`
enforces on every other menu backdrop.

License text: Creative Commons Zero (CC0 1.0),
http://creativecommons.org/publicdomain/zero/1.0/
