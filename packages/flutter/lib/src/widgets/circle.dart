import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'package:video_player/video_player.dart';

import '../../stories_core.dart';
import 'style.dart';

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

  @override
  State<StoryCircle> createState() => _StoryCircleState();
}

class _StoryCircleState extends State<StoryCircle> with SingleTickerProviderStateMixin {
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
    final ringWidth = _ring.style == 'none' ? 0.0 : _ring.width.toDouble();
    final inset = ringWidth + (_ring.style == 'none' ? 0 : _ring.gap.toDouble());
    final innerRadius = math.max(0.0, widget.radius - inset);
    final label = a.badgeLabel(widget.group.endsAt);
    final textColor = DefaultTextStyle.of(context).style.color ?? Colors.black;
    final titleColor = a.title.color == 'inherit' ? textColor : parseHex(a.title.color, textColor);
    final seen = widget.seen;
    final position = StoriesLabels.openGroup(widget.group.title, widget.group.stories.length, seen);

    final circle = SizedBox(
      width: widget.width,
      height: widget.height,
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
                  radius: widget.radius,
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
              Opacity(opacity: widget.opening ? 0.7 : 1, child: circle),
              if (!a.title.hidden && !widget.theme.hideTitles) ...[
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
