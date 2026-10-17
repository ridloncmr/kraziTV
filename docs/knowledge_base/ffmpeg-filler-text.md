# FFmpeg Filler Text

## Question

What does the FFmpeg build need so SignalPackager can transmit planned filler,
a black screen reading **Programming resumes at 8:00 PM** over silence
([ADR 0014](../adrs/0014-planned-filler-coverage.md))?

## Findings

- Filler is drawn with the `drawtext` filter, which exists only in builds
  configured with `--enable-libfreetype`. Check with
  `ffmpeg -hide_banner -filters | grep drawtext`. Without it, every filler
  item fails and its channel stops at the first reservation gap.
- `drawtext` needs a font. Without `fontfile=` it asks fontconfig for a
  default, which works on Linux hosts with any font installed. The gyan.dev
  Windows builds ship fontconfig without a default config and fail with
  `Fontconfig error: Cannot load default config file`.
- An explicit `fontfile=` works everywhere. Inside a `-vf` filtergraph its
  value, like the message, is escaped twice: once for the option parser
  (`\`, `'`, `:`) and once for the filtergraph parser (`\`, `'`, `[`, `]`,
  `,`, `;`). `C:/Windows/Fonts/arial.ttf` becomes `C\\:/Windows/Fonts/arial.ttf`.
- `expansion=none` prints the text as written, so `%` needs no escaping.

## Operations

| Setting            | Effect                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `FFMPEG_FONT_FILE` | The font filler text is drawn in. Unset: `%WINDIR%\Fonts\arial.ttf` on Windows, fontconfig's default font everywhere else. |

`npm run test:ffmpeg` renders real filler and fails if the build lacks
`drawtext` or the font cannot be loaded. It uses `FFMPEG_FONT_FILE` when set.

## Sources

- FFmpeg filters documentation, `drawtext` and "Notes on filtergraph escaping".
- Verified locally against `ffmpeg version 9.0.2-full_build-www.gyan.dev` on
  Windows 11.
