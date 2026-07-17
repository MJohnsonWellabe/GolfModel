# Marketing clips

The five gameplay tiles on `marketing.html` are populated from in-app CLIP
recordings, trimmed to the action and re-encoded small (H.264 mp4, ~200-380 KB
each, iOS/everywhere-friendly):

| Tile              | File              | Shows                                   |
| ----------------- | ----------------- | --------------------------------------- |
| Tee shot to pin   | `hole-in-one.mp4` | Sable Bay island-green tee shot         |
| Check & back up   | `backspin.mp4`    | Timberline approach that checks         |
| Island carry      | `island.mp4`      | Sable Bay carry over water to the green |
| Clutch putt       | `putt.mp4`        | A breaking putt dropping                |
| Spin check        | `greenread.mp4`   | Timberline #3 pond-green wedge          |

To swap a tile: drop a replacement mp4 with the same filename here. Portrait
clips fit the 9:16 tiles best. Trim + shrink with, e.g.:
`ffmpeg -ss START -to END -i in.mp4 -c:v libx264 -crf 26 -an -vf scale=540:-2 -movflags +faststart out.mp4`

## Preloaded library (`library-*.mp4`) — NEEDS REVIEW before wiring

Twelve raw in-game captures were dropped in as a source library for the 1.0
clip refresh. They are **full-length screen recordings** (476 KB–3.1 MB), not
yet trimmed to a single address→rest swing or re-encoded to the ~200-380 KB
tile spec above, so the five live tiles above still point at the known-good
`hole-in-one/backspin/island/greenread/putt.mp4` clips (safe fallback — do not
delete them).

The `library-<HHMMSS>-<guessed-slot>.mp4` names encode the source capture time
and a **best-guess** slot only (content was not verified — no video tooling was
available). Before wiring any of these into the `CLIPS` array in
`src/marketing/main.ts`, watch each one, pick the best per slot, then trim +
re-encode with the ffmpeg line above and give it a stable slot filename.

| library file                     | guessed slot        | notes                          |
| -------------------------------- | ------------------- | ------------------------------ |
| `library-175316-par3-tee.mp4`    | Par-3 tee shot      | evening 1.0-capture session    |
| `library-175345-spin.mp4`        | Spin / check & back | evening 1.0-capture session    |
| `library-175624-drive.mp4`       | Drive (behind)      | largest evening clip           |
| `library-175907-putt.mp4`        | Clutch putt         | evening 1.0-capture session    |
| `library-180121-truevision.mp4`  | True Vision line    | evening 1.0-capture session    |
| `library-092549-extra.mp4`       | alternate           | morning session                |
| `library-092554-extra-short.mp4` | alternate           | morning session, short (486 KB)|
| `library-092620-extra.mp4`       | alternate           | morning session                |
| `library-092830-extra.mp4`       | alternate           | morning session                |
| `library-101430-extra.mp4`       | alternate           | midday session                 |
| `library-101524-extra.mp4`       | alternate           | midday session                 |
| `library-103005-extra-short.mp4` | alternate           | midday session, short (842 KB) |
