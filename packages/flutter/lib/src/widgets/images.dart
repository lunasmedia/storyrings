import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import '../../stories_core.dart';

/// A story's image, decoded at the size it's shown on this screen rather than in full. Phone
/// photos are often 25 megapixels or more (100 MB and up decoded): in full they'd crowd
/// everything else (the group's cover) out of Flutter's image cache, and strain memory.
ImageProvider storyImage(FeedStory s, BuildContext context) {
  final image = NetworkImage(s.url);
  final w = s.width;
  final h = s.height;
  if (w == null || h == null || w <= 0 || h <= 0) return image;
  final screen = MediaQuery.sizeOf(context);
  if (screen.isEmpty) return image;
  final sx = screen.width / w;
  final sy = screen.height / h;
  final scale = s.look.fills ? math.max(sx, sy) : math.min(sx, sy);
  final width = (w * scale * MediaQuery.devicePixelRatioOf(context)).ceil();
  return ResizeImage.resizeIfNeeded(width < w ? width : null, null, image);
}
