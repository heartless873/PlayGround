# PlayGround

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://go.ondev.store/).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://go.ondev.store/heartless873/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/heartless873/PlayGround)

- 🎮 [Open the project](https://go.ondev.store/heartless873/PlayGround).
- ✨ [Remix this project](https://go.ondev.store/heartless873/PlayGround?remix=1).
- 💻 [Explore the source](https://github.com/heartless873/PlayGround).
- 🛠️ [Check build runs](https://github.com/heartless873/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/heartless873/PlayGround/issues).
- 👤 [Explore the creator's projects](https://go.ondev.store/heartless873).
- 🌍 [Create with OMGithub](https://go.ondev.store/).
<!-- omgithub:readme:end -->

---

# YOU WERE NEVER ALONE

A first-person psychological horror game. You wake at **3:17 AM** in a locked apartment. Your phone shows a message from your own contact, timestamped **tomorrow**:

> “Don't turn around. I'm trying to keep it away from you.”

The apartment is not empty. Something called **The Tenant** lives in it — and it learns.

## Play

Open `index.html` through any static server (or use `./start.sh`, which serves the page on the preview port).

- **WASD** — move
- **Mouse** — look
- **E** — interact / hide
- **F** — flashlight
- **TAB** — phone
- **SHIFT / C** — run / sneak
- **Esc** — pause

Headphones are recommended. There is no chase music and no jump-scare montage.

## What it does

- **A shifting apartment.** Doors, photographs, chairs and small objects move when you are not looking. The hallway can become longer.
- **The Tenant learns.** It remembers how often you check behind you, which closets you hide in, which rooms you spend time in, whether you run or sneak, and how many nights you have played. The profile is saved in `localStorage` under `ywna_profile_v2`, so the next night is different.
- **Three proofs, three ways out.**
  - **ENDING I — YOU LEFT** — power the deadbolt, use the spare key, walk out.
  - **ENDING II — REPLACEMENT** — find the copy of the living room and sit on the sofa.
  - **ENDING III — THE TRUTH, SUCH AS IT IS** — collect the diary, the photograph and the VHS tape, then face the bathroom mirror.
- **The iconic room.** A second living room appears behind the hallway wallpaper: the same sofa, the same television, and someone seated facing away. The television shows a live feed from an impossible angle. Look away and the seated figure is gone; come back and it is standing.

## Technical notes

- Three.js `0.160` loaded through an import map from a CDN — no build step.
- Everything is procedural: walls, wood, tiles, fabric, rugs, wallpaper, the night-city view, and the photographs are generated on canvas at load time. No external textures or models.
- Real mirror reflection via `Reflector`, plus a live TV render target fed by a second camera.
- Positional audio (knocks, footsteps, breathing, whispers, room tone) is synthesized with the Web Audio API.
- The whole game is `index.html` + `game.js`. `screenshots/` contains QA captures of every room and all three endings.

*The apartment is stylized and low-poly on purpose. The fear is supposed to come from what is almost right.*
