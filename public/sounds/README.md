# Sound Files

Drop short MP3 (or OGG) clips here to enable in-game audio. The client
references these paths; missing files are silently ignored at runtime,
so the game works fine with no sounds.

| File              | Triggered when…                          |
| ----------------- | ---------------------------------------- |
| `play.mp3`        | You play a card                          |
| `draw.mp3`        | You draw from the pile                   |
| `uno.mp3`         | You press the UNO! button                |
| `your-turn.mp3`   | The active player rotates to you         |
| `win.mp3`         | The game ends (anyone wins)              |

## Suggested sources

- [Kenney UI Audio](https://kenney.nl/assets/ui-audio) — CC0
- [freesound.org](https://freesound.org/) — varies, check license

Keep clips short (≤500ms) and under ~15 KB each so they preload instantly.
