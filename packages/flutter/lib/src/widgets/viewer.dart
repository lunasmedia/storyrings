import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import '../../stories_core.dart';
import 'cta.dart';
import 'images.dart';
import 'stickers.dart';
import 'style.dart';

class StoryOpenEvent {
  const StoryOpenEvent({
    required this.groupId,
    required this.storyId,
    required this.groupIndex,
    required this.storyIndex,
    required this.groupTitle,
  });
  final String groupId;
  final String storyId;
  final int groupIndex;
  final int storyIndex;
  final String groupTitle;
}

class CtaClickEvent {
  const CtaClickEvent(
      {required this.url, required this.label, required this.groupId, required this.storyId, required this.close});
  final String url;
  final String label;
  final String groupId;
  final String storyId;

  /// Closes the viewer (useful when you handle the link with your own navigation).
  final VoidCallback close;
}

class ShareEvent {
  const ShareEvent({required this.url, required this.title, required this.groupId, required this.storyId});

  /// Your share link from the dashboard with {group} and {story} filled in.
  final String url;

  /// Story name (or the group title).
  final String title;
  final String groupId;
  final String storyId;
}

/// Return false to handle the link yourself; otherwise the SDK opens it.
typedef CtaClickHandler = bool? Function(CtaClickEvent event);

/// Return false to share yourself; otherwise the SDK opens the share sheet.
typedef ShareHandler = bool? Function(ShareEvent event);

/// Video sound preference for the session: once unmuted, later videos play with sound too.
bool _muted = true;

enum _PauseReason { user, hold, background, share }

/// Full-screen story viewer. Navigation, timing and analytics come from the core state
/// machine (spec/cases/viewer.json); this widget draws it and feeds it taps and media events.
class StoriesViewer extends StatefulWidget {
  const StoriesViewer({
    super.key,
    required this.feed,
    required this.groupIndex,
    required this.seen,
    required this.track,
    this.onStoryOpen,
    this.onCtaClick,
    this.onShare,
    this.drag,
    this.shownGroup,
    this.answers,
    this.sendAnswer,
  });

  final Feed feed;
  final int groupIndex;
  final SeenStore seen;
  final void Function(StoryEvent event) track;
  final void Function(StoryOpenEvent event)? onStoryOpen;
  final CtaClickHandler? onCtaClick;
  final ShareHandler? onShare;

  /// How far the story is dragged down; shared with the route's transition, which moves it.
  final ValueNotifier<double>? drag;

  /// The group on screen, so the zoom transition closes into its circle.
  final ValueNotifier<int>? shownGroup;

  /// Polls, quizzes and sliders: answers kept on this device, and how to send one.
  final AnswerStore? answers;
  final Future<AnswerResults?> Function(String storyId, String interactionId, int value)? sendAnswer;

  @override
  State<StoriesViewer> createState() => _StoriesViewerState();
}

class _StoriesViewerState extends State<StoriesViewer> with TickerProviderStateMixin, WidgetsBindingObserver {
  late ViewerState _state;

  /// The last open state: what's drawn, including while the viewer animates closed.
  late ViewerState _shown;
  late final Ticker _ticker = createTicker(_onTick);
  Duration _last = Duration.zero;
  final _paused = <_PauseReason>{};
  final _gestures = <GestureRecognizer>[];
  late final ValueNotifier<double> _drag = widget.drag ?? ValueNotifier(0);

  /// Springs a let-go drag back to 0 (when it didn't close the viewer).
  late final AnimationController _dragBack =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 250))
        ..addListener(() => _drag.value = _dragFrom * (1 - Curves.easeOutCubic.transform(_dragBack.value)));
  double _dragFrom = 0;

  /// The loading indicator, only for loads that take a while.
  bool _spinner = false;

  /// The photo story shown before this one, drawn over it until it has drawn (so a story still
  /// loading never shows black). Only photos: a video's player belongs to the current story.
  FeedStory? _previous;
  Timer? _spinnerTimer;
  bool _done = false;
  VideoPlayerController? _video;
  int _videoSeq = -1;
  final _shareKey = GlobalKey();

  List<FeedGroup> get _groups => widget.feed.groups;
  int _start(int g) => widget.seen.firstUnseenIndex(_groups[g]);
  FeedGroup get _group => _groups[_shown.groupIndex];
  FeedStory get _story => _group.stories[_shown.storyIndex];

  /// The story whose photo is on screen: the previous one until this one has drawn. Its button and
  /// stickers go with it, so they never change before the photo does.
  FeedStory get _onScreen => (_shown.displayed ? null : _previous) ?? _story;
  FeedGroup get _onScreenGroup =>
      _groups.firstWhere((g) => g.stories.any((s) => s.id == _onScreen.id), orElse: () => _group);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _state = openViewer(_groups, widget.groupIndex, startStoryIndex: _start);
    _shown = _state;
    for (final e in transitionEvents(closed, _state, _groups)) {
      widget.track(e);
    }
    _gestures.add(GestureRecognizer(GestureHandlers(
      onPress: () => _setPaused(_PauseReason.hold, true),
      onRelease: () => _setPaused(_PauseReason.hold, false),
      onTap: (x) {
        _paused.remove(_PauseReason.hold);
        _syncPause();
        _dispatch(x < 0.3 ? const Prev() : const Next());
      },
      onSwipe: (d) {
        _paused.remove(_PauseReason.hold);
        _syncPause();
        switch (d) {
          case SwipeDirection.left:
            _dispatch(const NextGroup());
          case SwipeDirection.right:
            _dispatch(const PrevGroup());
          case SwipeDirection.down:
            _close();
          case SwipeDirection.up:
            // A swipe-up button: swiping up anywhere on the story opens its link.
            if (_onScreen.ctaLabel != null && _onScreen.ctaStyle.isSwipe) _cta();
        }
      },
      onDrag: (dx, dy) {
        if (dy > 0) {
          _dragBack.stop();
          _drag.value = dy;
        } else if (dx == 0 && dy == 0 && _drag.value > 0) {
          // Let go. A swipe down closing the viewer follows straight after; if it doesn't, spring back.
          scheduleMicrotask(() {
            if (_done || !mounted) return;
            _dragFrom = _drag.value;
            _dragBack.forward(from: 0);
          });
        }
      },
    )));
    if (_state.open) {
      // After the first frame: announcing reads inherited widgets (text direction).
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _storyStarted();
      });
      _ticker.start();
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) => _finish(CloseReason.completed));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _ticker.dispose();
    _dragBack.dispose();
    _spinnerTimer?.cancel();
    _video?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _setPaused(_PauseReason.background, state != AppLifecycleState.resumed);
  }

  // --- State machine ----------------------------------------------------------------

  void _dispatch(ViewerAction action) {
    final prev = _state;
    if (!prev.open || _done) return;
    for (final e in actionEvents(prev, action, _groups)) {
      widget.track(e);
    }
    final next = reduce(prev, action, _groups, startStoryIndex: _start);
    if (identical(next, prev)) return;
    _state = next;
    if (next.open) {
      _shown = next;
      widget.shownGroup?.value = next.groupIndex;
    }
    for (final e in transitionEvents(prev, next, _groups)) {
      widget.track(e);
    }
    if (!next.open) return _finish(next.closeReason ?? CloseReason.user);
    if (next.seq != prev.seq) {
      if (prev.displayed) {
        final before = widget.feed.groups[prev.groupIndex].stories[prev.storyIndex];
        _previous = before.type == 'image' ? before : null;
      }
      // A hold or pause doesn't carry over to a new story.
      _paused
        ..remove(_PauseReason.user)
        ..remove(_PauseReason.hold);
      _storyStarted();
    }
    _syncVideo();
    if (mounted) setState(() {});
  }

  void _onTick(Duration elapsed) {
    final ms = (elapsed - _last).inMilliseconds;
    if (ms <= 0) return;
    _last = elapsed;
    _dispatch(Tick(ms));
  }

  void _setPaused(_PauseReason reason, bool on) {
    on ? _paused.add(reason) : _paused.remove(reason);
    // In the background the story is off screen (viewability restarts).
    _dispatch(_paused.contains(_PauseReason.background) ? const Hide() : const Show());
    _syncPause();
  }

  void _syncPause() => _dispatch(_paused.isNotEmpty ? const Pause() : const Resume());

  void _close() => _dispatch(const Close());

  void _finish(CloseReason reason) {
    if (_done) return;
    _done = true;
    _ticker.stop();
    _video?.pause();
    if (mounted) Navigator.of(context).pop(reason);
  }

  /// A story started: seen state, media, callbacks, announcements.
  void _storyStarted() {
    final g = _group;
    final s = _story;
    _spinner = false;
    _spinnerTimer?.cancel();
    _spinnerTimer = Timer(const Duration(milliseconds: 400), () {
      if (mounted) setState(() => _spinner = true);
    });
    widget.seen.markSeen(s.id);
    widget.onStoryOpen?.call(StoryOpenEvent(
      groupId: g.id,
      storyId: s.id,
      groupIndex: _state.groupIndex,
      storyIndex: _state.storyIndex,
      groupTitle: g.title,
    ));
    final name = s.title ?? g.title;
    // sendAnnouncement replaces this in Flutter 3.35+, but doesn't exist in 3.22 (our minimum).
    // ignore: deprecated_member_use
    SemanticsService.announce(
      '${StoriesLabels.storyPosition(g.title, _state.storyIndex, g.stories.length)}'
      '${name != g.title ? ', $name' : ''}${s.alt.isNotEmpty ? '. ${s.alt}' : ''}',
      Directionality.maybeOf(context) ?? TextDirection.ltr,
    );
    _loadMedia();
  }

  void _loadMedia() {
    final seq = _state.seq;
    final old = _video;
    _video = null;
    _videoSeq = -1;
    old?.dispose();
    if (_story.type != 'video') return;
    final c = VideoPlayerController.networkUrl(Uri.parse(_story.url));
    _video = c;
    _videoSeq = seq;
    c.setVolume(_muted ? 0 : 1);
    c.initialize().then((_) {
      if (!mounted || _videoSeq != seq) return;
      _dispatch(MediaReady(durationMs: c.value.duration.inMilliseconds));
      c.addListener(() => _onVideo(c, seq));
      _syncVideo();
      setState(() {});
    }, onError: (_) {
      if (mounted && _videoSeq == seq) _dispatch(const MediaReady(failed: true));
    });
  }

  bool _wasBuffering = false;

  void _onVideo(VideoPlayerController c, int seq) {
    if (_videoSeq != seq || !_state.open) return;
    final v = c.value;
    if (v.isBuffering != _wasBuffering) {
      _wasBuffering = v.isBuffering;
      _dispatch(v.isBuffering ? const MediaLoading() : const MediaReady());
    }
    if (v.isCompleted) _dispatch(const Next(auto: true));
  }

  void _syncVideo() {
    final c = _video;
    if (c == null || !c.value.isInitialized) return;
    final play = _state.open && !_state.paused && !_state.hidden;
    if (play && !c.value.isPlaying) c.play();
    if (!play && c.value.isPlaying) c.pause();
  }

  // --- Actions ------------------------------------------------------------------------

  void _cta() {
    final url = _onScreen.ctaUrl;
    if (url != null) _openLink(_onScreen.ctaLabel ?? '', url);
  }

  /// The story button, or a link sticker: both count as a button tap and follow the same rules.
  void _openLink(String label, String url) {
    final s = _onScreen;
    final g = _onScreenGroup;
    widget.track(StoryEvent('cta_click', g.id, storyId: s.id));
    final result = widget.onCtaClick?.call(
      CtaClickEvent(url: url, label: label, groupId: g.id, storyId: s.id, close: _close),
    );
    if (result == false || !_state.open) return;
    if (isAllowedCtaUrl(url, widget.feed.deepLinkSchemes)) {
      launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication).catchError((_) => false);
    }
  }

  /// Keeps the answer, shows it at once, then the results once they arrive.
  void _answer(Interaction i, int value) {
    final storyId = _story.id;
    widget.answers?.set(storyId, i.id, StoredAnswer(value));
    setState(() {});
    widget.sendAnswer?.call(storyId, i.id, value).then((results) {
      if (results == null) return;
      widget.answers?.set(storyId, i.id, StoredAnswer(value, results));
      if (mounted) setState(() {});
    });
  }

  Future<void> _share() async {
    final link = widget.feed.sharing ? widget.feed.shareLink : null;
    if (link == null) return;
    final g = _group;
    final s = _story;
    final url = appShareUrl(link, groupId: g.id, storyId: s.id);
    final title = s.title ?? g.title;
    void track() => widget.track(StoryEvent('share', g.id, storyId: s.id));
    if (widget.onShare?.call(ShareEvent(url: url, title: title, groupId: g.id, storyId: s.id)) == false) {
      track();
      return;
    }
    // The share sheet covers the story, so it waits.
    _setPaused(_PauseReason.share, true);
    try {
      final box = _shareKey.currentContext?.findRenderObject() as RenderBox?;
      final origin = box == null ? null : box.localToGlobal(Offset.zero) & box.size;
      final result = await Share.share('$title\n$url', subject: title, sharePositionOrigin: origin);
      if (result.status == ShareResultStatus.success) track();
    } catch (_) {
      // The sheet couldn't open; nothing else to do.
    } finally {
      if (mounted && _state.open) _setPaused(_PauseReason.share, false);
    }
  }

  void _toggleMute() {
    _muted = !_muted;
    _video?.setVolume(_muted ? 0 : 1);
    setState(() {});
  }

  // --- UI -----------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    // While it animates closed, the last story stays on screen.
    if (!_shown.open) return const ColoredBox(color: Colors.black);
    final g = _group;
    final s = _story;
    final o = _onScreen;
    final progress = progressSegments(_shown, _groups);
    final userPaused = _paused.contains(_PauseReason.user);
    final canShare = widget.feed.sharing && widget.feed.shareLink != null;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: Semantics(
        scopesRoute: true,
        namesRoute: true,
        explicitChildNodes: true,
        label: StoriesLabels.viewer(g.title),
        // The route's transition moves the story (open, close, drag); light status bar icons over it.
        child: AnnotatedRegion<SystemUiOverlayStyle>(
          value: SystemUiOverlayStyle.light,
          // A Material, so text and buttons get proper styling (without one, Flutter draws
          // its yellow "missing Material" underline).
          child: Material(
            color: Colors.black,
            // The story covers the whole screen, under the status bar and home indicator, as the
            // studio previews it on full phone screens; the header and button stay clear of them.
            child: LayoutBuilder(
              builder: (context, box) => Stack(
                fit: StackFit.expand,
                children: [
                  Listener(
                    behavior: HitTestBehavior.opaque,
                    // Screen positions, not local ones: the story moves under the finger while
                    // it's dragged, and measuring against it would feed the drag back into itself.
                    onPointerDown: (e) =>
                        _gestures.first.down(e.position.dx, e.position.dy, e.timeStamp.inMilliseconds),
                    onPointerMove: (e) => _gestures.first.move(e.position.dx, e.position.dy),
                    onPointerUp: (e) => _gestures.first
                        .up(e.position.dx, e.position.dy, e.timeStamp.inMilliseconds, MediaQuery.sizeOf(context).width),
                    onPointerCancel: (_) => _gestures.first.cancel(),
                    child: Semantics(
                      label: s.alt.isEmpty ? null : s.alt,
                      image: s.type == 'image',
                      child: _media(s),
                    ),
                  ),
                  // Keyed: the spinner and stickers come and go between stories, and without keys
                  // the layers after them would be rebuilt (the header's cover blinking out).
                  if (_spinner && _shown.buffering && !_shown.displayed)
                    const Center(
                      key: ValueKey('spinner'),
                      child: CircularProgressIndicator(color: Colors.white54, strokeWidth: 2),
                    ),
                  // The button and stickers stay with the photo on screen (see _onScreen).
                  if (o.interactions.isNotEmpty)
                    StoryStickers(
                      key: const ValueKey('stickers'),
                      story: o,
                      answers: widget.answers,
                      onAnswer: _answer,
                      onLink: (l) => _openLink(l.label, l.url),
                      hold: (on) => _setPaused(_PauseReason.hold, on),
                    ),
                  KeyedSubtree(key: const ValueKey('header'), child: _header(g, s, progress, userPaused, canShare)),
                  if (o.ctaUrl != null && o.ctaLabel != null)
                    KeyedSubtree(key: const ValueKey('cta'), child: _ctaButton(o.ctaLabel!, o.ctaStyle)),
                  KeyedSubtree(key: const ValueKey('nav'), child: _navButtons()),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// What shows in the gaps around a story shown whole: its colours, top to bottom (or black).
  Widget _gaps(StoryLook look) {
    final top = look.fillTop, bottom = look.fillBottom;
    return DecoratedBox(
      decoration: top != null && bottom != null
          ? BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [parseHex(top, Colors.black), parseHex(bottom, Colors.black)],
              ),
            )
          : const BoxDecoration(color: Colors.black),
    );
  }

  /// Fill covers the screen; fit shows all of it, with the gaps in the story's colours.
  Widget _media(FeedStory s) {
    final look = s.look;
    final previous = _previous;
    return Stack(
      fit: StackFit.expand,
      children: [
        _gaps(look),
        ClipRect(child: _mediaContent(s)),
        // The previous story stays on screen until this one has drawn.
        if (previous != null && !_shown.displayed) ...[
          _gaps(previous.look),
          ClipRect(
            child: Image(
              image: storyImage(previous, context),
              fit: previous.look.fills ? BoxFit.cover : BoxFit.contain,
              excludeFromSemantics: true,
              gaplessPlayback: true,
            ),
          ),
        ],
        // A designed video's text and stickers, fitted as the story image would be.
        if (s.type == 'video' && look.overlay != null)
          ClipRect(
            child: Image.network(
              look.overlay!,
              fit: look.fills ? BoxFit.cover : BoxFit.contain,
              excludeFromSemantics: true,
              gaplessPlayback: true,
              errorBuilder: (_, __, ___) => const SizedBox(),
            ),
          ),
      ],
    );
  }

  Widget _mediaContent(FeedStory s) {
    if (s.type == 'video') {
      final c = _video;
      if (c == null || !c.value.isInitialized) return const SizedBox.expand();
      if (s.look.fills) {
        return FittedBox(
          fit: BoxFit.cover,
          child: SizedBox(width: c.value.size.width, height: c.value.size.height, child: VideoPlayer(c)),
        );
      }
      return Center(child: AspectRatio(aspectRatio: c.value.aspectRatio, child: VideoPlayer(c)));
    }
    final seq = _state.seq;
    return Image(
      image: storyImage(s, context),
      key: ValueKey(seq),
      fit: s.look.fills ? BoxFit.cover : BoxFit.contain,
      excludeFromSemantics: true,
      frameBuilder: (context, child, frame, sync) {
        if (frame != null && seq == _state.seq && !_state.displayed) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && seq == _state.seq && !_state.displayed) _dispatch(const MediaReady());
          });
        }
        return child;
      },
      errorBuilder: (context, _, __) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && seq == _state.seq && _state.buffering) _dispatch(const MediaReady(failed: true));
        });
        return const SizedBox.expand();
      },
    );
  }

  Widget _header(FeedGroup g, FeedStory s, List<double> progress, bool userPaused, bool canShare) {
    return Positioned(
      left: 0,
      right: 0,
      top: 0,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
              begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x66000000), Color(0x00000000)]),
        ),
        // Reaches up behind the status bar, keeping it readable over light stories.
        child: SafeArea(
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 6, 14),
            child: Column(
              children: [
                ExcludeSemantics(
                  child: Row(
                    children: [
                      for (var i = 0; i < progress.length; i++) ...[
                        if (i > 0) const SizedBox(width: 3),
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(2),
                            child: LinearProgressIndicator(
                              value: progress[i],
                              minHeight: 2.5,
                              backgroundColor: Colors.white30,
                              valueColor: const AlwaysStoppedAnimation(Colors.white),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                // 16 in from the edge, clear of the screen's rounded corners.
                Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: Row(
                    children: [
                      ClipOval(
                        child: SizedBox(
                          width: 32,
                          height: 32,
                          child: Image.network(g.coverUrl,
                              fit: BoxFit.cover,
                              excludeFromSemantics: true,
                              errorBuilder: (_, __, ___) => const SizedBox()),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Semantics(
                          header: true,
                          child: Text(
                            s.title ?? g.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14),
                          ),
                        ),
                      ),
                      if (canShare)
                        _iconButton(StoriesLabels.share, Icons.ios_share, () => unawaited(_share()), key: _shareKey),
                      _iconButton(
                        userPaused ? StoriesLabels.play : StoriesLabels.pause,
                        userPaused ? Icons.play_arrow : Icons.pause,
                        () => _setPaused(_PauseReason.user, !userPaused),
                      ),
                      if (s.type == 'video')
                        _iconButton(_muted ? StoriesLabels.unmute : StoriesLabels.mute,
                            _muted ? Icons.volume_off : Icons.volume_up, _toggleMute),
                      _iconButton(StoriesLabels.close, Icons.close, _close),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _iconButton(String label, IconData icon, VoidCallback onPressed, {Key? key}) => IconButton(
        key: key,
        tooltip: label,
        onPressed: onPressed,
        icon: Icon(icon, color: Colors.white, size: 22, semanticLabel: label),
      );

  Widget _ctaButton(String label, CtaStyle style) => Positioned(
        left: 24,
        right: 24,
        // Clear of the home indicator.
        bottom: 24 + MediaQuery.paddingOf(context).bottom,
        child: Center(child: CtaButton(label: label, style: style, onPressed: _cta)),
      );

  /// Previous / next for screen readers (taps on the story do this for everyone else).
  Widget _navButtons() => Positioned(
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        child: IgnorePointer(
          child: Semantics(
            container: true,
            child: Row(
              children: [
                Semantics(
                    button: true,
                    label: StoriesLabels.previous,
                    onTap: () => _dispatch(const Prev()),
                    child: const SizedBox(width: 1, height: 1)),
                const Spacer(),
                Semantics(
                    button: true,
                    label: StoriesLabels.next,
                    onTap: () => _dispatch(const Next()),
                    child: const SizedBox(width: 1, height: 1)),
              ],
            ),
          ),
        ),
      );
}

/// How the viewer opens and closes. With reduced motion, both are a short fade.
enum StoriesTransition {
  /// Slides up from the bottom; shrinks away towards the bottom of the screen.
  slide,

  /// Springs out of the tapped circle and goes back into the circle of the group being watched
  /// (slides when that circle isn't on screen, e.g. a group opened from code).
  zoom,
}

/// Slide: the story slides up from the bottom, and shrinks away towards the bottom of the screen
/// to close. Zoom: it springs out of the tapped circle and goes back into the circle of the group
/// being shown. Either way a close carries on from wherever a swipe down left it. The app behind
/// is never dimmed: the story covers it while open and it shows around the story as it moves.
/// With reduced motion, a fade.
class StoriesViewerTransition extends StatefulWidget {
  const StoriesViewerTransition(
      {super.key, required this.animation, required this.drag, this.circle, required this.child});

  final Animation<double> animation;
  final ValueNotifier<double> drag;

  /// Zoom: where the circle of the group being shown is (null when it isn't on screen). Null = slide.
  final ({Rect rect, double radius})? Function()? circle;
  final Widget child;

  static Duration openDuration(StoriesTransition t) => Duration(milliseconds: t == StoriesTransition.zoom ? 480 : 300);
  static Duration closeDuration(StoriesTransition t) => Duration(milliseconds: t == StoriesTransition.zoom ? 380 : 300);

  @override
  State<StoriesViewerTransition> createState() => _StoriesViewerTransitionState();
}

class _StoriesViewerTransitionState extends State<StoriesViewerTransition> {
  static const _slideOpen = Cubic(0.2, 0, 0, 1);
  static const _slideClose = Cubic(0.4, 0, 0.2, 1);
  // A spring-like ease with a small overshoot, and a settled one for closing.
  static const _zoomOpen = Cubic(0.3, 1.18, 0.5, 1);
  static const _zoomClose = Cubic(0.35, 0, 0.15, 1);

  ({Rect rect, double radius})? _from;
  double? _closingFrom;
  bool _closing = false;

  @override
  void initState() {
    super.initState();
    _from = widget.circle?.call();
    widget.animation.addStatusListener(_status);
  }

  @override
  void dispose() {
    widget.animation.removeStatusListener(_status);
    super.dispose();
  }

  void _status(AnimationStatus status) {
    if (status != AnimationStatus.reverse || _closing) return;
    // Closing: from where the story is now, into the circle of the group being shown (if visible).
    _closing = true;
    _closingFrom = widget.drag.value;
    _from = widget.circle?.call();
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.of(context).disableAnimations) return FadeTransition(opacity: widget.animation, child: widget.child);
    final size = MediaQuery.sizeOf(context);
    return AnimatedBuilder(
      animation: Listenable.merge([widget.animation, widget.drag]),
      child: widget.child,
      builder: (context, child) {
        final d = _closingFrom ?? widget.drag.value;
        // Dragging down: the story follows the finger and shrinks a little, with rounded corners.
        final dragged = (d / size.height).clamp(0.0, 1.0);
        final from = _from;
        if (from != null) return _zoom(child!, size, from, d, dragged);

        final slide = _closing ? 0.0 : 1 - _slideOpen.transform(widget.animation.value);
        final c = _closing ? _slideClose.transform(1 - widget.animation.value) : 0.0;
        final h = size.height;
        final scale = _lerp(1 - 0.12 * dragged, 0.12, c);
        // Closing: shrinks towards the bottom centre of the screen, fading out at the end.
        final centreY = _lerp(h / 2 + d, h * 0.92, c);
        final corner = dragged > 0 || c > 0 ? 16 / scale * (dragged * 8 + c * 4).clamp(0.0, 1.0) : 0.0;
        return Opacity(
          opacity: 1 - ((c - 0.6) / 0.4).clamp(0.0, 1.0),
          child: Transform.translate(
            offset: Offset(0, centreY - h / 2 + slide * h),
            child: Transform.scale(
              scale: scale,
              child: ClipRRect(borderRadius: BorderRadius.circular(corner), child: child),
            ),
          ),
        );
      },
    );
  }

  /// The story's frame moves between the circle and the (dragged) screen; the story is scaled to
  /// the frame's width and clipped to its height, centred.
  Widget _zoom(Widget child, Size size, ({Rect rect, double radius}) from, double d, double dragged) {
    final t = widget.animation.value;
    final g = _closing ? _zoomClose.transform(t) : _zoomOpen.transform(t);
    final dragScale = 1 - 0.12 * dragged;
    final end = Rect.fromCenter(
      center: Offset(size.width / 2, size.height / 2 + d),
      width: size.width * dragScale,
      height: size.height * dragScale,
    );
    final frame = Rect.lerp(from.rect, end, g)!;
    final scale = frame.width / size.width;
    final corner = _lerp(from.radius, 16 * (dragged * 8).clamp(0.0, 1.0), g).clamp(0.0, double.infinity);
    return Opacity(
      // Closing: hands over to the circle's cover as it lands.
      opacity: _closing ? (g / 0.25).clamp(0.0, 1.0) : 1,
      child: Stack(
        children: [
          Positioned.fromRect(
            rect: frame,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(corner),
              child: OverflowBox(
                minWidth: size.width,
                maxWidth: size.width,
                minHeight: size.height,
                maxHeight: size.height,
                child: Transform.scale(scale: scale, child: child),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static double _lerp(double a, double b, double t) => a + (b - a) * t;
}
