// Kept apart from styles.ts so the story bar's bundle doesn't carry the viewer's CSS.
import { srOnly } from './styles.js';

export const VIEWER_CSS = `
:host{all:initial}
*{box-sizing:border-box}
.backdrop{position:fixed;inset:0;z-index:2147483000;background:transparent;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;font:14px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#fff}
.dialog{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;outline:none}
.frame{position:relative;width:100%;height:100%;background:#000;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;transition:transform .2s,opacity .2s}
@media (min-width:600px){.backdrop{background:rgba(0,0,0,.92)}.frame{width:auto;height:min(92%,860px);aspect-ratio:9/16;max-width:100%;border-radius:12px}}
.frame.dragging{transition:none}
.media{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000}
.media img,.media video{position:absolute;width:100%;height:100%;object-fit:cover}
.overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.error{padding:24px;text-align:center;opacity:.8}
.shade{position:absolute;left:0;right:0;top:0;height:110px;background:linear-gradient(rgba(0,0,0,.55),transparent);pointer-events:none}
.progress{position:absolute;top:8px;left:8px;right:8px;display:flex;gap:4px;pointer-events:none}
.seg{flex:1;height:2.5px;border-radius:2px;background:rgba(255,255,255,.4);overflow:hidden}
.fill{height:100%;width:100%;background:#fff;transform-origin:left;transform:scaleX(0)}
.header{position:absolute;top:18px;left:16px;right:4px;display:flex;align-items:center;gap:8px;z-index:2}
.avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;background:#333}
.name{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.4)}
.btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;cursor:pointer;color:#fff}
.btn svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
.btn:focus-visible,.nav:focus-visible,.cta:focus-visible{outline:2px solid #fff;outline-offset:-2px;box-shadow:0 0 0 4px rgba(0,0,0,.6)}
.btn[hidden]{display:none}
.toast{position:absolute;left:50%;bottom:calc(96px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:3;padding:8px 14px;border-radius:999px;background:rgba(20,20,20,.85);color:#fff;font:600 14px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;white-space:nowrap;pointer-events:none}
.toast[hidden]{display:none}
.nav{all:unset;position:absolute;top:70px;bottom:90px;z-index:1;cursor:pointer}
.nav.prev{left:0;width:30%}
.nav.next{right:0;width:70%}
.cta-wrap{position:absolute;left:0;right:0;bottom:0;padding:16px 16px calc(24px + env(safe-area-inset-bottom));display:flex;justify-content:center;background:linear-gradient(transparent,rgba(0,0,0,.45));z-index:2}
.cta{all:unset;box-sizing:border-box;min-height:44px;max-width:100%;padding:12px 22px;border-radius:999px;background:#fff;color:#111;font-weight:600;text-align:center;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.3)}
.cta-wrap[hidden]{display:none}
.cta.dark{background:#111;color:#fff}
.cta.outline{background:none;color:#fff;box-shadow:inset 0 0 0 2px #fff;text-shadow:0 1px 2px rgba(0,0,0,.4)}
.cta-wrap.swipe,.cta-wrap.swipe-pill{flex-direction:column;align-items:center}
.cta-wrap.swipe::before,.cta-wrap.swipe-pill::before{content:"";width:14px;height:14px;margin:8px 0 4px;border:solid #fff;border-width:3px 0 0 3px;border-radius:2px;transform:rotate(45deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));animation:s-up 1.4s ease-in-out infinite}
.cta-wrap.swipe .cta{background:none;color:#fff;box-shadow:none;min-height:0;padding:4px 22px 10px;text-shadow:0 1px 3px rgba(0,0,0,.5)}
@keyframes s-up{50%{translate:0 -6px}}
.spinner{position:absolute;width:36px;height:36px;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:s-spin .8s linear infinite,s-in .2s .3s backwards;pointer-events:none}
.spinner[hidden]{display:none}
.sr{${srOnly}}
.backdrop.embedded{position:absolute;z-index:auto;background:#000;animation:none}
.backdrop.embedded .frame{width:100%;height:100%;aspect-ratio:auto;max-width:none;border-radius:0}
@keyframes s-in{from{opacity:0}}
@keyframes s-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.backdrop{animation:none}.frame{transition:none}.spinner{animation-duration:2s,.2s}.cta-wrap::before{animation:none}}
`;
