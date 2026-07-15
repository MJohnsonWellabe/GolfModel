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
