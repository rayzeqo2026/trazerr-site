# Design preview: Original 0 and themes 1-6

> **Update:** Brick & Ink (1) was chosen. It is now the public default, in light and a matching dark version switched by the moon/sun button. `DEFAULT` in the head script of `index.html` sets the public design (1); setting it to 0 restores the previous look. The other designs stay available on preview links for comparison until you ask for them to be removed. The privacy and terms pages use Brick & Ink colors and Public Sans.

This adds six alternative visual designs to trazerr.com next to the unchanged current design (Original 0), with a preview selector for comparing them. Nothing about the product, content, data, API calls, prompts or scoring changes. **The public site never shows the selector.**

## How to use it

**Where it is on:** the preview flag is `FLAG` in the small script at the top of `index.html` (search for `Design preview`).
- `"auto"` (current setting): on for `localhost`, `127.0.0.1` and Vercel preview links (`*.vercel.app`); off on `trazerr.com` and `www.trazerr.com`.
- `"on"` forces it on everywhere; `"off"` turns it off everywhere.

When the flag is off, the selector is hidden, saved choices and `?design=` links are ignored, and every visitor sees Original 0.

**Choosing a design:** a dark bar above the menu shows `Design preview: N/6 · Name` and buttons **0 1 2 3 4 5 6** (a dropdown on narrow screens). Results screens have the same dropdown next to Close. Switching never reloads the page, submits anything, or clears what you typed, uploaded or opened.

**Sharing a design:** add `?design=N` (0-6) to a preview link, for example `…vercel.app/?design=3`. A valid link wins over a saved choice; invalid values are ignored. Other query parameters and `#anchors` are kept.

**Clearing only the design choice:** in the browser console run `localStorage.removeItem("trazerr.designPreview")`. This touches nothing else (saved Career DNA and resumes use different keys).

**Rollback:** the untouched starting point is the branch `design-preview-baseline` (commit `5cf551f`, identical to what was live when this work began). To remove the feature, revert the design-preview commit(s) on `main` (`git revert <sha>`); this does not discard any other work.

**Later, promoting a design:** set that design's tokens as the public default (for example by applying `data-design="N"` at load when the flag is off), test it the same way, then delete the unused `:root[data-design="…"]` blocks, fonts entries and the selector. Not done yet, as requested.

## How it's built

- One page, one app. `index.html` gets `data-design="0"`…`"6"` on `<html>`. **Original 0 has no design styles at all**, so it renders exactly as before, including its own light/dark switch.
- Designs 1-6 are scoped to `:root[data-design="N"]`. Each defines semantic tokens (`--d-bg`, `--d-surface`, `--d-text`, `--d-action`, `--d-accent`, `--d-ev-*` evidence colors, fonts, radii, shadows, canvas colors). A shared layer maps the site's existing tokens onto them; no component logic contains design colors.
- Designs 1-6 have no dark variant (as requested); the light/dark switch is hidden while one is selected and your light/dark choice comes back when you return to 0.
- Fonts for a design load only when that design is chosen (never on the public site).
- Evidence meaning keeps its non-color cues in every design: solid dot = On your resume, ring = Between the lines, dashed ring = Worth exploring, dotted ring = Not shown yet, always with text labels.
- The tailored-resume preview, downloaded resumes (Word/PDF) and the share-card image keep their original look in every design.
- Choice stored under `trazerr.designPreview` (0-6, `0` is valid). No analytics events are sent for design switching.

Files: `index.html` (head script, preview bar markup, design CSS block, switching logic, canvas colors), `docs/DESIGN_PREVIEW.md` (this file). `api/app.js` and legal pages are unchanged by this work.

## The six designs

### 1 · Brick & Ink

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

### 2 · Oxblood & Ochre

**Font:** Figtree (400/600/700). Warm and confident. Oxblood leads (actions, dark bands); ochre appears as fills and edges, and as a darkened ochre for small labels. Warm paper background, rounded 16px cards, soft warm shadows.

| Role | Color |
|---|---|
| Page background (neutral, ~60%) | `#FBF6EE` |
| Cards and fields | `#FFFFFF` |
| Tinted sections | `#F3EADB` |
| Primary text | `#2A1717` |
| Secondary text and placeholders | `#5A4643` |
| Dominant: buttons, links, selected states (~30%) | `#7A1F2B` |
| Dominant, dark bands and result header | `#5E1621` |
| Supporting accent: rules, fills, edges (~10%, never text on light) | `#C8961E` |
| Supporting accent darkened for small labels | `#765110` |
| On your resume marker | `#2A1717` |
| Between the lines marker | `#765110` |
| Worth exploring marker | `#5A4E47` |
| Not shown yet marker | `#6F6560` |
| Focus ring | `#7A1F2B` |

**Measured contrast (WCAG 2.2 formula), key uses:**

| Foreground on background | Use | Ratio | Needed |
|---|---|---|---|
| `#2A1717` on `#FBF6EE` | Body text on page | 15.83:1 | 4.5:1 |
| `#2A1717` on `#FFFFFF` | Body text on cards | 17.03:1 | 4.5:1 |
| `#2A1717` on `#F3EADB` | Body text on tinted sections | 14.27:1 | 4.5:1 |
| `#5A4643` on `#FBF6EE` | Secondary text on page | 8.16:1 | 4.5:1 |
| `#5A4643` on `#FFFFFF` | Secondary text, placeholders on cards/fields | 8.78:1 | 4.5:1 |
| `#5A4643` on `#F3EADB` | Secondary text on tinted sections | 7.36:1 | 4.5:1 |
| `#7A1F2B` on `#FBF6EE` | Links on page | 9.48:1 | 4.5:1 |
| `#7A1F2B` on `#FFFFFF` | Links on cards | 10.20:1 | 4.5:1 |
| `#7A1F2B` on `#F3EADB` | Links on tinted sections | 8.55:1 | 4.5:1 |
| `#FFFFFF` on `#7A1F2B` | Primary button label | 10.20:1 | 4.5:1 |
| `#FFFFFF` on `#5E1621` | Primary button label, hover | 13.02:1 | 4.5:1 |
| `#7A1F2B` on `#FFFFFF` | White button label on dark bands | 10.20:1 | 4.5:1 |
| `#7A1F2B` on `#F6E6E3` | Selected chips / 'between the lines' badge | 8.43:1 | 4.5:1 |
| `#765110` on `#FBF6EE` | Kickers and chapter labels | 6.61:1 | 4.5:1 |
| `#765110` on `#F3EADB` | Kickers on tinted sections | 5.96:1 | 4.5:1 |
| `#765110` on `#F8EBCB` | Blanks to fill, example flag | 6.00:1 | 4.5:1 |
| `#FFFFFF` on `#5E1621` | Text on dark bands | 13.02:1 | 4.5:1 |
| `#F1DCD8` on `#5E1621` | Secondary text on dark bands | 9.90:1 | 4.5:1 |
| `#F2C45A` on `#5E1621` | Accent text on dark bands | 7.95:1 | 4.5:1 |
| `#B42318` on `#FFFFFF` | Error messages | 6.57:1 | 4.5:1 |
| `#8C7B6B` on `#FFFFFF` | Form field borders (non-text) | 4.07:1 | 3:1 |
| `#7A1F2B` on `#FBF6EE` | Focus ring (non-text) | 9.48:1 | 3:1 |
| `#7A1F2B` on `#FFFFFF` | Focus ring on cards (non-text) | 10.20:1 | 3:1 |
| `#2A1717` on `#FFFFFF` | 'On your resume' marker (non-text) | 17.03:1 | 3:1 |
| `#765110` on `#FFFFFF` | 'Between the lines' marker (non-text) | 7.11:1 | 3:1 |
| `#5A4E47` on `#FFFFFF` | 'Worth exploring' marker (non-text) | 8.03:1 | 3:1 |
| `#6F6560` on `#FFFFFF` | 'Not shown yet' marker (non-text) | 5.67:1 | 3:1 |
| `#765110` on `#F3EADB` | 'Between the lines' marker on tinted (non-text) | 5.96:1 | 3:1 |
| `#5A4E47` on `#F3EADB` | 'Worth exploring' marker on tinted (non-text) | 6.73:1 | 3:1 |

### 3 · Cobalt & Saffron

**Font:** Atkinson Hyperlegible (400/700). Clean and precise. Cobalt leads; saffron is used only as fills and thick underlines under labels, never as text on white. Flat surfaces with 1px rules, 8px corners. Atkinson Hyperlegible for maximum character distinction (I l 1, O 0).

| Role | Color |
|---|---|
| Page background (neutral, ~60%) | `#FFFFFF` |
| Cards and fields | `#FFFFFF` |
| Tinted sections | `#F2F5FC` |
| Primary text | `#0E1A33` |
| Secondary text and placeholders | `#43506B` |
| Dominant: buttons, links, selected states (~30%) | `#1846C8` |
| Dominant, dark bands and result header | `#0F2A6B` |
| Supporting accent: rules, fills, edges (~10%, never text on light) | `#F5B400` |
| Supporting accent darkened for small labels | `#7A5A00` |
| On your resume marker | `#0E1A33` |
| Between the lines marker | `#1846C8` |
| Worth exploring marker | `#7A5A00` |
| Not shown yet marker | `#667085` |
| Focus ring | `#1846C8` |

**Measured contrast (WCAG 2.2 formula), key uses:**

| Foreground on background | Use | Ratio | Needed |
|---|---|---|---|
| `#0E1A33` on `#FFFFFF` | Body text on page | 17.29:1 | 4.5:1 |
| `#0E1A33` on `#FFFFFF` | Body text on cards | 17.29:1 | 4.5:1 |
| `#0E1A33` on `#F2F5FC` | Body text on tinted sections | 15.85:1 | 4.5:1 |
| `#43506B` on `#FFFFFF` | Secondary text on page | 8.08:1 | 4.5:1 |
| `#43506B` on `#FFFFFF` | Secondary text, placeholders on cards/fields | 8.08:1 | 4.5:1 |
| `#43506B` on `#F2F5FC` | Secondary text on tinted sections | 7.41:1 | 4.5:1 |
| `#1846C8` on `#FFFFFF` | Links on page | 7.64:1 | 4.5:1 |
| `#1846C8` on `#FFFFFF` | Links on cards | 7.64:1 | 4.5:1 |
| `#1846C8` on `#F2F5FC` | Links on tinted sections | 7.00:1 | 4.5:1 |
| `#FFFFFF` on `#1846C8` | Primary button label | 7.64:1 | 4.5:1 |
| `#FFFFFF` on `#0F35A0` | Primary button label, hover | 10.31:1 | 4.5:1 |
| `#1846C8` on `#FFFFFF` | White button label on dark bands | 7.64:1 | 4.5:1 |
| `#1846C8` on `#E7EDFC` | Selected chips / 'between the lines' badge | 6.52:1 | 4.5:1 |
| `#7A5A00` on `#FFFFFF` | Kickers and chapter labels | 6.38:1 | 4.5:1 |
| `#7A5A00` on `#F2F5FC` | Kickers on tinted sections | 5.85:1 | 4.5:1 |
| `#7A5A00` on `#FFF1C7` | Blanks to fill, example flag | 5.67:1 | 4.5:1 |
| `#FFFFFF` on `#0F2A6B` | Text on dark bands | 13.43:1 | 4.5:1 |
| `#D3DDF5` on `#0F2A6B` | Secondary text on dark bands | 9.87:1 | 4.5:1 |
| `#FFC83D` on `#0F2A6B` | Accent text on dark bands | 8.68:1 | 4.5:1 |
| `#B42318` on `#FFFFFF` | Error messages | 6.57:1 | 4.5:1 |
| `#6B7894` on `#FFFFFF` | Form field borders (non-text) | 4.43:1 | 3:1 |
| `#1846C8` on `#FFFFFF` | Focus ring (non-text) | 7.64:1 | 3:1 |
| `#1846C8` on `#FFFFFF` | Focus ring on cards (non-text) | 7.64:1 | 3:1 |
| `#0E1A33` on `#FFFFFF` | 'On your resume' marker (non-text) | 17.29:1 | 3:1 |
| `#1846C8` on `#FFFFFF` | 'Between the lines' marker (non-text) | 7.64:1 | 3:1 |
| `#7A5A00` on `#FFFFFF` | 'Worth exploring' marker (non-text) | 6.38:1 | 3:1 |
| `#667085` on `#FFFFFF` | 'Not shown yet' marker (non-text) | 4.97:1 | 3:1 |
| `#1846C8` on `#F2F5FC` | 'Between the lines' marker on tinted (non-text) | 7.00:1 | 3:1 |
| `#7A5A00` on `#F2F5FC` | 'Worth exploring' marker on tinted (non-text) | 5.85:1 | 3:1 |

### 4 · Aubergine & Copper

**Font:** Lexend (400/500/600). Soft and roomy. Aubergine leads on ivory reading surfaces; copper marks section headings with a short bar. 20px corners, gentle shadows. Lexend for wide, open letterforms.

| Role | Color |
|---|---|
| Page background (neutral, ~60%) | `#FBF8F3` |
| Cards and fields | `#FFFFFF` |
| Tinted sections | `#F3ECE2` |
| Primary text | `#251A2C` |
| Secondary text and placeholders | `#574C5E` |
| Dominant: buttons, links, selected states (~30%) | `#4E1F66` |
| Dominant, dark bands and result header | `#3D1850` |
| Supporting accent: rules, fills, edges (~10%, never text on light) | `#C0621F` |
| Supporting accent darkened for small labels | `#963F10` |
| On your resume marker | `#251A2C` |
| Between the lines marker | `#5B2A76` |
| Worth exploring marker | `#963F10` |
| Not shown yet marker | `#6E6474` |
| Focus ring | `#963F10` |

**Measured contrast (WCAG 2.2 formula), key uses:**

| Foreground on background | Use | Ratio | Needed |
|---|---|---|---|
| `#251A2C` on `#FBF8F3` | Body text on page | 15.70:1 | 4.5:1 |
| `#251A2C` on `#FFFFFF` | Body text on cards | 16.63:1 | 4.5:1 |
| `#251A2C` on `#F3ECE2` | Body text on tinted sections | 14.18:1 | 4.5:1 |
| `#574C5E` on `#FBF8F3` | Secondary text on page | 7.62:1 | 4.5:1 |
| `#574C5E` on `#FFFFFF` | Secondary text, placeholders on cards/fields | 8.07:1 | 4.5:1 |
| `#574C5E` on `#F3ECE2` | Secondary text on tinted sections | 6.89:1 | 4.5:1 |
| `#5B2A76` on `#FBF8F3` | Links on page | 9.73:1 | 4.5:1 |
| `#5B2A76` on `#FFFFFF` | Links on cards | 10.31:1 | 4.5:1 |
| `#5B2A76` on `#F3ECE2` | Links on tinted sections | 8.79:1 | 4.5:1 |
| `#FFFFFF` on `#4E1F66` | Primary button label | 12.27:1 | 4.5:1 |
| `#FFFFFF` on `#3D1850` | Primary button label, hover | 14.53:1 | 4.5:1 |
| `#4E1F66` on `#FFFFFF` | White button label on dark bands | 12.27:1 | 4.5:1 |
| `#4E1F66` on `#F1E8F6` | Selected chips / 'between the lines' badge | 10.29:1 | 4.5:1 |
| `#963F10` on `#FBF8F3` | Kickers and chapter labels | 6.57:1 | 4.5:1 |
| `#963F10` on `#F3ECE2` | Kickers on tinted sections | 5.94:1 | 4.5:1 |
| `#963F10` on `#FBEADD` | Blanks to fill, example flag | 5.94:1 | 4.5:1 |
| `#FFFFFF` on `#3D1850` | Text on dark bands | 14.53:1 | 4.5:1 |
| `#E3D5EC` on `#3D1850` | Secondary text on dark bands | 10.38:1 | 4.5:1 |
| `#F4A26B` on `#3D1850` | Accent text on dark bands | 7.08:1 | 4.5:1 |
| `#B42318` on `#FFFFFF` | Error messages | 6.57:1 | 4.5:1 |
| `#857A8C` on `#FFFFFF` | Form field borders (non-text) | 4.07:1 | 3:1 |
| `#963F10` on `#FBF8F3` | Focus ring (non-text) | 6.57:1 | 3:1 |
| `#963F10` on `#FFFFFF` | Focus ring on cards (non-text) | 6.96:1 | 3:1 |
| `#251A2C` on `#FFFFFF` | 'On your resume' marker (non-text) | 16.63:1 | 3:1 |
| `#5B2A76` on `#FFFFFF` | 'Between the lines' marker (non-text) | 10.31:1 | 3:1 |
| `#963F10` on `#FFFFFF` | 'Worth exploring' marker (non-text) | 6.96:1 | 3:1 |
| `#6E6474` on `#FFFFFF` | 'Not shown yet' marker (non-text) | 5.62:1 | 3:1 |
| `#5B2A76` on `#F3ECE2` | 'Between the lines' marker on tinted (non-text) | 8.79:1 | 3:1 |
| `#963F10` on `#F3ECE2` | 'Worth exploring' marker on tinted (non-text) | 5.94:1 | 3:1 |

### 5 · Forest & Terracotta

**Font:** Public Sans (400/600/800). Grounded and structural. Forest green leads on stone neutrals; terracotta appears as offset block shadows and labels. 2px borders, 3px corners, heavy 800-weight headings.

| Role | Color |
|---|---|
| Page background (neutral, ~60%) | `#F6F4EE` |
| Cards and fields | `#FFFFFF` |
| Tinted sections | `#ECE8DD` |
| Primary text | `#1B2A22` |
| Secondary text and placeholders | `#4A5650` |
| Dominant: buttons, links, selected states (~30%) | `#1F5A42` |
| Dominant, dark bands and result header | `#1E3F31` |
| Supporting accent: rules, fills, edges (~10%, never text on light) | `#B55233` |
| Supporting accent darkened for small labels | `#983F24` |
| On your resume marker | `#1B2A22` |
| Between the lines marker | `#1F5A42` |
| Worth exploring marker | `#983F24` |
| Not shown yet marker | `#687069` |
| Focus ring | `#983F24` |

**Measured contrast (WCAG 2.2 formula), key uses:**

| Foreground on background | Use | Ratio | Needed |
|---|---|---|---|
| `#1B2A22` on `#F6F4EE` | Body text on page | 13.63:1 | 4.5:1 |
| `#1B2A22` on `#FFFFFF` | Body text on cards | 14.99:1 | 4.5:1 |
| `#1B2A22` on `#ECE8DD` | Body text on tinted sections | 12.24:1 | 4.5:1 |
| `#4A5650` on `#F6F4EE` | Secondary text on page | 6.97:1 | 4.5:1 |
| `#4A5650` on `#FFFFFF` | Secondary text, placeholders on cards/fields | 7.67:1 | 4.5:1 |
| `#4A5650` on `#ECE8DD` | Secondary text on tinted sections | 6.26:1 | 4.5:1 |
| `#1F5A42` on `#F6F4EE` | Links on page | 7.35:1 | 4.5:1 |
| `#1F5A42` on `#FFFFFF` | Links on cards | 8.08:1 | 4.5:1 |
| `#1F5A42` on `#ECE8DD` | Links on tinted sections | 6.60:1 | 4.5:1 |
| `#FFFFFF` on `#1F5A42` | Primary button label | 8.08:1 | 4.5:1 |
| `#FFFFFF` on `#174634` | Primary button label, hover | 10.70:1 | 4.5:1 |
| `#1F5A42` on `#FFFFFF` | White button label on dark bands | 8.08:1 | 4.5:1 |
| `#1F5A42` on `#E4EFE8` | Selected chips / 'between the lines' badge | 6.85:1 | 4.5:1 |
| `#983F24` on `#F6F4EE` | Kickers and chapter labels | 6.22:1 | 4.5:1 |
| `#983F24` on `#ECE8DD` | Kickers on tinted sections | 5.58:1 | 4.5:1 |
| `#983F24` on `#F7E3DA` | Blanks to fill, example flag | 5.52:1 | 4.5:1 |
| `#FFFFFF` on `#1E3F31` | Text on dark bands | 11.60:1 | 4.5:1 |
| `#D4E4DA` on `#1E3F31` | Secondary text on dark bands | 8.79:1 | 4.5:1 |
| `#F2A98F` on `#1E3F31` | Accent text on dark bands | 5.99:1 | 4.5:1 |
| `#B42318` on `#FFFFFF` | Error messages | 6.57:1 | 4.5:1 |
| `#7C7F72` on `#FFFFFF` | Form field borders (non-text) | 4.09:1 | 3:1 |
| `#983F24` on `#F6F4EE` | Focus ring (non-text) | 6.22:1 | 3:1 |
| `#983F24` on `#FFFFFF` | Focus ring on cards (non-text) | 6.84:1 | 3:1 |
| `#1B2A22` on `#FFFFFF` | 'On your resume' marker (non-text) | 14.99:1 | 3:1 |
| `#1F5A42` on `#FFFFFF` | 'Between the lines' marker (non-text) | 8.08:1 | 3:1 |
| `#983F24` on `#FFFFFF` | 'Worth exploring' marker (non-text) | 6.84:1 | 3:1 |
| `#687069` on `#FFFFFF` | 'Not shown yet' marker (non-text) | 5.11:1 | 3:1 |
| `#1F5A42` on `#ECE8DD` | 'Between the lines' marker on tinted (non-text) | 6.60:1 | 3:1 |
| `#983F24` on `#ECE8DD` | 'Worth exploring' marker on tinted (non-text) | 5.58:1 | 3:1 |

### 6 · Plum & Sage

**Font:** Figtree (400/600/700). Calm and distinctive. Plum leads; sage/emerald marks labels with a dot and edges the dark cards. Pill-shaped buttons (only in this design), 14px cards.

| Role | Color |
|---|---|
| Page background (neutral, ~60%) | `#F8F7FA` |
| Cards and fields | `#FFFFFF` |
| Tinted sections | `#EEEBF2` |
| Primary text | `#221A2B` |
| Secondary text and placeholders | `#54495F` |
| Dominant: buttons, links, selected states (~30%) | `#5B2A6E` |
| Dominant, dark bands and result header | `#3E1F4E` |
| Supporting accent: rules, fills, edges (~10%, never text on light) | `#7FA88E` |
| Supporting accent darkened for small labels | `#2B6A4F` |
| On your resume marker | `#221A2B` |
| Between the lines marker | `#5B2A6E` |
| Worth exploring marker | `#2B6A4F` |
| Not shown yet marker | `#6C6574` |
| Focus ring | `#5B2A6E` |

**Measured contrast (WCAG 2.2 formula), key uses:**

| Foreground on background | Use | Ratio | Needed |
|---|---|---|---|
| `#221A2B` on `#F8F7FA` | Body text on page | 15.73:1 | 4.5:1 |
| `#221A2B` on `#FFFFFF` | Body text on cards | 16.79:1 | 4.5:1 |
| `#221A2B` on `#EEEBF2` | Body text on tinted sections | 14.23:1 | 4.5:1 |
| `#54495F` on `#F8F7FA` | Secondary text on page | 7.89:1 | 4.5:1 |
| `#54495F` on `#FFFFFF` | Secondary text, placeholders on cards/fields | 8.42:1 | 4.5:1 |
| `#54495F` on `#EEEBF2` | Secondary text on tinted sections | 7.13:1 | 4.5:1 |
| `#5B2A6E` on `#F8F7FA` | Links on page | 9.83:1 | 4.5:1 |
| `#5B2A6E` on `#FFFFFF` | Links on cards | 10.49:1 | 4.5:1 |
| `#5B2A6E` on `#EEEBF2` | Links on tinted sections | 8.90:1 | 4.5:1 |
| `#FFFFFF` on `#5B2A6E` | Primary button label | 10.49:1 | 4.5:1 |
| `#FFFFFF` on `#461F56` | Primary button label, hover | 13.20:1 | 4.5:1 |
| `#5B2A6E` on `#FFFFFF` | White button label on dark bands | 10.49:1 | 4.5:1 |
| `#5B2A6E` on `#F1E8F5` | Selected chips / 'between the lines' badge | 8.80:1 | 4.5:1 |
| `#2B6A4F` on `#F8F7FA` | Kickers and chapter labels | 6.00:1 | 4.5:1 |
| `#2B6A4F` on `#EEEBF2` | Kickers on tinted sections | 5.43:1 | 4.5:1 |
| `#2B6A4F` on `#E3F0E8` | Blanks to fill, example flag | 5.46:1 | 4.5:1 |
| `#FFFFFF` on `#3E1F4E` | Text on dark bands | 13.90:1 | 4.5:1 |
| `#E4D8EC` on `#3E1F4E` | Secondary text on dark bands | 10.15:1 | 4.5:1 |
| `#A9D4B8` on `#3E1F4E` | Accent text on dark bands | 8.47:1 | 4.5:1 |
| `#B42318` on `#FFFFFF` | Error messages | 6.57:1 | 4.5:1 |
| `#80778A` on `#FFFFFF` | Form field borders (non-text) | 4.27:1 | 3:1 |
| `#5B2A6E` on `#F8F7FA` | Focus ring (non-text) | 9.83:1 | 3:1 |
| `#5B2A6E` on `#FFFFFF` | Focus ring on cards (non-text) | 10.49:1 | 3:1 |
| `#221A2B` on `#FFFFFF` | 'On your resume' marker (non-text) | 16.79:1 | 3:1 |
| `#5B2A6E` on `#FFFFFF` | 'Between the lines' marker (non-text) | 10.49:1 | 3:1 |
| `#2B6A4F` on `#FFFFFF` | 'Worth exploring' marker (non-text) | 6.41:1 | 3:1 |
| `#6C6574` on `#FFFFFF` | 'Not shown yet' marker (non-text) | 5.60:1 | 3:1 |
| `#5B2A6E` on `#EEEBF2` | 'Between the lines' marker on tinted (non-text) | 8.90:1 | 3:1 |
| `#2B6A4F` on `#EEEBF2` | 'Worth exploring' marker on tinted (non-text) | 5.43:1 | 3:1 |

### 1 · Brick & Ink, dark version

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

All 174 measured pairs pass (29 per design). Lowest text ratio: 5.43:1. Primary reading text: 13.6:1 to 17.3:1, above the 7:1 project goal.

## Test results

Environment: Chromium (Playwright) on Linux, desktop 1440×900 and phone 390×844, local server, fictional example data and mocked analysis (no real resumes, no live AI calls, no waitlist sign-ups).

| Area | Result |
|---|---|
| Original 0 vs saved baseline (computed styles on 48 elements, light and dark, desktop and phone) | **Passed**: 0 differences |
| Original 0 vs baseline screenshots (44 screens incl. results) | **Passed**: 0 changed pixels (preview bar hidden for comparison) |
| 0 → each design → 0 round trips (24: light/dark × desktop/phone × 6) | **Passed**: 24/24 identical, light/dark choice restored |
| Fresh start = 0; 0 persists; 5 persists; invalid stored values (9, abc, empty, 1.5, -1, 07) fall back to 0 | **Passed** |
| `?design=4` beats a saved 2; other parameters and #anchor kept; `?design=7` ignored | **Passed** |
| Flag off (non-preview host): selector hidden, `?design=3` and saved 5 ignored, design 0 | **Passed** |
| Storage blocked: page loads, switching works, no errors | **Passed** |
| Switching keeps pasted text, search, checkbox, open results dialog and its scroll position; no network requests | **Passed** |
| Switching during an analysis: one request only, result shown | **Passed** |
| Reading position after 8 switches (3 sections, desktop and phone) | **Passed**: within 3px |
| Selector reachable by Tab, arrow keys change design, visible focus ring | **Passed** |
| Visible 3px focus ring in each design | **Passed** (all 6) |
| axe-core 4.10 WCAG 2.0/2.1/2.2 A+AA, landing page + populated result, desktop and phone | **Passed** for designs 1-6: 0 violations. Original 0: see known issues |
| Reflow at 320px (= 1280px at 400%) and 640px (= 200%), with and without text-spacing overrides | **Passed**: no horizontal scrolling in any design |
| Reduced motion: no animated theme change; demo shows its still version | **Passed** |
| Forced colors (high contrast): evidence markers stay visible | **Passed** (checked design 4) |
| Color-vision simulations (protanopia, deuteranopia, tritanopia, grayscale) on evidence labels | **Passed** by visual inspection: shapes and labels stay distinct |
| Downloads (Word/PDF resume, share card) independent of designs | **Passed by code inspection** (no theme variables used); downloads not executed |
| Browser text-only enlargement to 200% | **Not tested** directly (zoom-equivalent reflow tested) |
| Screen reader | **Not tested** (none available in this environment) |
| Safari, Firefox, real phones | **Not tested** |
| Results-dialog focus trapping | **Not tested**; existing behavior, unchanged |

Automated checks and simulations don't prove full WCAG conformance; the untested items above still need a manual check.

## Known issues, logged separately (not changed)

- **Original 0, light mode:** the amber used for "Worth exploring", the "Example profile" tag and fill-in blanks is `#A8660A` on `#FFF3DF`, measuring 4.18:1 (needs 4.5:1). Found on the landing page (1) and in results (9). A one-line color change would fix it; not made, because 0 must stay the untouched baseline.
- Some chips in Original 0 are 40px tall (project goal 44px). In designs 1-6 they are 44px.
