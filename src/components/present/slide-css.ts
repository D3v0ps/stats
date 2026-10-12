// Slide styles. Sizes use container units (cqw/cqh) of the slide box, so the same slide is
// right on a 1920×1080 projector, a laptop, a phone, a print page and a thumbnail. Colours
// come from the surrounding theme (.theme-present: antracit canvas, white type).
//
// Plain CSS rendered once through React's <style precedence> (hoisted and deduplicated):
// container queries on the slide's own aspect ratio are awkward as utility classes, and the
// project's Turbopack CSS rule turns CSS modules into global CSS.

export const SLIDE_STYLE_ID = "mb-slide-styles";

export const SLIDE_CLASS = {
  slide: "mb-slide",
  frame: "mb-slide-frame",
  fade: "mb-slide-fade",
  kicker: "mb-slide-kicker",
  headline: "mb-slide-headline",
  body: "mb-slide-body",
  figure: "mb-slide-figure",
  number: "mb-slide-number",
  missing: "mb-slide-missing",
  delta: "mb-slide-delta",
  chart: "mb-slide-chart",
  footnote: "mb-slide-footnote",
  table: "mb-slide-table",
} as const;

export const SLIDE_CSS = `
.mb-slide {
  container-type: size;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--background);
  color: var(--foreground);
}

.mb-slide-frame {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 2.2cqh;
  /* At least 3.5rem top and bottom: the deck's controls sit there. */
  padding: max(6.5cqh, 3.5rem) 6.5cqw max(8cqh, 3.5rem);
}

.mb-slide-fade {
  animation: mb-slide-fade-in 420ms ease-out both;
}

@keyframes mb-slide-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.mb-slide-kicker {
  display: flex;
  align-items: center;
  gap: 0.9em;
  margin: 0;
  font-size: clamp(0.7rem, min(1.3cqw, 2.5cqh), 1.6rem);
  font-weight: 500;
  letter-spacing: 0.26em;
  line-height: 1.2;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

.mb-slide-kicker::before {
  content: "";
  flex: none;
  width: 2.4em;
  height: 0.2em;
  border-radius: 999px;
  background-color: #ff0c01;
}

.mb-slide-headline {
  margin: 0;
  font-size: calc(var(--headline-scale, 1) * clamp(1.6rem, min(6cqw, 12cqh), 9.5rem));
  font-weight: 400;
  line-height: 1.04;
  letter-spacing: 0.035em;
  text-wrap: balance;
  /* A single long word ("SJUKFRÅNVARON") must not run off a phone-sized slide. */
  overflow-wrap: break-word;
}

.mb-slide-body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 8fr);
  gap: 5cqw;
  margin-top: 2.5cqh;
}

.mb-slide-body[data-emphasis="number"] {
  grid-template-columns: minmax(0, 7fr) minmax(0, 6fr);
}

.mb-slide-body[data-visual="none"] {
  grid-template-columns: minmax(0, 1fr);
}

.mb-slide-body[data-visual="table"] {
  grid-template-columns: minmax(0, 4fr) minmax(0, 9fr);
}

.mb-slide-figure {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 2cqh;
  min-width: 0;
}

.mb-slide-number {
  margin: 0;
  font-size: calc(var(--number-scale, 1) * clamp(2.25rem, min(8.5cqw, 18cqh), 12rem));
  font-weight: 300;
  line-height: 0.92;
  letter-spacing: -0.015em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mb-slide-body[data-emphasis="number"] .mb-slide-number,
.mb-slide-body[data-visual="none"] .mb-slide-number {
  font-size: calc(var(--number-scale, 1) * clamp(2.75rem, min(11.5cqw, 25cqh), 17rem));
}

.mb-slide-missing {
  color: var(--muted-foreground);
}

.mb-slide-delta {
  font-size: clamp(1rem, min(2.3cqw, 4.6cqh), 3.4rem);
}

/* No hover tooltips: a slide shows nothing beyond its one message (clicks reach the deck). */
.mb-slide-chart {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  pointer-events: none;
}

.mb-slide-footnote {
  position: absolute;
  left: 6.5cqw;
  right: 6.5cqw;
  bottom: 2.8cqh;
  margin: 0;
  font-size: clamp(0.6rem, 1cqw, 1rem);
  color: var(--muted-foreground);
}

.mb-slide-table {
  width: 100%;
  border-collapse: collapse;
  font-size: calc(var(--table-scale, 1) * clamp(0.8rem, min(1.7cqw, 3.2cqh), 2.2rem));
  font-variant-numeric: tabular-nums;
}

.mb-slide-table thead th {
  padding: 0 0.8em 0.6em 0;
  font-size: 0.62em;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-align: right;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

.mb-slide-table thead th:first-child {
  text-align: left;
}

.mb-slide-table tbody th,
.mb-slide-table td {
  padding: 0.42em 0.8em 0.42em 0;
  border-top: 1px solid var(--border);
  white-space: nowrap;
}

/* The label column takes the room the numbers leave and truncates, so the table never
   overflows a narrow slide (max-width: 0 lets an auto-layout cell shrink below its text). */
.mb-slide-table tbody th {
  width: 100%;
  max-width: 0;
  overflow: hidden;
  font-weight: 400;
  text-align: left;
  text-overflow: ellipsis;
}

.mb-slide-table td {
  text-align: right;
}

.mb-slide-table tr[data-total] th,
.mb-slide-table tr[data-total] td {
  font-weight: 600;
}

/* Portrait and near-square boxes (phones, narrow windows): stack number above the chart. */
@container (max-aspect-ratio: 23 / 20) {
  .mb-slide-frame {
    gap: 1.6cqh;
    padding: max(5cqh, 3.5rem) 6cqw max(7cqh, 3.5rem);
  }

  .mb-slide-kicker {
    font-size: clamp(0.65rem, 2.8cqw, 1rem);
  }

  .mb-slide-headline {
    font-size: calc(var(--headline-scale, 1) * clamp(1.5rem, 9cqw, 4.5rem));
  }

  .mb-slide-body,
  .mb-slide-body[data-emphasis="number"],
  .mb-slide-body[data-visual="table"] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 3cqh;
  }

  .mb-slide-number,
  .mb-slide-body[data-emphasis="number"] .mb-slide-number,
  .mb-slide-body[data-visual="none"] .mb-slide-number {
    font-size: calc(var(--number-scale, 1) * clamp(2.5rem, 17cqw, 8rem));
  }

  .mb-slide-delta {
    font-size: clamp(1rem, 4.5cqw, 1.75rem);
  }

  .mb-slide-table {
    font-size: calc(var(--table-scale, 1) * clamp(0.75rem, 3.6cqw, 1.1rem));
  }
}

/*
 * Miniatures (editor preview, archive thumbnails): purely proportional, without the
 * minimum sizes that keep text readable on phones. Placed last so it wins over the above.
 */
.mb-slide[data-fit="exact"] .mb-slide-frame {
  padding: 6.5cqh 6.5cqw 8cqh;
}

.mb-slide[data-fit="exact"] .mb-slide-kicker {
  font-size: min(1.3cqw, 2.5cqh);
}

.mb-slide[data-fit="exact"] .mb-slide-headline {
  font-size: calc(var(--headline-scale, 1) * min(6cqw, 12cqh));
}

.mb-slide[data-fit="exact"] .mb-slide-number {
  font-size: calc(var(--number-scale, 1) * min(8.5cqw, 18cqh));
}

.mb-slide[data-fit="exact"] .mb-slide-body[data-emphasis="number"] .mb-slide-number,
.mb-slide[data-fit="exact"] .mb-slide-body[data-visual="none"] .mb-slide-number {
  font-size: calc(var(--number-scale, 1) * min(11.5cqw, 25cqh));
}

.mb-slide[data-fit="exact"] .mb-slide-delta {
  font-size: min(2.3cqw, 4.6cqh);
}

.mb-slide[data-fit="exact"] .mb-slide-table {
  font-size: calc(var(--table-scale, 1) * min(1.7cqw, 3.2cqh));
}

.mb-slide[data-fit="exact"] .mb-slide-footnote {
  font-size: 1cqw;
}
`;
