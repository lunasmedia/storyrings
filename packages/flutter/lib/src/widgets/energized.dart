import 'package:flutter/widgets.dart';
import 'package:video_player/video_player.dart';

import '../../stories_core.dart';
import 'images.dart';

/// Energized style: a story over a card's cover, a muted video or an image zooming in and out.
/// It fades in once it can show, so the cover stays until then (or if it can't load).
class StoryPreview extends StatefulWidget {
  const StoryPreview({super.key, required this.story, this.onShown});

  final FeedStory story;

  /// It's showing (once it can).
  final VoidCallback? onShown;

  @override
  State<StoryPreview> createState() => _StoryPreviewState();
}

class _StoryPreviewState extends State<StoryPreview> with SingleTickerProviderStateMixin {
  late final AnimationController _zoom =
      AnimationController(vsync: this, duration: const Duration(milliseconds: energizedPreviewMs));
  // In to 110% and back out over the preview.
  late final Animation<double> _scale = TweenSequence([
    TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.1).chain(CurveTween(curve: Curves.easeInOut)), weight: 1),
    TweenSequenceItem(tween: Tween(begin: 1.1, end: 1.0).chain(CurveTween(curve: Curves.easeInOut)), weight: 1),
  ]).animate(_zoom);
  VideoPlayerController? _video;
  bool _shown = false;

  @override
  void initState() {
    super.initState();
    if (widget.story.type != 'video') return;
    final c = VideoPlayerController.networkUrl(
      Uri.parse(widget.story.url),
      videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
    );
    _video = c;
    c.setVolume(0);
    c.initialize().then((_) {
      if (!mounted) return;
      c.play();
      setState(() => _shown = true);
      widget.onShown?.call();
    }, onError: (_) {
      // The cover stays.
    });
  }

  @override
  void dispose() {
    _zoom.dispose();
    _video?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final video = _video;
    final Widget media;
    if (video != null) {
      media = video.value.isInitialized
          ? FittedBox(
              fit: BoxFit.cover,
              clipBehavior: Clip.hardEdge,
              child:
                  SizedBox(width: video.value.size.width, height: video.value.size.height, child: VideoPlayer(video)),
            )
          : const SizedBox.shrink();
    } else {
      media = ScaleTransition(
        scale: _scale,
        child: Image(
          image: storyImage(widget.story, context),
          fit: BoxFit.cover,
          excludeFromSemantics: true,
          frameBuilder: (context, child, frame, _) {
            if (frame != null && !_shown) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (!mounted || _shown) return;
                setState(() => _shown = true);
                _zoom.forward();
                widget.onShown?.call();
              });
            }
            return child;
          },
          errorBuilder: (_, __, ___) => const SizedBox.shrink(),
        ),
      );
    }
    return IgnorePointer(
      child: AnimatedOpacity(
        opacity: _shown ? 1 : 0,
        duration: const Duration(milliseconds: 300),
        child: media,
      ),
    );
  }
}

/// Energized style: a card's still, its first story (the one it previews) as an image, or a
/// video's first frame (a paused player). Fades in once it can show; if it can't, [onFailed]
/// (the card shows the cover instead).
class CardStill extends StatefulWidget {
  const CardStill({super.key, required this.story, this.onFailed});

  final FeedStory story;
  final VoidCallback? onFailed;

  @override
  State<CardStill> createState() => _CardStillState();
}

class _CardStillState extends State<CardStill> {
  VideoPlayerController? _video;
  bool _shown = false;

  @override
  void initState() {
    super.initState();
    if (widget.story.type != 'video') return;
    final c = VideoPlayerController.networkUrl(
      Uri.parse(widget.story.url),
      videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
    );
    _video = c;
    c.setVolume(0);
    c.initialize().then((_) {
      if (mounted) setState(() => _shown = true);
    }, onError: (_) {
      if (mounted) widget.onFailed?.call();
    });
  }

  @override
  void dispose() {
    _video?.dispose();
    super.dispose();
  }

  void _show() {
    if (_shown) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !_shown) setState(() => _shown = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final video = _video;
    final Widget media;
    if (video != null) {
      media = video.value.isInitialized
          ? FittedBox(
              fit: BoxFit.cover,
              clipBehavior: Clip.hardEdge,
              child:
                  SizedBox(width: video.value.size.width, height: video.value.size.height, child: VideoPlayer(video)),
            )
          : const SizedBox.shrink();
    } else {
      media = Image(
        image: storyImage(widget.story, context),
        fit: BoxFit.cover,
        excludeFromSemantics: true,
        frameBuilder: (context, child, frame, _) {
          if (frame != null) _show();
          return child;
        },
        errorBuilder: (_, __, ___) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) widget.onFailed?.call();
          });
          return const SizedBox.shrink();
        },
      );
    }
    return IgnorePointer(
      child: AnimatedOpacity(
        opacity: _shown ? 1 : 0,
        duration: const Duration(milliseconds: 200),
        child: media,
      ),
    );
  }
}

