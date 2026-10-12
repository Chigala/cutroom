# Third-party notices

Cutroom's own code is under the [GNU AGPL-3.0](LICENSE). It builds on, bundles or downloads the work of
others, under their own licenses.

## Media in this repository

**Starter sound pack** (`apps/desktop/resources/starter-library/Sounds/Starter pack/`): 133 sound
effects from [Freesound](https://freesound.org), all CC0 1.0 (public domain), trimmed and evened out in
volume. Each one's title, maker and link is in the pack's `credits` field
(`apps/desktop/resources/starter-library/pack.json`).

**Onboarding and website demo footage** (`apps/client/public/onboarding/`, `apps/site/public/demo/`),
from [Pexels](https://www.pexels.com/license/), cut and edited. The people shown don't endorse
Cutroom.

- Talking: https://www.pexels.com/video/8136210/ (ANTONI SHKRABA production)
- Reaction: https://www.pexels.com/video/4994316/ (Tima Miroshnichenko)
- B-roll: https://www.pexels.com/video/28889095/ (Ammad Rasool)
- Website creator clip: https://www.pexels.com/video/6962123/ (cut, matted and tracked with Cutroom's own models)
- Tokyo at night: https://www.pexels.com/photo/20257063/

Their sounds, from Freesound, CC0: "small audience laughter" by cognito perceptu, "wipe1" by Sclolex,
"Pop Sound" by 4udiopony, "SUB OCEANO D" by uzerx.

**Agent marks** (`apps/client/src/components/AgentLogo.tsx`, `apps/site/src/ui/AgentLogos.tsx`): the
SVG paths come from [t3code](https://github.com/pingdotgg/t3code) (MIT). Claude is a trademark of
Anthropic and Codex of OpenAI; they're shown only to name the agents Cutroom works with.

**Fonts** come from the `@fontsource` packages, under the SIL Open Font License 1.1.

## Rendering and runtime libraries

- [Remotion](https://www.remotion.dev): video rendering. Source-available under the
  [Remotion License](https://www.remotion.dev/license): free for individuals and small companies; larger
  companies need a company license.
- [GSAP](https://gsap.com): the animation library graphics use, under its
  [standard no-charge license](https://gsap.com/standard-license/).
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript): runs Claude Code,
  under Anthropic's terms.
- The rest of the npm dependencies are under permissive licenses (MIT, ISC, BSD, Apache-2.0, MPL-2.0
  and the like): see each package's own license.

## Tools in the installers

`apps/desktop/scripts/bundle-tools.mts` puts these in each installer, with their notices:

- [FFmpeg](https://ffmpeg.org): prebuilt static builds (GPL-3.0), run as a separate program. Their
  source is linked from the installer's `NOTICES.txt`.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp): speech recognition, built from source (MIT).
- [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet): voice cleanup (MIT or Apache-2.0).

## Models downloaded on first use

Each downloads once, when first needed, checked against a pinned hash (`packages/media/src/models.ts`):

| Job | Model | License |
|---|---|---|
| Faces | YuNet (OpenCV) | MIT |
| People | YOLOX-Nano (Megvii) | Apache-2.0 |
| Sounds | PANNs CNN14, with Google's AudioSet labels | MIT (labels CC BY 4.0) |
| Cutouts | Robust Video Matting | GPL-3.0 |
| Cutouts (stills) | ISNet and U²-Net, via rembg | Apache-2.0 |
| Text on screen | PaddleOCR | Apache-2.0 |
| Voice and music apart | HT-Demucs | MIT |

Music found in the app comes from [Openverse](https://openverse.org) (CC0 or CC BY, credited in the
project). Stock footage, GIFs and stickers come from Pexels, Pixabay and KLIPY through each person's
own API keys, under those services' terms.
