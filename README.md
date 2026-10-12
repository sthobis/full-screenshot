# Full Page Screenshot

Chrome extension. Click the toolbar icon, get the whole page in a new tab with
copy and download buttons.

## Install

1. `chrome://extensions` -> enable **Developer mode**
2. **Load unpacked** -> pick this folder

## How it works

`captureVisibleTab` only ever returns the viewport, so the page is scrolled a
viewport at a time and the shots are stitched onto one canvas at device pixel
ratio.

Apps like Gmail never scroll the document, they scroll a pane inside it. When
the document has nowhere to scroll, the biggest scrollable pane on screen is
scrolled instead, and the image is the viewport with that pane unrolled to its
full length. Whatever surrounds the pane - header, sidebar - is drawn once.

Slices overlap by a few pixels and the strip along the top and bottom edge of
each one is thrown away. Apps draw things there that depend on the scroll
offset - a divider under the toolbar once you have scrolled, a shadow while
there is more below - and they would otherwise show up once per slice.

The interesting part is overlays, which would otherwise repeat on every slice:

- `position: sticky` becomes `position: relative` with its offsets cleared, so
  the element renders once at its natural place in the document flow and
  popovers anchored inside it stay where they were.
- `position: fixed` elements are shown on a single slice and hidden for the
  rest - bars whose top sits in the lower half of the viewport go on the last
  slice, everything else (headers, chat bubbles) on the first.
- `position: fixed` elements as tall as the scrolling area - a sidebar, a modal
  backdrop - are instead grown by the scroll length and moved along with the
  scroll. They run down the whole image, laid out the way they would be in a
  window tall enough to show the page at once.
- Both passes run again before every shot, not once at the top. Apps commonly
  only turn a toolbar sticky once you have scrolled a little, and a re-render
  will overwrite whatever style the extension just set.

Scrollbars, smooth scrolling and animations are switched off while capturing,
and every change is reverted afterwards, including the original scroll offset.

## Known limits

- Vertical only. A page wider than the viewport is captured at viewport width.
- One scrolling area per capture. A pane is only unrolled when the document
  itself does not scroll, and it has to cover a quarter of the viewport.
- Very tall pages are scaled down to stay inside Chrome's canvas limits
  (~32k px per side).
- A full screen overlay - cookie banner, open modal - is captured as-is, its
  backdrop over the whole image. Dismiss it first.
- Content inside cross origin iframes and shadow DOM overlays is left alone.
