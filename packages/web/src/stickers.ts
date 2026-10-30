import {
  type AnswerResultsDto,
  type AnswerStore,
  CORRECT_COLOR,
  countdownParts,
  type FeedInteractionDto,
  type FeedStoryDto,
  INTERACTION_UNITS,
  interactionLabels,
  percentages,
  placeInteraction,
  type StoredAnswer,
  storyLook,
  WRONG_COLOR,
} from '@stories/core';
import { h } from './dom.js';

/** What the stickers need from the viewer. */
export interface StickerHost {
  answers: AnswerStore | null;
  send(storyId: string, interactionId: string, value: number): Promise<AnswerResultsDto | null>;
  link(sticker: Extract<FeedInteractionDto, { kind: 'link' }>): void;
  /** Dragging the emoji slider holds the story. */
  hold(on: boolean): void;
}

/**
 * Interactive stickers (polls, quizzes, emoji sliders, links, countdowns) drawn over a story's
 * image, at the place the studio put them (spec/README.md, "Interactions").
 */
export class Stickers {
  readonly el = h('div', { class: 'stickers' });
  private timers: ReturnType<typeof setInterval>[] = [];
  private story: FeedStoryDto | null = null;
  private nodes = new Map<string, HTMLElement>();
  private resize =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.layout()) : null;

  constructor(private readonly host: StickerHost) {
    this.resize?.observe(this.el);
  }

  show(story: FeedStoryDto): void {
    this.clear();
    this.story = story;
    for (const i of story.interactions ?? []) {
      const node = h('div', { class: `sticker ${i.kind}`, 'data-id': i.id });
      node.style.setProperty('--a', i.accent);
      this.nodes.set(i.id, node);
      this.el.append(node);
      this.draw(node, i);
    }
    this.layout();
  }

  clear(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.nodes.clear();
    this.el.replaceChildren();
  }

  destroy(): void {
    this.clear();
    this.resize?.disconnect();
  }

  /** Places each sticker on the image as displayed (filling the frame, or shown whole in it, as the story says). */
  layout(): void {
    const story = this.story;
    const w = this.el.clientWidth;
    const hgt = this.el.clientHeight;
    if (!story || !w || !hgt) return;
    const media = story.width && story.height ? { width: story.width, height: story.height } : null;
    for (const i of story.interactions ?? []) {
      const node = this.nodes.get(i.id);
      if (!node) continue;
      const fit = storyLook(story).fit === 'fill' ? 'cover' : 'contain';
      const p = placeInteraction({ width: w, height: hgt }, media, fit, i);
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      node.style.width = `${p.width}px`;
      node.style.setProperty('--u', `${p.width / INTERACTION_UNITS}px`);
    }
  }

  private draw(node: HTMLElement, i: FeedInteractionDto): void {
    const story = this.story!;
    const saved = this.host.answers?.get(story.id, i.id);
    if (i.kind === 'link') {
      const b = h('button', { type: 'button', class: 'link-pill' }, `${i.label} ↗`);
      b.onclick = () => this.host.link(i);
      node.replaceChildren(b);
      return;
    }
    const card: (Node | string)[] = [];
    const q = i.kind === 'countdown' ? i.title : i.question;
    if (q) card.push(h('div', { class: i.kind === 'countdown' ? 'q t' : 'q' }, q));
    if (i.kind === 'poll' || i.kind === 'quiz') card.push(this.options(i, saved));
    else if (i.kind === 'slider') card.push(this.slider(node, i, saved));
    else card.push(this.countdown(i));
    node.replaceChildren(...card);
  }

  private answer(i: FeedInteractionDto, value: number, redraw: () => void) {
    const story = this.story!;
    const store = this.host.answers;
    const local: StoredAnswer = { value };
    store?.set(story.id, i.id, local);
    redraw();
    void this.host.send(story.id, i.id, value).then((results) => {
      if (!results) return;
      store?.set(story.id, i.id, { value, results });
      // Only if it's still showing.
      if (this.story?.id === story.id) redraw();
    });
  }

  private options(i: Extract<FeedInteractionDto, { kind: 'poll' | 'quiz' }>, saved?: StoredAnswer) {
    const list = h('div', { class: 'opts', role: 'group', 'aria-label': i.question || undefined });
    const counts = saved?.results?.counts;
    const pct = counts ? percentages(counts) : null;
    i.options.forEach((label, n) => {
      const chosen = saved?.value === n;
      const b = h('button', { type: 'button', class: 'opt' });
      if (saved) {
        b.disabled = true;
        const right = i.kind === 'quiz' && i.correct === n;
        const wrong = i.kind === 'quiz' && chosen && !right;
        const fill = h('span', { class: 'bar' });
        // Quizzes: the right answer and a wrong pick fill completely. Polls fill by their share
        // (without results, offline, the chosen option fills).
        const share = right || wrong ? 100 : pct ? pct[n]! : chosen ? 100 : 0;
        fill.style.width = `${share}%`;
        fill.style.background = right ? CORRECT_COLOR : wrong ? WRONG_COLOR : 'var(--a)';
        fill.style.opacity = right || wrong ? '.35' : chosen ? '.5' : '.3';
        const mark = wrong ? '✕ ' : chosen || right ? '✓ ' : '';
        b.append(fill, h('span', { class: 'l' }, `${mark}${label}`));
        if (pct) b.append(h('span', { class: 'p' }, `${pct[n]}%`));
        b.setAttribute('aria-label', pct ? interactionLabels.pollOption(label, pct[n]!) : label);
        if (chosen) b.setAttribute('aria-pressed', 'true');
      } else {
        b.append(h('span', { class: 'l' }, label));
        b.onclick = () => this.answer(i, n, () => this.redraw(i));
      }
      list.append(b);
    });
    return list;
  }

  private redraw(i: FeedInteractionDto) {
    const node = this.nodes.get(i.id);
    if (node) this.draw(node, i);
  }

  private slider(
    node: HTMLElement,
    i: Extract<FeedInteractionDto, { kind: 'slider' }>,
    saved?: StoredAnswer,
  ) {
    const track = h('div', {
      class: 'track',
      role: 'slider',
      tabindex: saved ? -1 : 0,
      'aria-label': interactionLabels.slider(i.question),
      'aria-valuemin': 0,
      'aria-valuemax': 100,
    });
    const fill = h('div', { class: 'fill2' });
    const thumb = h('div', { class: 'thumb' }, i.emoji);
    track.append(h('div', { class: 'rail' }), fill);
    let value = saved?.value ?? 0;
    const set = (v: number) => {
      value = Math.round(Math.max(0, Math.min(100, v)));
      track.setAttribute('aria-valuenow', String(value));
      // The thumb's centre travels between half a thumb from each end.
      const at = `calc(var(--u) * 36 + (100% - var(--u) * 72) * ${value / 100})`;
      thumb.style.left = at;
      fill.style.width = at;
    };
    set(value);
    track.append(thumb);
    if (saved?.results?.average !== undefined) {
      const avg = h('div', { class: 'avg', title: interactionLabels.sliderAverage });
      avg.style.left = `calc(var(--u) * 36 + (100% - var(--u) * 72) * ${saved.results.average / 100})`;
      track.append(avg);
    }
    if (saved) return track;

    const fromX = (x: number) => {
      const r = track.getBoundingClientRect();
      const u = r.width / INTERACTION_UNITS;
      set(((x - r.left - 36 * u) / (r.width - 72 * u)) * 100);
    };
    const done = () => this.answer(i, value, () => this.redraw(i));
    track.onpointerdown = (e) => {
      e.stopPropagation();
      track.setPointerCapture?.(e.pointerId);
      this.host.hold(true);
      fromX(e.clientX);
      track.onpointermove = (m) => fromX(m.clientX);
      track.onpointerup = track.onpointercancel = () => {
        track.onpointermove = track.onpointerup = track.onpointercancel = null;
        this.host.hold(false);
        done();
      };
    };
    track.onkeydown = (e) => {
      const step =
        e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? 10
          : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
            ? -10
            : 0;
      if (step) {
        e.preventDefault();
        e.stopPropagation();
        set(value + step);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        done();
      }
    };
    node.classList.add('live');
    return track;
  }

  private countdown(i: Extract<FeedInteractionDto, { kind: 'countdown' }>) {
    const row = h('div', { class: 'cd', role: 'timer' });
    const tick = () => {
      const c = countdownParts(i.endsAt);
      if (c.ended) {
        row.replaceChildren(h('div', { class: 'ended' }, interactionLabels.countdownEnded));
        return false;
      }
      row.replaceChildren(
        ...[c.days, c.hours, c.minutes, c.seconds].map((n, k) =>
          h(
            'div',
            { class: 'unit' },
            h('b', {}, String(n).padStart(2, '0')),
            h('span', {}, interactionLabels.countdownUnits[k]!),
          ),
        ),
      );
      return true;
    };
    if (tick()) {
      const t = setInterval(() => tick() || clearInterval(t), 1000);
      this.timers.push(t);
    }
    return row;
  }
}

/** Sizes are in units of var(--u) = displayed width / 600. */
export const STICKERS_CSS = `
.stickers{position:absolute;inset:0;pointer-events:none;z-index:2}
.sticker{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;touch-action:none}
.sticker:not(.link){background:#fff;border-radius:calc(var(--u)*28);padding:calc(var(--u)*28);box-shadow:0 calc(var(--u)*6) calc(var(--u)*24) rgba(0,0,0,.18)}
.q{font-size:calc(var(--u)*32);font-weight:700;line-height:1.25;text-align:center;margin-bottom:calc(var(--u)*20);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.q.t{color:var(--a);font-size:calc(var(--u)*28);font-weight:600}
.opts{display:flex;flex-direction:column;gap:calc(var(--u)*12)}
.opt{all:unset;position:relative;display:flex;align-items:center;justify-content:center;height:calc(var(--u)*76);border-radius:calc(var(--u)*38);background:#f1f3f5;overflow:hidden;cursor:pointer;font-size:calc(var(--u)*28);font-weight:600;padding:0 calc(var(--u)*24)}
.opt:disabled{cursor:default}
.opt .bar{position:absolute;left:0;top:0;bottom:0;transition:width .5s}
.opt .l{position:relative;flex:1;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.opt:disabled .l{text-align:left}
.opt .p{position:relative;font-size:calc(var(--u)*24);margin-left:calc(var(--u)*12)}
.opt:focus-visible,.track:focus-visible,.link-pill:focus-visible{outline:2px solid var(--a);outline-offset:2px}
.track{position:relative;height:calc(var(--u)*72);touch-action:none;cursor:pointer;outline:none}
.rail,.fill2{position:absolute;left:0;top:calc(var(--u)*29);height:calc(var(--u)*14);border-radius:calc(var(--u)*7)}
.rail{right:0;background:#e9ecef}
.fill2{background:var(--a)}
.thumb{position:absolute;top:0;width:calc(var(--u)*72);height:calc(var(--u)*72);margin-left:calc(var(--u)*-36);display:flex;align-items:center;justify-content:center;font-size:calc(var(--u)*64);line-height:1}
.avg{position:absolute;top:calc(var(--u)*22);width:calc(var(--u)*28);height:calc(var(--u)*28);margin-left:calc(var(--u)*-14);border-radius:50%;background:var(--a);border:calc(var(--u)*4) solid #fff;box-sizing:border-box}
.cd{display:flex;gap:calc(var(--u)*12)}
.unit{flex:1;text-align:center}
.unit b{display:block;font-size:calc(var(--u)*56);font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.unit span{display:block;font-size:calc(var(--u)*18);color:#868e96;margin-top:calc(var(--u)*4)}
.ended{font-size:calc(var(--u)*40);font-weight:700;text-align:center}
.link-pill{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;height:calc(var(--u)*84);border-radius:calc(var(--u)*42);background:#fff;color:var(--a);font-size:calc(var(--u)*30);font-weight:700;white-space:nowrap;overflow:hidden;cursor:pointer;box-shadow:0 calc(var(--u)*4) calc(var(--u)*16) rgba(0,0,0,.18)}
`;
