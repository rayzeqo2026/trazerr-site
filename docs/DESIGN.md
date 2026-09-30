# Design: Brick & Ink

Trazerr uses one design, Brick & Ink, in a light and a dark version. Visitors switch with the sun/moon button; the choice is saved in `trazerr.theme`.

## How it's built

- `index.html` sets `data-design="1"` and `data-theme="light"` or `"dark"` on `<html>` before the page draws, so there's no flash of the wrong theme.
- `assets/site.css` holds all styles. Brick & Ink defines semantic tokens (`--d-bg`, `--d-surface`, `--d-text`, `--d-action`, `--d-accent`, `--d-ev-*` evidence colors, radii, shadows) and canvas tokens (`--cv-*`) for the animated demo. A shared layer maps the site's older names (`--ink`, `--blue`, …) onto these tokens, so components never contain raw colors.
- The dark version overrides the same tokens under `:root[data-design="1"][data-theme="dark"]`.
- `assets/app.js` reads the canvas tokens (`readPalette`) so the demo animation matches the theme.
- Evidence meaning never relies on color alone: solid dot = On your resume, ring = Between the lines, dashed ring = Worth exploring, dotted ring = Not shown yet, always with a text label.
- The tailored-resume preview, downloaded resumes (Word/PDF) and the share-card image keep a fixed print look in both themes.
- `privacy.html`, `terms.html` and `stats.html` repeat the few tokens they need inline.

## Light

**Font:** Public Sans (400/600/700). Editorial and crisp. Ink blue leads (headings, actions, dark bands); brick is limited to short rules and labels. Square-ish 4-6px corners, almost no shadow.

| Role | Color |
|---|---|
| Page background (neutral, ~60%) | `#FFFFFF` |
| Cards and fields | `#FFFFFF` |
| Tinted sections | `#F6F4F0` |
| Primary text | `#16233F` |
| Secondary text and placeholders | `#4A5163` |
| Dominant: buttons, links, selected states (~30%) | `#1F3F82` |
| Dominant, dark bands and result header | `#16233F` |
| Supporting accent: rules, fills, edges (~10%, never text on light) | `#B42A1F` |
| Supporting accent darkened for small labels | `#A62419` |
| On your resume marker | `#16233F` |
| Between the lines marker | `#1F5FBF` |
| Worth exploring marker | `#8A5A00` |
| Not shown yet marker | `#6A6F7C` |
| Focus ring | `#B42A1F` |

**Measured contrast (WCAG 2.2 formula), key uses:**

| Foreground on background | Use | Ratio | Needed |
|---|---|---|---|
| `#16233F` on `#FFFFFF` | Body text on page | 15.60:1 | 4.5:1 |
| `#16233F` on `#FFFFFF` | Body text on cards | 15.60:1 | 4.5:1 |
| `#16233F` on `#F6F4F0` | Body text on tinted sections | 14.20:1 | 4.5:1 |
| `#4A5163` on `#FFFFFF` | Secondary text on page | 7.93:1 | 4.5:1 |
| `#4A5163` on `#FFFFFF` | Secondary text, placeholders on cards/fields | 7.93:1 | 4.5:1 |
| `#4A5163` on `#F6F4F0` | Secondary text on tinted sections | 7.22:1 | 4.5:1 |
| `#1F3F82` on `#FFFFFF` | Links on page | 10.04:1 | 4.5:1 |
| `#1F3F82` on `#FFFFFF` | Links on cards | 10.04:1 | 4.5:1 |
| `#1F3F82` on `#F6F4F0` | Links on tinted sections | 9.14:1 | 4.5:1 |
| `#FFFFFF` on `#1F3F82` | Primary button label | 10.04:1 | 4.5:1 |
| `#FFFFFF` on `#152E61` | Primary button label, hover | 13.16:1 | 4.5:1 |
| `#1F3F82` on `#FFFFFF` | White button label on dark bands | 10.04:1 | 4.5:1 |
| `#1F3F82` on `#E8EDF7` | Selected chips / 'between the lines' badge | 8.55:1 | 4.5:1 |
| `#A62419` on `#FFFFFF` | Kickers and chapter labels | 7.27:1 | 4.5:1 |
| `#A62419` on `#F6F4F0` | Kickers on tinted sections | 6.62:1 | 4.5:1 |
| `#A62419` on `#FBE9E6` | Blanks to fill, example flag | 6.20:1 | 4.5:1 |
| `#FFFFFF` on `#16233F` | Text on dark bands | 15.60:1 | 4.5:1 |
| `#C9D0E0` on `#16233F` | Secondary text on dark bands | 10.09:1 | 4.5:1 |
| `#FF9E90` on `#16233F` | Accent text on dark bands | 7.83:1 | 4.5:1 |
| `#B42318` on `#FFFFFF` | Error messages | 6.57:1 | 4.5:1 |
| `#7B7F8C` on `#FFFFFF` | Form field borders (non-text) | 3.99:1 | 3:1 |
| `#B42A1F` on `#FFFFFF` | Focus ring (non-text) | 6.38:1 | 3:1 |
| `#B42A1F` on `#FFFFFF` | Focus ring on cards (non-text) | 6.38:1 | 3:1 |
| `#16233F` on `#FFFFFF` | 'On your resume' marker (non-text) | 15.60:1 | 3:1 |
| `#1F5FBF` on `#FFFFFF` | 'Between the lines' marker (non-text) | 6.09:1 | 3:1 |
| `#8A5A00` on `#FFFFFF` | 'Worth exploring' marker (non-text) | 5.93:1 | 3:1 |
| `#6A6F7C` on `#FFFFFF` | 'Not shown yet' marker (non-text) | 5.03:1 | 3:1 |
| `#1F5FBF` on `#F6F4F0` | 'Between the lines' marker on tinted (non-text) | 5.55:1 | 3:1 |
| `#8A5A00` on `#F6F4F0` | 'Worth exploring' marker on tinted (non-text) | 5.40:1 | 3:1 |

## Dark

Used when a visitor switches to dark. Deep ink surfaces, the same brick accents; the primary button is a light blue with dark ink text so it reads clearly on dark backgrounds.

| Foreground on background | Use | Ratio | Needed |
|---|---|---|---|
| `#EEF1F7` on `#0E1628` | Body text on page | 15.94:1 | 4.5:1 |
| `#EEF1F7` on `#16213A` | Body text on cards | 14.14:1 | 4.5:1 |
| `#EEF1F7` on `#111B31` | Body text on tinted sections | 15.15:1 | 4.5:1 |
| `#B4BCCD` on `#0E1628` | Secondary text on page | 9.46:1 | 4.5:1 |
| `#B4BCCD` on `#16213A` | Secondary text, placeholders on cards/fields | 8.39:1 | 4.5:1 |
| `#B4BCCD` on `#111B31` | Secondary text on tinted sections | 8.99:1 | 4.5:1 |
| `#9DB8F5` on `#0E1628` | Links on page | 9.11:1 | 4.5:1 |
| `#9DB8F5` on `#16213A` | Links on cards | 8.08:1 | 4.5:1 |
| `#9DB8F5` on `#111B31` | Links on tinted sections | 8.66:1 | 4.5:1 |
| `#0B1426` on `#86A7F2` | Primary button label | 7.72:1 | 4.5:1 |
| `#0B1426` on `#A5BEF6` | Primary button label, hover | 9.89:1 | 4.5:1 |
| `#86A7F2` on `#16213A` | White button label on dark bands | 6.72:1 | 4.5:1 |
| `#86A7F2` on `#223358` | Selected chips / 'between the lines' badge | 5.24:1 | 4.5:1 |
| `#FF8F82` on `#0E1628` | Kickers and chapter labels | 8.16:1 | 4.5:1 |
| `#FF8F82` on `#111B31` | Kickers on tinted sections | 7.76:1 | 4.5:1 |
| `#FF8F82` on `#3A2329` | Blanks to fill, example flag | 6.54:1 | 4.5:1 |
| `#FFFFFF` on `#1E2E52` | Text on dark bands | 13.39:1 | 4.5:1 |
| `#D2D9E8` on `#1E2E52` | Secondary text on dark bands | 9.46:1 | 4.5:1 |
| `#FFA79B` on `#1E2E52` | Accent text on dark bands | 7.18:1 | 4.5:1 |
| `#FF8B7E` on `#16213A` | Error messages | 7.04:1 | 4.5:1 |
| `#7E8AA6` on `#16213A` | Form field borders (non-text) | 4.63:1 | 3:1 |
| `#FF8F82` on `#0E1628` | Focus ring (non-text) | 8.16:1 | 3:1 |
| `#FF8F82` on `#16213A` | Focus ring on cards (non-text) | 7.24:1 | 3:1 |
| `#EEF1F7` on `#16213A` | 'On your resume' marker (non-text) | 14.14:1 | 3:1 |
| `#8FB0F5` on `#16213A` | 'Between the lines' marker (non-text) | 7.39:1 | 3:1 |
| `#E8B65C` on `#16213A` | 'Worth exploring' marker (non-text) | 8.59:1 | 3:1 |
| `#98A1B4` on `#16213A` | 'Not shown yet' marker (non-text) | 6.16:1 | 3:1 |
| `#8FB0F5` on `#111B31` | 'Between the lines' marker on tinted (non-text) | 7.92:1 | 3:1 |
| `#E8B65C` on `#111B31` | 'Worth exploring' marker on tinted (non-text) | 9.21:1 | 3:1 |
| `#16233F` on `#FFFFFF` | Label on white buttons in dark bands | 15.60:1 | 4.5:1 |
| `#0B1426` on `#A5BEF6` | Primary button label, hover | 9.89:1 | 4.5:1 |

All 31 pairs pass; lowest text ratio 5.24:1; body text 15.9:1. axe-core WCAG A/AA: 0 violations on the landing page and a result, light and dark, desktop and phone.


## Checks

The automated tests in `tests/` run axe-core (WCAG 2.0/2.1/2.2 A and AA) on every page in both themes and check for sideways scrolling at 320, 390, 820 and 1280px on every change. See `docs/OPERATIONS.md`.
