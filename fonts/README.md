# Fonts

- `manifest.json`: every bundled font in carousel order (`id`, `family`, `label`, `file`, `lang`, `style`, `legacy`). `lang` for Google fonts comes from the real cmap (`mr` = has क, ि and ्; `en` = has A to Z).
- `google/`: 44 Google Fonts families (45 files, Regular or variable, plus Playfair Display Italic), from github.com/google/fonts `ofl/`. All are licensed under the SIL Open Font License 1.1; each licence is in `google/licenses/<Family>-OFL.txt`. OFL allows bundling and commercial use; the fonts must not be sold on their own, and the licence must stay with them.
- `../custom-fonts/` (gitignored, optional): drop local or non-redistributable `.ttf`, `.otf`, `.woff` or `.woff2` files (including nested subfolders) into `custom-fonts/` at the repository root. On startup, Story Editor automatically imports them into `~/.config/story-editor/fonts/` using the same OpenType metadata and legacy Marathi (`ams`, `dg`, `infinity`) detection as **Import fonts**.

## Non-redistributable legacy fonts

Proprietary or members-only fonts (such as AMS / IndiaFont from ArtoMania Studio Pvt. Ltd. or DG fonts from DGTal Editz) are not open-licensed and must not be committed to the repository. Keep any personal copies in the gitignored `../custom-fonts/` folder or import them via the app UI, and verify the font vendor's licence before any commercial use.
