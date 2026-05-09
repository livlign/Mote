// Dynamic OG image as PNG. Used by the Bluesky bot's link card thumb
// (Bluesky's blob handler rejects SVG, so the bot needs a raster).
//
// Pipeline: fetch today's data → render SVG → resvg-wasm → PNG.

import initWasm, { Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { fetchToday, renderSVG } from "./_og_render.js";

let wasmReady;
async function ensureWasm() {
  if (!wasmReady) {
    wasmReady = initWasm(resvgWasm);
  }
  return wasmReady;
}

export async function onRequestGet() {
  await ensureWasm();
  const data = await fetchToday();
  const svg = renderSVG(data);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    // System fonts aren't available in Workers; resvg falls back to its
    // bundled font for unmatched families. The layout still reads — only
    // typeface fidelity changes vs. /og.svg.
    font: { loadSystemFonts: false },
  });
  const png = resvg.render().asPng();
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
