# CHUNKS Audio UI — Stitch Swiss Minimal

## Source
Design direction was pulled from the Stitch MCP project `Audio Analysis Dashboard` (`projectId: 8689072309239478105`), especially:
- `Audio Analyzer - Minimal Light Theme`
- `Audio Similarity Analyzer - Refined Light Theme`

## Direction
Swiss/editorial minimal interface for an audio analysis tool. No decorative gradients. White page, precise 1px borders, compact uppercase labels, and strong typographic hierarchy.

## Visual principles
- Background: plain white.
- Panels: white surfaces with `1px #e5e5e5` borders.
- Corners: square / near-zero radius.
- Shadow: none or extremely minimal.
- Layout: spacious, editorial, grid-based.
- Accent: CHUNKS red used sparingly for active tabs, primary CTA, selected states, and score accents.

## Typography
- Headline / labels: `Oswald`, uppercase, wide tracking.
- Body: `Be Vietnam Pro`, lightweight and readable.
- Hero: oversized uppercase headline with red accent word.

## Color tokens
- Primary red: `#bf080b`
- Primary hover: `#960005`
- Text: `#18181b`
- Muted: `#71717a`
- Border: `#e5e5e5`
- Subtle surface: `#f8f8f8`
- Background: `#ffffff`

## Components
- Header: sticky white translucent bar with real `logo.png`, compact nav tabs, and small guarantee pills.
- Hero: large editorial headline above analyzer workflow.
- Audio slots: white bordered panels, Source A/B labels, split upload/record controls.
- Preprocessing: two-column control strip with compact toggles.
- Method cards: grid of bordered cells; active state uses a very subtle red wash.
- Results: table-like cards and charts with strong hierarchy.
- Guide page: same white panel/1px border language.

## Guardrails
- Frontend only.
- Do not modify analysis logic in `src/`.
- Preserve all existing DOM IDs used by JavaScript.
