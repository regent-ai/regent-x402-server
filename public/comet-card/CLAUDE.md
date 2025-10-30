# comet-card gallery

Static gallery of 999 interactive Comet-style cards. Uses OGL UMD from UNPKG and lazy-starts shaders when cards enter the viewport. Each card title: "Regent Animata #[id]".

Files
- index.html – Page shell, loads style.css, OGL UMD, and script.js.
- style.css – Card layout, tilt styles, media slot.
- script.js – Builds 999 cards, IntersectionObserver + MAX_ACTIVE cap, minimal shader.
- metadata.example.json – Sample NFT metadata for one token.

Local usage
- Open public/comet-card/index.html in a browser.
- Hover/touch to tilt; canvas ignores pointer events so interactivity stays smooth.

NFT usage
- For token animation_url, use the single-file token.html at repo root: ipfs://<CID>/token.html?id=123.
- Provide image as a static preview per token for thumbnails.
