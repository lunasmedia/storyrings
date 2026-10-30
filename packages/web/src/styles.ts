import { type BarLayout, barCornerRadius } from '@stories/contracts/appearance';
import type { StoriesTheme } from '@stories/core';

/**
 * Layout variables. Item shape and size come from the dashboard's bar layout
 * when it's set, otherwise from the developer's code theme (round items of
 * `circleSize`). Title font and bar padding always come from the code theme.
 * Ring/badge/title colours come per item from the dashboard appearance.
 */
export function themeVars(t: StoriesTheme, layout?: BarLayout | null): string {
  const width = layout?.width ?? t.circleSize;
  const height = layout?.height ?? t.circleSize;
  const radius = layout ? barCornerRadius(layout) : t.circleSize / 2;
  return [
    `--s-size:${width}px`,
    `--s-h:${height}px`,
    `--s-r:${radius}px`,
    `--s-title-color:${t.titleColor}`,
    `--s-title-font:${t.titleFont}`,
    `--s-title-size:${t.titleSize}px`,
    `--s-pad:${t.barPadding}px`,
    `--s-gap:${layout?.gap ?? t.gap}px`,
  ].join(';');
}

export const srOnly =
  'position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';

// Ring animations only change transform/opacity, so they run on the compositor without repainting.
// Animated layers are clipped to the ring band (any shape), so they never cover the image.
export const BAR_CSS = `
:host{display:block}
.bar{padding:var(--s-pad);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity}
.bar::-webkit-scrollbar{display:none}
.list{display:flex;gap:var(--s-gap);margin:0;padding:0;list-style:none;width:max-content}
.list li{scroll-snap-align:start}
.item{all:unset;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;width:calc(var(--s-size) + 12px);padding-top:4px;cursor:pointer;-webkit-tap-highlight-color:transparent;border-radius:12px}
.item:focus-visible{outline:2px solid Highlight;outline:2px solid -webkit-focus-ring-color;outline-offset:2px}
.item[data-pointer-focus]:focus-visible{outline:none}
.c{display:flex;flex-direction:column;align-items:center;gap:8px;width:100%}
.ring{position:relative;box-sizing:border-box;display:block;width:var(--s-size);height:var(--s-h,var(--s-size));border-radius:var(--s-r,50%);padding:var(--c-ring-w);background:var(--c-ring);transition:transform .15s}
.seen .ring{background:var(--c-seen)}
.no-ring .ring{background:transparent}
.item:active .ring,.item[data-opening] .ring{transform:scale(.95)}
.gap{position:relative;z-index:1;display:block;box-sizing:border-box;width:100%;height:100%;border-radius:max(0px,calc(var(--s-r,50%) - var(--c-ring-w)));padding:var(--c-gap);background:var(--c-gap-color)}
.img{position:relative;display:block;width:100%;height:100%;border-radius:max(0px,calc(var(--s-r,50%) - var(--c-ring-w) - var(--c-gap)));overflow:hidden;background:#ddd}
.cover{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}
video.cover{opacity:0;transition:opacity .2s}
.playing video.cover{opacity:1}
.badge{position:absolute;z-index:2;box-sizing:border-box;padding:.12em .5em;border-radius:999px;border:2px solid var(--stories-ring-gap-color,Canvas);background:var(--c-badge-bg);color:var(--c-badge-fg);font:700 max(9px,calc(min(var(--s-size),var(--s-h,var(--s-size)))*.15))/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:.03em;white-space:nowrap}
.badge.bc{left:50%;bottom:0;transform:translate(-50%,45%)}
.badge.tr{right:-6%;top:-6%}
.no-ring .badge.tr{right:-4px;top:-4px}
.title{max-width:100%;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:var(--c-lines);line-clamp:var(--c-lines);text-align:center;word-break:break-word;font:var(--c-weight) var(--s-title-size)/1.25 var(--s-title-font);color:var(--c-title)}
.anim-rotate .ring,.anim-pulse .ring,.anim-shimmer .ring{isolation:isolate}
.anim-rotate .ring{background:none}
.spin,.shine{position:absolute;inset:0;z-index:-1;box-sizing:border-box;border-radius:inherit;padding:var(--c-ring-w);overflow:hidden;pointer-events:none;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}
.spin::before{content:"";position:absolute;left:50%;top:50%;width:calc(var(--s-size) + var(--s-h,var(--s-size)));aspect-ratio:1;background:var(--c-conic);translate:-50% -50%;animation:c-spin var(--c-speed) linear infinite;will-change:transform}
.anim-pulse .ring::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;box-shadow:0 0 0 var(--c-ring-w) var(--c-glow),0 0 calc(var(--c-ring-w) * 3) var(--c-glow);animation:c-pulse var(--c-speed) cubic-bezier(.2,.6,.35,1) infinite;will-change:transform,opacity}
.shine::after{content:"";position:absolute;top:0;bottom:0;left:0;width:55%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.85) 50%,transparent);animation:c-shimmer var(--c-speed) cubic-bezier(.45,.05,.55,.95) infinite;will-change:transform}
.pending,.skeleton{visibility:hidden}.skeleton .title{height:var(--s-title-size)}
.sr{${srOnly}}
@keyframes c-spin{to{transform:rotate(1turn)}}
@keyframes c-pulse{0%{transform:scale(1);opacity:.75}100%{transform:scale(1.3);opacity:0}}
@keyframes c-shimmer{0%{transform:translateX(-110%)}60%,100%{transform:translateX(200%)}}
@media (prefers-reduced-motion:reduce){.ring,.ring::after,.spin::before,.shine::after{animation:none!important;transition:none}.shine{display:none}video.cover{display:none}}
`;
