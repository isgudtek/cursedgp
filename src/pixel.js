/**
 * Pixel typeface for the headings (TABLETOP GP, ONLINE 1V1, CHOOSE A CIRCUIT, GARAGE, HOW TO RACE and the section titles).
 * It matches the pixel R of the replay: blocky letters, a white glow, sizes on the 8 px grid so the pixels stay sharp.
 * Press Start 2P, by Cody Boisclair, under the SIL Open Font License (public/fonts/OFL.txt).
 */
const PIXEL_CSS = (base) => `
@font-face { font-family: 'GP Pixel'; src: url('${base}fonts/PressStart2P-Regular.ttf') format('truetype'); font-display: block; }
body #title h1, body #lobby h2, body #chooser h2, body #garage-pop h2, body #help-pop h2, body #help-pop h3 {
  font-family: 'GP Pixel', monospace !important; font-style: normal !important; font-weight: 400 !important;
  letter-spacing: 0 !important; text-transform: uppercase; color: #f4f6ff !important; line-height: 1.5 !important;
  text-shadow: 0 0 4px rgba(255,255,255,0.85), 0 0 14px rgba(160,210,255,0.55), 3px 3px 0 rgba(0,0,0,0.55) !important;
  -webkit-font-smoothing: none; font-smooth: never;
}
body #title h1 { font-size: 24px !important; white-space: nowrap; }
body #lobby h2, body #chooser h2, body #garage-pop h2, body #help-pop h2 { font-size: 16px !important; }
body #help-pop h3 { font-size: 8px !important; letter-spacing: 0 !important; color: #c9bfe0 !important; margin: 16px 0 8px !important; }
@media (max-width: 760px) { body #title h1 { font-size: 20px !important; } }
`;

export function installPixelHeadings(base = import.meta.env.BASE_URL) {
  if (document.getElementById('gp-pixel-style')) return;
  const st = document.createElement('style');
  st.id = 'gp-pixel-style';
  st.textContent = PIXEL_CSS(base);
  document.head.appendChild(st);
}
