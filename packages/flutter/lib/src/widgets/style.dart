import 'package:flutter/widgets.dart';

/// "#rrggbb" (or "#rgb") to a colour; [fallback] for anything else.
Color parseHex(String? hex, Color fallback) {
  if (hex == null || !hex.startsWith('#')) return fallback;
  var h = hex.substring(1);
  if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
  if (h.length != 6) return fallback;
  final v = int.tryParse(h, radix: 16);
  return v == null ? fallback : Color(0xFF000000 | v);
}

/// Ring animation length per speed, the same as the other SDKs.
const speedMs = {'slow': 4000, 'normal': 2400, 'fast': 1200};

/// Size and spacing your code can set; the dashboard's shape and size win once set there.
class StoriesTheme {
  const StoriesTheme({
    this.circleSize = 68,
    this.gap = 14,
    this.barPadding = 12,
    this.titleSize = 12,
    this.titleStyle,
    this.hideTitles = false,
  });

  /// Item width and height when the dashboard sets no shape and size.
  final double circleSize;
  final double gap;

  /// Space before the first and after the last item.
  final double barPadding;
  final double titleSize;

  /// Font family, colour and so on for titles (the dashboard's title colour and weight win).
  final TextStyle? titleStyle;
  final bool hideTitles;
}
