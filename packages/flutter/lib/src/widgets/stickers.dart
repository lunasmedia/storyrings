import 'dart:async';

import 'package:flutter/material.dart';

import '../../stories_core.dart';
import 'style.dart';

const _ink = Color(0xFF111111);
const _option = Color(0xFFF1F3F5);
const _rail = Color(0xFFE9ECEF);
const _unit = Color(0xFF868E96);

/// Interactive stickers (polls, quizzes, emoji sliders, links, countdowns) drawn over a story's
/// image, at the place the studio put them (spec/README.md, "Interactions"), placed with the
/// story's fit (covering the area, or shown whole in it). Only the stickers take touches;
/// elsewhere they reach the story's gestures underneath.
class StoryStickers extends StatelessWidget {
  const StoryStickers({
    super.key,
    required this.story,
    required this.answers,
    required this.onAnswer,
    required this.onLink,
    required this.hold,
  });

  final FeedStory story;
  final AnswerStore? answers;
  final void Function(Interaction sticker, int value) onAnswer;
  final void Function(LinkKind link) onLink;

  /// Dragging the emoji slider holds the story.
  final void Function(bool on) hold;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, box) => Stack(
          clipBehavior: Clip.none,
          children: [
            for (final i in story.interactions) _place(i, box),
          ],
        ),
      );

  Widget _place(Interaction i, BoxConstraints box) {
    final p = placeInteraction(
      containerWidth: box.maxWidth,
      containerHeight: box.maxHeight,
      mediaWidth: story.width?.toDouble(),
      mediaHeight: story.height?.toDouble(),
      cover: story.look.fills,
      x: i.x,
      y: i.y,
      width: i.width,
    );
    final u = p.width / interactionUnitsPerWidth;
    return Positioned(
      left: p.x - p.width / 2,
      top: p.y,
      width: p.width,
      // Centred on (x, y), whatever its height.
      child: FractionalTranslation(
        translation: const Offset(0, -0.5),
        child: MediaQuery.withNoTextScaling(
          child: _Sticker(
            key: ValueKey('${story.id}:${i.id}'),
            sticker: i,
            u: u,
            saved: answers?.get(story.id, i.id),
            onAnswer: (v) => onAnswer(i, v),
            onLink: onLink,
            hold: hold,
          ),
        ),
      ),
    );
  }
}

class _Sticker extends StatelessWidget {
  const _Sticker({
    super.key,
    required this.sticker,
    required this.u,
    required this.saved,
    required this.onAnswer,
    required this.onLink,
    required this.hold,
  });

  final Interaction sticker;
  final double u;
  final StoredAnswer? saved;
  final void Function(int value) onAnswer;
  final void Function(LinkKind link) onLink;
  final void Function(bool on) hold;

  Color get _accent => parseHex(sticker.accent, const Color(0xFFC2255C));

  @override
  Widget build(BuildContext context) {
    final k = sticker.kind;
    if (k is LinkKind) {
      return Semantics(
        link: true,
        child: GestureDetector(
          onTap: () => onLink(k),
          child: Container(
            height: 84 * u,
            alignment: Alignment.center,
            padding: EdgeInsets.symmetric(horizontal: 24 * u),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(42 * u),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.18), blurRadius: 16 * u, offset: Offset(0, 4 * u))
              ],
            ),
            child: Text(
              '${k.label} ↗',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: _accent, fontSize: 30 * u, fontWeight: FontWeight.w700),
            ),
          ),
        ),
      );
    }
    final title = switch (k) {
      PollKind(:final question) || QuizKind(:final question) || SliderKind(:final question) => question,
      CountdownKind(:final title) => title,
      _ => '',
    };
    return GestureDetector(
      // Touches that miss the controls stop here, so they never skip the story.
      onTap: () {},
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: EdgeInsets.all(28 * u),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(28 * u),
          boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: 0.18), blurRadius: 24 * u, offset: Offset(0, 6 * u))
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (title.isNotEmpty)
              Padding(
                padding: EdgeInsets.only(bottom: 20 * u),
                child: Text(
                  title,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: k is CountdownKind
                      ? TextStyle(color: _accent, fontSize: 28 * u, fontWeight: FontWeight.w600, height: 1.25)
                      : TextStyle(color: _ink, fontSize: 32 * u, fontWeight: FontWeight.w700, height: 1.25),
                ),
              ),
            switch (k) {
              PollKind(:final options) => _options(options, null),
              QuizKind(:final options, :final correct) => _options(options, correct),
              SliderKind() => _SliderTrack(
                  sticker: sticker,
                  emoji: k.emoji,
                  saved: saved,
                  accent: _accent,
                  u: u,
                  hold: hold,
                  onAnswer: onAnswer,
                ),
              CountdownKind(:final endsAt) => _Countdown(endsAt: endsAt, u: u),
              _ => const SizedBox(),
            },
          ],
        ),
      ),
    );
  }

  Widget _options(List<String> options, int? correct) {
    final saved = this.saved;
    final counts = saved?.results?.counts;
    final pct = counts == null ? null : percentages(counts);
    return Column(
      children: [
        for (var n = 0; n < options.length; n++) ...[
          if (n > 0) SizedBox(height: 12 * u),
          () {
            final chosen = saved?.value == n;
            final right = saved != null && correct == n;
            final wrong = saved != null && correct != null && chosen && !right;
            final share = right || wrong ? 100 : (pct != null && n < pct.length ? pct[n] : (chosen ? 100 : 0));
            final mark = saved == null ? '' : (wrong ? '✕ ' : (chosen || right ? '✓ ' : ''));
            final label = options[n];
            return Semantics(
              button: true,
              selected: chosen,
              enabled: saved == null,
              label: pct != null && n < pct.length ? InteractionLabels.pollOption(label, pct[n]) : label,
              excludeSemantics: true,
              child: GestureDetector(
                onTap: saved == null ? () => onAnswer(n) : null,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(38 * u),
                  child: Container(
                    height: 76 * u,
                    color: _option,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        if (saved != null)
                          FractionallySizedBox(
                            alignment: Alignment.centerLeft,
                            widthFactor: share / 100,
                            heightFactor: 1,
                            child: ColoredBox(
                              color: (right
                                      ? parseHex(interactionCorrectColor, Colors.green)
                                      : wrong
                                          ? parseHex(interactionWrongColor, Colors.red)
                                          : _accent)
                                  .withValues(alpha: right || wrong ? 0.35 : (chosen ? 0.5 : 0.3)),
                            ),
                          ),
                        Padding(
                          padding: EdgeInsets.symmetric(horizontal: 24 * u),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  '$mark$label',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  textAlign: saved == null ? TextAlign.center : TextAlign.start,
                                  style: TextStyle(color: _ink, fontSize: 28 * u, fontWeight: FontWeight.w600),
                                ),
                              ),
                              if (pct != null && n < pct.length)
                                Padding(
                                  padding: EdgeInsets.only(left: 12 * u),
                                  child: Text('${pct[n]}%',
                                      style: TextStyle(color: _ink, fontSize: 24 * u, fontWeight: FontWeight.w600)),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          }(),
        ],
      ],
    );
  }
}

class _SliderTrack extends StatefulWidget {
  const _SliderTrack({
    required this.sticker,
    required this.emoji,
    required this.saved,
    required this.accent,
    required this.u,
    required this.hold,
    required this.onAnswer,
  });

  final Interaction sticker;
  final String emoji;
  final StoredAnswer? saved;
  final Color accent;
  final double u;
  final void Function(bool on) hold;
  final void Function(int value) onAnswer;

  @override
  State<_SliderTrack> createState() => _SliderTrackState();
}

class _SliderTrackState extends State<_SliderTrack> {
  late int _value = widget.saved?.value ?? 0;

  int _at(double x, double width) {
    final u = widget.u;
    return (((x - 36 * u) / (width - 72 * u)) * 100).round().clamp(0, 100);
  }

  @override
  Widget build(BuildContext context) {
    final u = widget.u;
    final saved = widget.saved;
    final shown = saved?.value ?? _value;
    final question = (widget.sticker.kind as SliderKind).question;
    return LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth;
      double at(int v) => 36 * u + (w - 72 * u) * v / 100;
      return Semantics(
        slider: true,
        label: InteractionLabels.slider(question),
        value: '$shown%',
        onIncrease: saved == null ? () => setState(() => _value = (_value + 10).clamp(0, 100)) : null,
        onDecrease: saved == null ? () => setState(() => _value = (_value - 10).clamp(0, 100)) : null,
        onTap: saved == null ? () => widget.onAnswer(_value) : null,
        // Its own drag recogniser wins over the story's: the slider never swipes between stories.
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onHorizontalDragStart: saved != null
              ? null
              : (d) {
                  widget.hold(true);
                  setState(() => _value = _at(d.localPosition.dx, w));
                },
          onHorizontalDragUpdate: saved != null ? null : (d) => setState(() => _value = _at(d.localPosition.dx, w)),
          onHorizontalDragEnd: saved != null
              ? null
              : (_) {
                  widget.hold(false);
                  widget.onAnswer(_value);
                },
          onHorizontalDragCancel: saved != null ? null : () => widget.hold(false),
          child: SizedBox(
            height: 72 * u,
            child: Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.centerLeft,
              children: [
                Container(
                    height: 14 * u,
                    decoration: BoxDecoration(color: _rail, borderRadius: BorderRadius.circular(7 * u))),
                Container(
                  width: at(shown),
                  height: 14 * u,
                  decoration: BoxDecoration(color: widget.accent, borderRadius: BorderRadius.circular(7 * u)),
                ),
                if (saved?.results?.average case final avg?)
                  Positioned(
                    left: at(avg) - 14 * u,
                    child: Container(
                      width: 28 * u,
                      height: 28 * u,
                      decoration: BoxDecoration(
                        color: widget.accent,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 4 * u),
                      ),
                    ),
                  ),
                Positioned(
                  left: at(shown) - 36 * u,
                  child: SizedBox(
                    width: 72 * u,
                    height: 72 * u,
                    child: Center(child: Text(widget.emoji, style: TextStyle(fontSize: 56 * u))),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    });
  }
}

class _Countdown extends StatefulWidget {
  const _Countdown({required this.endsAt, required this.u});
  final DateTime endsAt;
  final double u;

  @override
  State<_Countdown> createState() => _CountdownState();
}

class _CountdownState extends State<_Countdown> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (countdownParts(widget.endsAt).ended) _timer?.cancel();
      setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final u = widget.u;
    final c = countdownParts(widget.endsAt);
    if (c.ended) {
      return Text(
        InteractionLabels.countdownEnded,
        textAlign: TextAlign.center,
        style: TextStyle(color: _ink, fontSize: 40 * u, fontWeight: FontWeight.w700),
      );
    }
    final values = [c.days, c.hours, c.minutes, c.seconds];
    return Semantics(
      container: true,
      child: Row(
        children: [
          for (var n = 0; n < 4; n++) ...[
            if (n > 0) SizedBox(width: 12 * u),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    values[n].toString().padLeft(2, '0'),
                    style: TextStyle(
                      color: _ink,
                      fontSize: 56 * u,
                      fontWeight: FontWeight.w700,
                      fontFeatures: const [FontFeature.tabularFigures()],
                      height: 1.1,
                    ),
                  ),
                  SizedBox(height: 4 * u),
                  Text(InteractionLabels.countdownUnits[n], style: TextStyle(color: _unit, fontSize: 18 * u)),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
