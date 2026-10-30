import 'package:flutter/material.dart';

import '../../stories_core.dart';

const _shadow = [Shadow(color: Color(0x80000000), offset: Offset(0, 1), blurRadius: 3)];

/// The story button, in its style (spec: Story button): a white or dark pill, an outline, or a
/// swipe up (a chevron over the label, or over a white pill).
class CtaButton extends StatelessWidget {
  const CtaButton({super.key, required this.label, required this.style, required this.onPressed});

  final String label;
  final CtaStyle style;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    const pad = EdgeInsets.symmetric(horizontal: 22, vertical: 12);
    final text = TextStyle(
      fontSize: 15,
      fontWeight: FontWeight.w600,
      color: style == CtaStyle.pill || style == CtaStyle.swipePill ? Colors.black : Colors.white,
      shadows: style == CtaStyle.outline || style == CtaStyle.swipe ? _shadow : null,
    );
    final Decoration? box = switch (style) {
      CtaStyle.pill || CtaStyle.swipePill => const ShapeDecoration(color: Colors.white, shape: StadiumBorder()),
      CtaStyle.dark => const ShapeDecoration(color: Color(0xFF111111), shape: StadiumBorder()),
      CtaStyle.outline => const ShapeDecoration(shape: StadiumBorder(side: BorderSide(color: Colors.white, width: 2))),
      CtaStyle.swipe => null,
    };
    return Semantics(
      button: true,
      link: true,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onPressed,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (style.isSwipe) const _Chevron(),
            Container(
              padding: style == CtaStyle.swipe ? const EdgeInsets.fromLTRB(22, 4, 22, 10) : pad,
              decoration: box,
              child: Text(label, style: text, maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
    );
  }
}

/// An upward chevron that bobs gently, unless animations are turned off.
class _Chevron extends StatefulWidget {
  const _Chevron();

  @override
  State<_Chevron> createState() => _ChevronState();
}

class _ChevronState extends State<_Chevron> with SingleTickerProviderStateMixin {
  late final _bob = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _bob.stop();
      _bob.value = 0;
    } else if (!_bob.isAnimating) {
      _bob.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _bob.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 4),
        child: AnimatedBuilder(
          animation: _bob,
          builder: (context, child) => Transform.translate(
            offset: Offset(0, -6 * Curves.easeInOut.transform(_bob.value)),
            child: child,
          ),
          child: const Icon(Icons.keyboard_arrow_up_rounded, color: Colors.white, size: 30, shadows: _shadow),
        ),
      );
}
