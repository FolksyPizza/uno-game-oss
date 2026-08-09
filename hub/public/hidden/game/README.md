# SIXTY-SEVEN

An arcade precision game where **every** mode is built around the number **67**.
Start at 0, earn points under each mode's rules, and land on **exactly 67**.
Going over, running out of time, or hitting a hazard resets your attempt. A clean,
fast clear is a **Perfect 67** — it pays bonus coins and unlocks bonus levels.

## Run it

ES modules need to be served over HTTP (not opened as a `file://` path). From this
folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. (Any static server works, e.g. `npx serve`.)

## Modes

| Mode | Goal |
|------|------|
| **Collector** | Click falling numbers to bank their value — stop on 67. |
| **Adder** | Tap tiles that sum to exactly 67; overshoot resets the board. |
| **Stopper** | A counter races 0→99 — press Space / click to lock it on 67. |
| **Dodger** | Move (arrows / WASD / drag), grab orbs, avoid hazards, touch the 67 pad. |
| **Targets** | Click drifting targets to reach 67; avoid negative decoys. |

## Progress

- Clearing a level unlocks the next one. Progress, coins, best times and
  perfect-stars persist in `localStorage`.
- **Coins** buy **skins** in the shop (re-theme the avatar + HUD accent).
- **Bonus levels** (★) unlock after enough Perfect 67 runs.
- **Hard mode** (toggle on the menu) speeds everything up and tightens the
  perfect window for extra coins.

## Controls

- Mouse / touch: click or tap targets, tiles, buttons; drag to move in Dodger.
- Keyboard: arrows / WASD to move, **Space** to lock (Stopper), **P** / **Esc** to pause.

## Project layout

```
index.html            canvas + module entry
css/style.css         responsive layout
js/main.js            bootstrap + scene registration
js/engine/            loop, input, audio, storage, particles, game state machine, utils
js/mechanics/         base contract + the five modes
js/scenes/            boot, menu, levelSelect, shop, play, results
js/ui/                hud + reusable widgets
js/data/              levels (difficulty curve) + skins
```
