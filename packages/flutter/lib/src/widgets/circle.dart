import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'package:video_player/video_player.dart';

import '../../stories_core.dart';
import 'energized.dart';
import 'style.dart';

/// Energized cards: the circle in the middle is this share of the card's width.
const energizedAvatarShare = 0.5;

/// One item in the story bar: cover, ring, badge and title, in the dashboard's style.
class StoryCircle extends StatefulWidget {
  const StoryCircle({
    super.key,
    required this.group,
    required this.width,
    required this.height,
    required this.radius,
    required this.seen,
    required this.onTap,
    required this.theme,
    this.opening = false,
    this.held = false,
    this.preview,
    this.previewTurn = 0,
    this.card = false,
  });

  final FeedGroup group;
  final double width;
  final double height;
  final double radius;
  final bool seen;
  final VoidCallback onTap;
  final StoriesTheme theme;

  /// Its viewer is opening (waiting for the first story): shown dimmed, as pressed.
  final bool opening;

  /// Energized style: its viewer is open, opened while this card previewed: the circle stays
  /// aside until the preview shows again (or moves on to another card).
  final bool held;

  /// Energized style: the story previewing in this card now, if any.
  final FeedStory? preview;

  /// Changes each time a preview starts, so the same story starts again.
  final int previewTurn;

  /// Energized style: drawn as a story card with the circle in the middle; false = a circle.
  final bool card;

  @override
  State<StoryCircle> createState() => _StoryCircleState();
}

class _StoryCircleState extends State<StoryCircle> with SingleTickerProviderStateMixin {
  /// Energized style: the preview turn whose story is showing (the circle steps aside for it).
  int? _shownTurn;

  /// Energized style: the circle stays aside while the viewer opened from this card's preview is
  /// open, and until the preview shows again after it closes.
  bool _keepAside = false;

  /// Energized style: the card's still couldn't load, so it shows the cover instead.
  bool _stillFailed = false;
  late final AnimationController _anim = AnimationController(vsync: this);

  RingStyle get _ring => widget.group.appearance.ring;

  bool _animates(BuildContext context) =>
      _ring.style != 'none' &&
      _ring.animation != 'none' &&
      !(widget.seen && _ring.animateOnlyUnseen) &&
      !MediaQuery.of(context).disableAnimations;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(StoryCircle old) {
    super.didUpdateWidget(old);
    if (widget.held) {
      _keepAside = true;
    } else if (widget.preview == null) {
      _keepAside = false;
    }
    if (old.group.stories.firstOrNull?.url != widget.group.stories.firstOrNull?.url) _stillFailed = false;
    _sync();
  }

  VideoPlayerController? _cover;
  String? _coverUrl;

  /// Animated (GIF) covers: a looping muted video, not with Reduce Motion.
  void _syncCover() {
    final url = MediaQuery.of(context).disableAnimations ? null : widget.group.coverVideoUrl;
    if (url == _coverUrl) return;
    _coverUrl = url;
    _cover?.dispose();
    _cover = null;
    if (url == null) return;
    final c =
        VideoPlayerController.networkUrl(Uri.parse(url), videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true));
    _cover = c;
    c
      ..setVolume(0)
      ..setLooping(true);
    c.initialize().then((_) {
      if (!mounted || _cover != c) return;
      c.play();
      setState(() {});
    }, onError: (_) {
      // The still image stays.
      if (mounted && _cover == c) setState(() => _cover = null);
    });
  }

  void _sync() {
    _syncCover();
    if (_animates(context)) {
      _anim.duration = Duration(milliseconds: speedMs[_ring.speed] ?? 2400);
      if (!_anim.isAnimating) _anim.repeat();
    } else {
      _anim.stop();
    }
  }

  @override
  void dispose() {
    _cover?.dispose();
    _anim.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.group.appearance;
    final textColor = DefaultTextStyle.of(context).style.color ?? Colors.black;
    final titleColor = a.title.color == 'inherit' ? textColor : parseHex(a.title.color, textColor);
    final seen = widget.seen;
    final position = StoriesLabels.openGroup(widget.group.title, widget.group.stories.length, seen);

    final circle = _circle(widget.width, widget.height, widget.radius);

    return Semantics(
      button: true,
      label: position,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: widget.onTap,
        behavior: HitTestBehavior.opaque,
        child: SizedBox(
          // Items are wider than the ring by the title allowance, like the other SDKs.
          width: widget.width + 12,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (widget.card)
                Opacity(opacity: widget.opening ? 0.7 : 1, child: _card())
              else
                Opacity(opacity: widget.opening ? 0.7 : 1, child: circle),
              if (!widget.card && !a.title.hidden && !widget.theme.hideTitles) ...[
                const SizedBox(height: 6),
                Text(
                  widget.group.title,
                  maxLines: a.title.maxLines,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: (widget.theme.titleStyle ?? const TextStyle()).copyWith(
                    fontSize: widget.theme.titleSize,
                    color: titleColor,
                    fontWeight: FontWeight.values[(a.title.weight ~/ 100 - 1).clamp(0, 8)],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// The circle: cover, ring (style, animation, seen colour) and badge.
  Widget _circle(double width, double height, double radius) {
    final a = widget.group.appearance;
    final ringWidth = _ring.style == 'none' ? 0.0 : _ring.width.toDouble();
    final inset = ringWidth + (_ring.style == 'none' ? 0 : _ring.gap.toDouble());
    final innerRadius = math.max(0.0, radius - inset);
    final label = a.badgeLabel(widget.group.endsAt);
    final seen = widget.seen;
    return SizedBox(
      width: width,
      height: height,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned.fill(
            child: AnimatedBuilder(
              animation: _anim,
              builder: (context, _) => CustomPaint(
                painter: _RingPainter(
                  ring: _ring,
                  seen: seen,
                  radius: radius,
                  t: _anim.value,
                  gapColor: _ring.gapColor == 'background' || _ring.gapColor == 'transparent'
                      ? null
                      : parseHex(_ring.gapColor, Colors.transparent),
                ),
              ),
            ),
          ),
          Positioned.fill(
            child: Padding(
              padding: EdgeInsets.all(inset),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(innerRadius),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (widget.group.coverUrl.isEmpty)
                      const ColoredBox(color: Color(0xFFE5E5EA))
                    else
                      Image.network(
                        widget.group.coverUrl,
                        fit: BoxFit.cover,
                        excludeFromSemantics: true,
                        errorBuilder: (_, __, ___) => const ColoredBox(color: Color(0xFFE5E5EA)),
                      ),
                    // Animated covers play over the still once their video is ready.
                    if (_cover?.value.isInitialized ?? false)
                      FittedBox(
                        fit: BoxFit.cover,
                        clipBehavior: Clip.hardEdge,
                        child: SizedBox(
                          width: _cover!.value.size.width,
                          height: _cover!.value.size.height,
                          child: VideoPlayer(_cover!),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
          if (label != null) _badge(a.badge, label),
        ],
      ),
    );
  }

  /// Energized style: the story-shaped card, showing a still of the group's first story (which
  /// plays on its turn; the cover until the still loads), the circle in the middle (hidden while
  /// the story shows) and the title inside at the bottom.
  Widget _card() {
    final a = widget.group.appearance;
    final avatar = (widget.width * energizedAvatarShare).roundToDouble();
    final image = widget.group.coverUrl.isEmpty ? null : widget.group.coverUrl;
    return ClipRRect(
      borderRadius: BorderRadius.circular(widget.radius),
      child: SizedBox(
        width: widget.width,
        height: widget.height,
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ColoredBox(color: Color(0xFF222222)),
            // A still of the group's first story (the one it previews). The cover fills the card
            // only if there's no still to show: shown while the still loads, it would flash up
            // and then change.
            if (widget.group.stories.isNotEmpty && !_stillFailed)
              CardStill(
                key: ValueKey(widget.group.stories.first.url),
                story: widget.group.stories.first,
                onFailed: () {
                  if (mounted) setState(() => _stillFailed = true);
                },
              )
            else if (image != null)
              Image.network(image,
                  fit: BoxFit.cover, excludeFromSemantics: true, errorBuilder: (_, __, ___) => const SizedBox()),
            if (widget.preview != null)
              StoryPreview(
                key: ValueKey('${widget.preview!.id}#${widget.previewTurn}'),
                story: widget.preview!,
                onShown: () {
                  final turn = widget.previewTurn;
                  if (mounted) {
                    setState(() {
                      _shownTurn = turn;
                      _keepAside = false;
                    });
                  }
                },
              ),
            const Align(
              alignment: Alignment.bottomCenter,
              child: FractionallySizedBox(
                heightFactor: 0.45,
                widthFactor: 1,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color(0x00000000), Color(0x99000000)],
                    ),
                  ),
                ),
              ),
            ),
            // The circle (and its badge) gives way to the story while it shows, and while the
            // viewer opened from that preview is open.
            Center(
              child: AnimatedOpacity(
                opacity: (widget.preview != null && _shownTurn == widget.previewTurn) || widget.held || _keepAside
                    ? 0
                    : 1,
                duration: const Duration(milliseconds: 300),
                child: _circle(avatar, avatar, avatar / 2),
              ),
            ),
            if (!a.title.hidden && !widget.theme.hideTitles)
              Positioned(
                left: 6,
                right: 6,
                bottom: 8,
                child: Text(
                  widget.group.title,
                  maxLines: a.title.maxLines,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: (widget.theme.titleStyle ?? const TextStyle()).copyWith(
                    fontSize: widget.theme.titleSize,
                    color: Colors.white,
                    fontWeight: FontWeight.values[(a.title.weight ~/ 100 - 1).clamp(0, 8)],
                    shadows: const [Shadow(color: Color(0x99000000), offset: Offset(0, 1), blurRadius: 3)],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _badge(BadgeStyle badge, String label) {
    final pill = DecoratedBox(
      decoration: BoxDecoration(
        color: parseHex(badge.background, const Color(0xFFE8175D)),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white, width: 1.5),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
        child: Text(
          label,
          style: TextStyle(
            color: parseHex(badge.color, Colors.white),
            fontSize: 9.5,
            fontWeight: FontWeight.w700,
            height: 1.2,
          ),
        ),
      ),
    );
    return badge.position == 'top-right'
        ? Positioned(top: -2, right: -2, child: pill)
        : Positioned(left: 0, right: 0, bottom: -6, child: Center(child: pill));
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({required this.ring, required this.seen, required this.radius, required this.t, this.gapColor});
  final RingStyle ring;
  final bool seen;
  final double radius;
  final double t;
  final Color? gapColor;

  List<Color> get _colors {
    final c = [for (final hex in ring.colors) parseHex(hex, const Color(0xFFD62976))];
    return c.isEmpty ? const [Color(0xFFD62976)] : c;
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (ring.style == 'none') return;
    final w = ring.width.toDouble();
    final rect = Offset.zero & size;
    final ringRect = RRect.fromRectAndRadius(rect.deflate(w / 2), Radius.circular(math.max(0, radius - w / 2)));
    if (gapColor != null) {
      // Fills the gap between ring and cover; the cover is drawn on top, inside it.
      canvas.drawRRect(
        RRect.fromRectAndRadius(rect.deflate(w), Radius.circular(math.max(0, radius - w))),
        Paint()..color = gapColor!,
      );
    }
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = w;
    final colors = _colors;
    if (seen) {
      paint.color = parseHex(ring.seenColor, const Color(0xFFC7C7CC));
      canvas.drawRRect(ringRect, paint);
      return;
    }
    if (ring.style == 'solid' || colors.length == 1) {
      paint.color = colors.first;
    } else if (ring.animation == 'rotate') {
      paint.shader = SweepGradient(
        colors: [...colors, colors.first],
        transform: GradientRotation(t * 2 * math.pi),
      ).createShader(rect);
    } else {
      // CSS angles: 0° points up, 90° right.
      final rad = (ring.angle.toDouble() - 90) * math.pi / 180;
      final dir = Alignment(math.cos(rad), math.sin(rad));
      paint.shader = LinearGradient(begin: -dir, end: dir, colors: colors).createShader(rect);
    }
    canvas.drawRRect(ringRect, paint);

    if (ring.animation == 'pulse') {
      // A glow that grows outwards and fades, like the web's.
      final scale = 1 + 0.3 * t;
      final glow = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = w
        ..color = colors.first.withValues(alpha: 0.75 * (1 - t));
      canvas.save();
      canvas.translate(size.width / 2, size.height / 2);
      canvas.scale(scale);
      canvas.translate(-size.width / 2, -size.height / 2);
      canvas.drawRRect(ringRect, glow);
      canvas.restore();
    } else if (ring.animation == 'shimmer') {
      // A light band sweeping across the ring for the first 60% of each cycle.
      final p = (t / 0.6).clamp(0.0, 1.0);
      final x = -1.1 + 3.1 * p;
      final band = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = w
        ..shader = LinearGradient(
          begin: Alignment(x - 0.55, 0),
          end: Alignment(x + 0.55, 0),
          colors: const [Color(0x00FFFFFF), Color(0xD9FFFFFF), Color(0x00FFFFFF)],
        ).createShader(rect);
      canvas.drawRRect(ringRect, band);
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.t != t || old.seen != seen || old.ring != ring || old.radius != radius || old.gapColor != gapColor;
}
