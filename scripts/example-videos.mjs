// SPDX-License-Identifier: GPL-3.0-or-later
// Assemble the actual renderer's checked-in GIFs into portable comparison videos.
// Run from the repository root: node scripts/example-videos.mjs (requires FFmpeg).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('docs/videos', { recursive: true });
for (const name of ['satin-botanical', 'tatami-compass']) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-ignore_loop',
      '1',
      '-i',
      `docs/stitch-examples/before/${name}/stitch-out.gif`,
      '-ignore_loop',
      '1',
      '-i',
      `docs/stitch-examples/after/${name}/stitch-out.gif`,
      '-filter_complex',
      "[0:v]setpts=PTS-STARTPTS,pad=560:608:0:48:color=0x17212b,drawtext=text='BEFORE':fontcolor=white:fontsize=24:x=(w-tw)/2:y=12[left];" +
        "[1:v]setpts=PTS-STARTPTS,pad=560:608:0:48:color=0x17212b,drawtext=text='AFTER':fontcolor=white:fontsize=24:x=(w-tw)/2:y=12[right];" +
        '[left][right]hstack=inputs=2:shortest=1,fps=24,format=yuv420p[out]',
      '-map',
      '[out]',
      '-an',
      '-c:v',
      'libx264',
      '-crf',
      '18',
      '-preset',
      'slow',
      '-movflags',
      '+faststart',
      `docs/videos/${name}.mp4`,
    ],
    { stdio: 'inherit' },
  );
  console.log(`Created docs/videos/${name}.mp4`);
}
