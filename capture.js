// Injected into the page on toolbar click. Scrolls the page a viewport at a
// time, asks the service worker for a shot of each, stitches them onto one
// canvas, and returns the result as a PNG data URL.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const html = document.documentElement;
  const root = document.scrollingElement || html;
  const seen = new Map(); // overlay element -> { saved style, which slice it shows on }

  // Kill scrollbars, smooth scrolling and animations for the duration.
  const freeze = document.createElement('style');
  freeze.textContent = `
    * { scroll-behavior: auto !important; scrollbar-width: none !important; }
    ::-webkit-scrollbar { display: none !important; }
    *, *::before, *::after { animation-play-state: paused !important; transition: none !important; }
  `;
  document.head.appendChild(freeze);

  // Measure with the scrollbar already hidden, it changes the layout width.
  const vw = html.clientWidth;
  const vh = innerHeight;

  // Mail clients and dashboards keep the document at viewport height and
  // scroll a pane inside it. When the document has nowhere to go, the biggest
  // scrollable pane on screen is what gets scrolled instead.
  // ponytail: one pane, and it has to cover a quarter of the viewport. Pages
  // with several panes side by side only get the biggest one unrolled.
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const left = Math.max(0, Math.ceil(r.left + el.clientLeft));
    const top = Math.max(0, Math.ceil(r.top + el.clientTop));
    const right = Math.min(vw, Math.floor(r.left + el.clientLeft + el.clientWidth));
    const bottom = Math.min(vh, Math.floor(r.top + el.clientTop + el.clientHeight));
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  let scroller = root;
  let box = { left: 0, top: 0, right: vw, bottom: vh, width: vw, height: vh };
  let maxScroll = Math.max(html.scrollHeight, document.body.scrollHeight) - vh;
  if (maxScroll <= 1) {
    let area = (vw * vh) / 4;
    for (const el of document.querySelectorAll('body *')) {
      if (el.scrollHeight - el.clientHeight <= 1) continue;
      if (!/auto|scroll|overlay/.test(getComputedStyle(el).overflowY)) continue;
      const b = visible(el);
      if (b.width * b.height <= area) continue;
      area = b.width * b.height;
      scroller = el;
      box = b;
      maxScroll = el.scrollHeight - el.clientHeight;
    }
  }
  maxScroll = Math.max(0, maxScroll);
  const startScroll = { x: scroller.scrollLeft, y: scroller.scrollTop };

  try {
    scroller.scrollTo(0, 0);
    await wait(150);

    // Overlays would otherwise repeat on every slice.
    //   sticky -> static, so it renders once at its natural place in the flow.
    //   fixed  -> shown on one slice only: bars anchored to the lower half of
    //             the viewport on the last, everything else on the first.
    //             Ones that sit clear of the scrolling area are left alone,
    //             they are part of the frame and only drawn once anyway.
    // Rescanned before every shot rather than once up front: plenty of apps
    // only turn an element sticky *after* you scroll, and a re-render happily
    // overwrites the style we just set.
    // ponytail: a full pass per slice, cheaper than tracking mutations. Swap in
    // a MutationObserver if it ever shows up in the capture time.
    const neutralize = () => {
      for (const el of document.querySelectorAll('body *')) {
        const pos = getComputedStyle(el).position;
        if (pos !== 'fixed' && pos !== 'sticky') continue;
        if (!seen.has(el)) {
          const r = el.getBoundingClientRect();
          if (pos === 'fixed') {
            if (!(r.width && r.height)) continue;
            if (r.bottom <= box.top || r.top >= box.bottom || r.right <= box.left || r.left >= box.right) continue;
          }
          seen.set(el, {
            saved: el.getAttribute('style'),
            slice: pos !== 'fixed' ? null : r.top > innerHeight / 2 ? 'last' : 'first',
          });
        }
        if (pos === 'sticky') el.style.setProperty('position', 'static', 'important');
      }
    };

    // The image is the viewport with the scrolling area unrolled to its full
    // length: whatever surrounds it is drawn once, above and below.
    const total = vh + maxScroll;
    const dpr = devicePixelRatio || 1;

    // Chrome refuses canvases past ~32k on a side or ~268M pixels.
    const scale = Math.min(
      1,
      32767 / (total * dpr),
      Math.sqrt(268000000 / (vw * dpr * total * dpr))
    );
    const px = (css) => Math.round(css * dpr * scale);

    const canvas = document.createElement('canvas');
    canvas.width = px(vw);
    canvas.height = px(total);
    const ctx = canvas.getContext('2d');

    // Copies a rectangle of the viewport from a shot, `dy` further down the image.
    const paint = (img, x, y, w, h, dy) => {
      if (w <= 0 || h <= 0) return;
      const sx = img.width / vw;
      const sy = img.height / vh;
      ctx.drawImage(
        img,
        x * sx, y * sy, w * sx, h * sy,
        px(x), px(y + dy), px(x + w) - px(x), px(y + dy + h) - px(y + dy)
      );
    };

    // Beside an unrolled pane there is nothing to show past the first
    // viewport, so those columns carry on in the colour they ended with.
    // Sampled a pixel at a time: a side is often several columns, a rail next
    // to a menu, each with a background of its own.
    const colours = new Map();
    const colourAt = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      if (colours.has(hit)) return colours.get(hit);
      let colour = '#fff';
      for (let el = hit; el; el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor;
        if (c === 'transparent' || c === 'rgba(0, 0, 0, 0)') continue;
        colour = c;
        break;
      }
      colours.set(hit, colour);
      return colour;
    };
    for (const [from, to] of [[0, box.left], [box.right, vw]]) {
      for (let x = from; x < to; x++) {
        ctx.fillStyle = colourAt(x + 0.5, box.bottom - 1);
        ctx.fillRect(px(x), 0, px(x + 1) - px(x), canvas.height);
      }
    }

    // Slices overlap, and the strip along the top and bottom edge of each is
    // thrown away. That is where apps draw what depends on the scroll offset -
    // a divider under the toolbar once you have scrolled, a shadow while there
    // is more below - and it would otherwise be stamped onto every slice.
    // The very top and the very end are kept, nothing is drawn there.
    const trim = Math.min(24, Math.floor(box.height / 4));
    const step = box.height - 2 * trim;

    for (let y = 0; y < maxScroll + step; y += step) {
      scroller.scrollTo(0, y);
      await wait(y === 0 ? 250 : 180); // settle, and let lazy images load
      const at = Math.round(scroller.scrollTop);
      const isLast = at >= maxScroll - 1;
      neutralize();
      for (const [el, rec] of seen) {
        if (!rec.slice) continue;
        const show = rec.slice === 'last' ? isLast : at === 0;
        el.style.setProperty('visibility', show ? 'visible' : 'hidden', 'important');
      }
      await wait(30);

      const dataUrl = await chrome.runtime.sendMessage({ type: 'grab' });
      if (!dataUrl) throw new Error('Chrome refused to capture this tab.');
      const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
      if (y === 0) paint(img, 0, 0, vw, box.bottom, 0);
      const cut = at > 0 ? trim : 0;
      paint(img, box.left, box.top + cut, box.width, box.height - cut - (isLast ? 0 : trim), at);
      if (isLast) paint(img, 0, box.bottom, vw, vh - box.bottom, maxScroll);
      img.close();
      if (isLast) break;
    }

    return { image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } finally {
    for (const [el, rec] of seen) {
      // Written first even when it is about to go: Chrome leaves an empty
      // style="" behind if the attribute was only ever set through el.style.
      el.setAttribute('style', rec.saved ?? '');
      if (rec.saved === null) el.removeAttribute('style');
    }
    freeze.remove();
    scroller.scrollTo(startScroll.x, startScroll.y);
  }
})();
