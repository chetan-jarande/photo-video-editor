# Story Editor

A lightweight desktop editor for photos and videos with Instagram story style text tools. Built for Marathi and English typography, including old (non-Unicode) Marathi calligraphy fonts.

## Requirements

- Linux desktop with `make`
- Node.js 20 or newer (npm included)
- `ffmpeg` on your PATH for video export (`sudo apt install ffmpeg`). Photo editing works without it.

## Quick start

Once:

```sh
make setup
```

Every time:

```sh
make start
```

`make setup` installs the dependencies (Electron and Fabric.js) and, on Ubuntu 24.04 and newer, fixes the Chromium sandbox helper (asks for your sudo password). `make start` never installs anything; it only opens the editor.

| Command | What it does |
|---|---|
| `make setup` | One time: install dependencies, fix the sandbox if needed |
| `make start` | Open the editor (every time) |
| `make desktop` | Add "Story Editor" to your app launcher |
| `make test` | Run the Marathi converter and video export tests |
| `make smoke` | Launch, save a screenshot to `out/smoke.png`, quit |
| `make clean` | Remove `node_modules` and `out` (run `make setup` again after) |

### Why setup may ask for sudo

Ubuntu 24.04 and newer block the user namespaces Chromium's default sandbox needs, so Electron falls back to its `chrome-sandbox` helper, which must be owned by root with mode 4755. Without it Electron stops with "The SUID sandbox helper binary was found, but is not configured correctly". `make setup` runs `sudo chown root:root` and `sudo chmod 4755` on `node_modules/electron/dist/chrome-sandbox`, only when your system needs it.

## Features

**Text**
- Type or paste text, then click any font to apply it. 63 fonts are bundled: 18 old Marathi fonts (AMS, DG, Infinity), Unicode Marathi fonts (Yatra One, Kalam, Amita, Rozha One, Tiro Devanagari Marathi and more) and English script, calligraphy and display fonts.
- Instagram style presets: Classic, Modern, Neon, Typewriter, Strong, Elegant, Literature, Directional, Meme, Signature, Editor, Bubble, Deco, Poster, Squeeze, Journal. With Marathi text each preset picks a Marathi capable font.
- Animations: Typewriter, Fade, Rise, Pop, Bounce, Glow pulse, Shimmer, Sway. They play in the preview and are kept in MP4 exports.
- Background box (solid or translucent), shadow, neon glow, outline, alignment, size, line height, letter spacing.
- Long text wraps to fit the frame.

**Colour**
- Swatch row, full colour picker and recent colours.
- Eyedropper: press it, drag over the picture, release to pick.
- Apply colour to the text, its background box or its outline.

**Photo and video**
- Open a photo or video, or start blank (Story 9:16, Post 4:5, Square 1:1).
- Filters with live thumbnails, hold to compare, brightness, contrast, saturation, hue, blur.
- Video timeline with frame thumbnails, trim handles, playhead and mute.
- Per text "show from / to" times on videos.
- Draw with pen, marker, neon or arrow. Fill the frame with a colour.
- Emoji stickers and photo stickers (Ctrl+V pastes an image from the clipboard).
- Centre snap guides, rotation snapping, layers panel, undo and redo.
- Add music to any MP4 export.

**Export**
- Photo: PNG or JPG at full resolution, or an MP4 (5, 10 or 15 s) with animations and music.
- Video: MP4 (H.264 + AAC) at the source resolution.

## Fonts

### Importing fonts
In the Text panel use **Import fonts** (files) or **Import folder** (every `.ttf`, `.otf`, `.woff`, `.woff2` inside, subfolders included). You can also drag font files or folders onto the window. Imported fonts are copied to `~/.config/story-editor/fonts/` and appear under the **Imported** tab.

### Old Marathi fonts
Fonts such as AMS, DG and Infinity are not Unicode fonts: they draw Marathi letters in place of English keyboard characters. The editor stores what you typed and converts it for these fonts automatically (`src/legacy-marathi.js`), so you can paste normal Marathi text and just click the font.

Imported fonts whose file names start with AMS, DG, Infinity, Shree, Kruti, Shivaji or Akruti are detected as old Marathi fonts. For any other one, tick **Old Marathi font (non-Unicode)** when it is selected.

Known gaps:
- AMS Lekhan 1 draws ऊ incorrectly.
- DGFont-025 draws ठ्ठ and रू incorrectly.
- AMS and Infinity fonts have no stacked conjuncts, so letters such as ठ्ठ and द्ध are shown with a halant.

### Licences
- `fonts/google/` fonts are under the SIL Open Font License (texts in `fonts/google/licenses/`).
- The AMS and DG fonts in `fonts/legacy/` are not open licensed. The DG licences say members only, not for sharing or corporate use. Check before any commercial use. See `fonts/README.md`.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| V, T, D, S, A, L | Select, Text, Draw, Stickers, Adjust, Layers |
| Ctrl+O / Ctrl+E | Open / Export |
| Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y | Undo / Redo |
| Ctrl+D | Duplicate |
| Delete | Remove selection |
| Arrows (Shift for 10 px) | Nudge |
| Double click text | Edit text |
| Esc or Ctrl+Enter | Finish editing text |
| Ctrl+V | Paste an image as a sticker |
| Space | Play / pause video |
| I / O | Set trim in / out at the playhead |
| M | Mute video |

## Project layout

```
main.js                Electron main process: fonts, file dialogs, export
preload.js             The window.api bridge used by the UI
export.js              ffmpeg command builder for MP4 export
src/index.html         UI markup
src/styles.css         UI styles
src/app.js             Editor (Fabric.js canvas, text, colours, animations, video)
src/legacy-marathi.js  Unicode Marathi to old font converter
fonts/manifest.json    Bundled font list (family, file, language, style, legacy type)
fonts/google/          Open licensed Google Fonts
fonts/legacy/          Old Marathi fonts (AMS, DG, Infinity)
test/                  node:test suites
```

To add a bundled font, put the file in `fonts/google/` (or `fonts/legacy/`) and add an entry to `fonts/manifest.json`. Set `legacy` to `"ams"`, `"dg"` or `"infinity"` for old Marathi fonts, or `null` for Unicode fonts.

## Limits

- Music is not previewed in the editor, only in the exported file. On videos it replaces the clip's own sound.
- No background removal (cutout stickers), to keep the app light.
