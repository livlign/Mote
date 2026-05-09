import { fetchToday, renderSVG } from "./_og_render.js";

export async function onRequestGet() {
  const data = await fetchToday();
  const svg = renderSVG(data);
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
