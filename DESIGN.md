# Dashboard direction

The dashboard answers one question for developers: where did my coding-agent tokens go, and when. Design read: a printed ledger for a developer audience, with one spot color. Dial ENERGY 3 / RHYTHM 3 / MOTION 2.

- **Ink on paper, one accent.** Warm paper and near-black ink carry everything. Vermilion appears only at key moments: the hero unit, the peak day, the selected range, the active view, and focus. Dark theme inverts the same palette; both themes ship and follow the system setting unless the user picks one.
- **Tools are told apart by texture, not hue.** Solid, hatch, dots, grid and tint patterns stay legible in both themes and without color vision. The same textures mark a tool in filters, bars, tags and the session drawer.
- **One dominant number.** The token total is set at display size. A ledger slip with dotted leaders holds the supporting figures. Cache-heavy totals get a computed sentence so the dominant category is stated, not implied.
- **The daily tape is the signature.** One tick per day (per week past 400 days). Dragging across it selects the period for the whole page; presets and arrow keys do the same without a pointer. The monthly table is the text equivalent.
- **Margin-note layout.** Sections hang a sticky label column beside the content, and each section changes composition: slip, split bar, tape, ranked bars with a weekday chart, stacked-texture project rows, numeral-first session list.
- **Type.** Manrope only, served locally (OFL). Heavy weights with tight tracking give the numerals presence; system monospace is reserved for file paths and error text, where literal characters matter.
- **Shape.** 3px radius on controls, square data marks, hairline rules, a 2px ink rule between sections. No gradients, glass, glow or illustration.
- **Motion.** GSAP counts the total up, grows bars from their baseline, staggers the tape, and slides the session drawer in. Nothing loops except the loading indicator. Reduced-motion preference is respected, including live changes.
- **States.** Loading, refresh, error with retry, and empty states each name their cause and offer the action that fixes it.

Implementation is the existing vanilla HTML, CSS and JavaScript. GSAP is the only runtime dependency. No framework, no CDN, no inline styles (the server's CSP forbids them).
