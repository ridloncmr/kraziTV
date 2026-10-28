# Third-Party Notices

This file records license notices for third-party material included or adapted
in kraziTV, and in the Docker image built from it. These notices apply to the identified third-party material; they do
not replace the project's AGPL-3.0 license.

## Web Admin Visual Reference

The Web Admin's visual research reference is
[faisalAkhtar/windows-xp](https://github.com/faisalAkhtar/windows-xp), licensed
under MPL-2.0. Its `assets/desktop.css`, `assets/loader.css`, `desktop.html`, and
`loading.html` informed the compact proportions, dimensional chrome, Start,
taskbar, and boot composition. The kraziTV implementation was written
independently from the design brief's tokens; no upstream code, Microsoft
wallpaper, logos, icons, or font binaries are distributed. The CRT mark,
program icons, and `apps/web/src/desktop/chrome/northwoods.svg` are original kraziTV vector
artwork and use the project's license.

## TMDB

kraziTV looks up content metadata through the TMDB API. TMDB's data is
provided under [TMDB's API terms](https://www.themoviedb.org/api-terms-of-use),
not this project's license, and each owner supplies their own TMDB API key.

`apps/web/src/branding/tmdb-logo.svg` is TMDB's logo, a TMDB trademark,
included unmodified as TMDB's attribution guidelines require. It is not
covered by this project's license. Wherever kraziTV shows TMDB facts or asks
for a key, it shows the logo with the notice "This application uses TMDB and
the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB."
kraziTV is not endorsed or certified by TMDB.

## Web App Libraries

The built web app bundles React, ReactDOM, and Scheduler, which the build
strips of their license comments. All three carry the same license:

```text
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Docker Image

The source repository contains no FFmpeg code and does not link to FFmpeg;
kraziTV runs an installed `ffmpeg` and `ffprobe` as separate programs. The
Docker image built from `Dockerfile` does contain them, along with the rest
of its Debian and Node.js base:

- **FFmpeg**, from Debian's `ffmpeg` package. Debian builds it with
  `--enable-gpl` and libx264, so the FFmpeg in the image is licensed under
  the [GNU GPL, version 2 or later](https://ffmpeg.org/legal.html).
- **Other Debian packages**, each under its own license. Every package's
  license is in the image at `/usr/share/doc/<package>/copyright`.
- **Node.js**, under the MIT license and the licenses of the code it bundles,
  in the image at `/usr/local/LICENSE`.
- **npm dependencies of the server**, each with its own license file under
  `node_modules/` in the image.

Source for every Debian package in a published image, at its exact version,
is available from Debian at [sources.debian.org](https://sources.debian.org/)
and permanently at [snapshot.debian.org](https://snapshot.debian.org/).
`dpkg -l` inside the image lists those versions; for example,
`docker run --rm --entrypoint dpkg <image> -l ffmpeg libx264-164`. On
request, the maintainers will provide the corresponding source for any
published image.

This file and the project's `LICENSE` are copied into the image at `/app`.

## Matt Pocock Skills

The following files are adapted from Matt Pocock's
[`skills`](https://github.com/mattpocock/skills) repository:

- `.agents/skills/code-review/SKILL.md`
- `.agents/skills/codebase-design/SKILL.md`
- `.agents/skills/diagnosing-bugs/SKILL.md`
- `.agents/skills/domain-modeling/SKILL.md`
- `.agents/skills/handoff/SKILL.md`
- `.agents/skills/research/SKILL.md`
- `.agents/skills/tdd/SKILL.md`
- `.agents/skills/to-spec/SKILL.md`
- `.agents/skills/to-tickets/SKILL.md`
- `.agents/skills/writing-for-agents/SKILL.md`

The upstream material is licensed under the following terms:

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
