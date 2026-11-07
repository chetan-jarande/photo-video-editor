# Fonts

- `manifest.json`: every font in carousel order (`id`, `family`, `label`, `file`, `lang`, `style`, `legacy`). `lang` for Google fonts comes from the real cmap (`mr` = has क, ि and ्; `en` = has A to Z).
- `google/`: 44 Google Fonts families (45 files, Regular or variable, plus Playfair Display Italic), from github.com/google/fonts `ofl/`. All are licensed under the SIL Open Font License 1.1; each licence is in `google/licenses/<Family>-OFL.txt`. OFL allows bundling and commercial use; the fonts must not be sold on their own, and the licence must stay with them.
- `legacy/`: 18 user-provided non-Unicode Marathi fonts. They map Devanagari onto ASCII code points, so text must go through `LegacyMarathi.toLegacy(text, variant)` first (`variant` = the manifest `legacy` field: `ams`, `dg` or `infinity`).

## Licence warning for legacy fonts

- AMS fonts: "Copyright (c) 2017 ArtoMania Studio Pvt. Ltd. All rights reserved."
- DG fonts (DGTal Editz, Pune): the name tables say "Use Only Provided to 2nd DGMembers, One PC Or Device, Not for Corporate Use" (DG cALLY 17, DGCally-03, DGCally-23-D, DGCally-24) or "License to DGMembers only (use only, Not for share or sell)" (DGHand-06, DGHand-08).
- Some DG fonts contain licence-stamp glyphs:
  - DGCally-03: U+00B7 renders "All rights reserved to DGTal Editz, PERSONAL USE ONLY, DO NOT SHARE" and U+00B6 renders a similar Gujarati notice. 34 code points in total (U+00B6 to U+2219) hold stamps.
  - DGCally-24: U+00B6, U+00B7 and U+2219 render "DO NOT SHARE ANYWHERE / शेयर न करें".
  - The other DG files have no stamp glyphs.
- Check the licence for every legacy font before any commercial use or redistribution.
