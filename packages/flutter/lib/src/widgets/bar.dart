import 'dart:async';

import 'package:flutter/material.dart';

import '../../stories_core.dart';
import '../client.dart';
import 'circle.dart';
import 'images.dart';
import 'style.dart';
import 'viewer.dart';

/// Viewability: how long a circle must stay at least half on screen to count as an impression.
const _impressionMs = 1000;

/// Longest the bar stays hidden on launch while waiting for the live feed and covers.
const _revealWaitMs = 500;

/// Longest a tap waits for the first story's image before opening the viewer on a spinner.
const _openWaitMs = 1500;

/// How many groups, from the start of the bar, have their first story loaded with the feed.
const _preloadGroups = 4;

/// Opens stories from code (a push notification, a deep link), and refreshes.
class StoriesBarController {
  _StoriesBarState? _state;

  /// Live groups currently shown.
  List<FeedGroup> get groups => _state?._feed?.groups ?? const [];

  /// Opens the viewer at a group, by id. False until the feed has loaded, or if the group
  /// isn't live.
  bool open(String groupId) => _state?._openId(groupId) ?? false;

  /// Closes the viewer if it's open.
  void close() => _state?._closeViewer();

  /// Refetches the feed.
  Future<void> refresh() => _state?._load(force: true) ?? Future.value();
}

/// An Instagram-style story bar. Tapping a circle opens the full-screen viewer.
///
/// ```dart
/// StoriesBar(token: 'pk_live_…', apiUrl: 'https://stories.example.com')
/// StoriesBar(token: 'pk_live_…', apiUrl: '…', bar: 'product-page')  // a second story bar
/// StoriesBar(token: 'pk_live_…', apiUrl: '…', tags: ['london'])      // the person's tags
/// ```
class StoriesBar extends StatefulWidget {
  const StoriesBar({
    super.key,
    required this.token,
    required this.apiUrl,
    this.bar,
    this.tags = const [],
    this.theme = const StoriesTheme(),
    this.analytics = true,
    this.reach = true,
    this.storage,
    this.controller,
    this.transition = StoriesTransition.slide,
    this.onLoad,
    this.onFail,
    this.onStoryOpen,
    this.onClose,
    this.onCtaClick,
    this.onShare,
  });

  /// Public token from the dashboard (Settings → Apps & websites → your app).
  final String token;

  /// Your Stories API server, e.g. https://stories.example.com.
  final String apiUrl;

  /// Which story bar to show: its key from the dashboard. Null = the main bar.
  final String? bar;

  /// The person's tags from your own user data (e.g. ['london', 'premium']). Groups with a
  /// tag filter only show to people whose tags pass it. Never personal data such as emails
  /// or IDs. Changing them reloads the feed.
  final List<String> tags;
  final StoriesTheme theme;

  /// Send analytics. Default true.
  final bool analytics;

  /// Count unique viewers with an anonymous ID kept on the device. Pass false until the
  /// person consents if your privacy rules require it.
  final bool reach;

  /// Where seen stories, the last feed and the anonymous ID are kept (default SharedPreferences).
  final KeyValueStorage? storage;
  final StoriesBarController? controller;

  /// How the viewer opens and closes: [StoriesTransition.slide] (up from the bottom, shrinking
  /// away towards the bottom) or [StoriesTransition.zoom] (out of the tapped circle and back into it).
  final StoriesTransition transition;

  /// Called with the live groups once loaded (may be empty).
  final void Function(List<FeedGroup> groups)? onLoad;

  /// Called if the feed can't be loaded. The bar then shows nothing, except stories from the
  /// last launch when offline.
  final void Function(StoriesException error)? onFail;
  final void Function(StoryOpenEvent event)? onStoryOpen;
  final void Function(CloseReason reason)? onClose;

  /// Return false to handle the link yourself (e.g. navigate inside your app).
  final CtaClickHandler? onCtaClick;

  /// Return false to share yourself. Shown when sharing is on in the dashboard.
  final ShareHandler? onShare;

  @override
  State<StoriesBar> createState() => _StoriesBarState();
}

class _StoriesBarState extends State<StoriesBar> with WidgetsBindingObserver {
  late StoriesClient _client;
  Feed? _feed;
  SeenStore? _seen;
  AnswerStore? _answers;
  bool _visible = false;
  bool _failed = false;
  bool _fresh = false;
  bool _viewerOpen = false;

  /// The circle tapped to open the viewer, shown pressed while its first story loads.
  int? _opening;
  bool _appActive = true;
  Timer? _revealTimer;
  final _scroll = ScrollController();
  final _impressed = <String>{};
  final _pending = <String, Timer>{};
  int _loadSeq = 0;
  // Each circle, to find where it is on screen for the zoom transition.
  final _circleKeys = <String, GlobalKey>{};

  String get _bar => widget.bar?.trim().toLowerCase() ?? '';
  List<String> get _tags => normalizeTags(widget.tags);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.controller?._state = this;
    _client = _makeClient();
    _scroll.addListener(_reportImpressions);
    _start();
  }

  StoriesClient _makeClient() => StoriesClient.start(
        token: widget.token,
        apiUrl: widget.apiUrl,
        analytics: widget.analytics,
        reach: widget.reach,
        storage: widget.storage,
      );

  @override
  void didUpdateWidget(StoriesBar old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller?._state = null;
      widget.controller?._state = this;
    }
    final changedClient = old.token != widget.token || old.apiUrl != widget.apiUrl || old.analytics != widget.analytics;
    if (changedClient) _client = _makeClient();
    if (old.reach != widget.reach) _client.setReach(widget.reach);
    final changedFeed =
        changedClient || (old.bar ?? '') != (widget.bar ?? '') || normalizeTags(old.tags).join() != _tags.join();
    if (changedFeed) {
      _impressed.clear();
      _start();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (widget.controller?._state == this) widget.controller?._state = null;
    _revealTimer?.cancel();
    for (final t in _pending.values) {
      t.cancel();
    }
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _appActive = state == AppLifecycleState.resumed;
    // Offline at launch: try again when the app comes back.
    if (_appActive && _failed == false && !_fresh) unawaited(_load(force: true));
    _reportImpressions();
  }

  void _start() {
    _fresh = false;
    _failed = false;
    final seq = ++_loadSeq;
    // Lay out last launch's feed (hidden) while the live one loads; it shows if the network is slow.
    _client.cachedFeed(bar: _bar, tags: _tags).then((cached) async {
      if (cached == null || seq != _loadSeq || _fresh || !mounted) return;
      final seen = await _client.seenStore(cached.appId);
      final answers = await _client.answerStore(cached.appId);
      if (seq != _loadSeq || _fresh || !mounted) return;
      setState(() {
        _feed = cached;
        _seen = seen;
        _answers = answers;
      });
    });
    _revealTimer?.cancel();
    _revealTimer = Timer(const Duration(milliseconds: _revealWaitMs), _reveal);
    unawaited(_load());
  }

  void _reveal() {
    if (mounted && !_visible) setState(() => _visible = true);
    WidgetsBinding.instance.addPostFrameCallback((_) => _reportImpressions());
  }

  Future<void> _load({bool force = false}) async {
    final seq = _loadSeq;
    try {
      final feed = await _client.loadFeed(bar: _bar, tags: _tags, force: force);
      final seen = await _client.seenStore(feed.appId);
      final answers = await _client.answerStore(feed.appId);
      if (!mounted || seq != _loadSeq) return;
      // Show new covers only once they're loaded, so they don't pop in.
      await Future.any([
        Future.wait([
          for (final g in feed.groups.take(8))
            // A missing cover just shows the placeholder; nothing to report.
            if (g.coverUrl.isNotEmpty) precacheImage(NetworkImage(g.coverUrl), context, onError: (_, __) {}),
        ]),
        Future<void>.delayed(const Duration(milliseconds: _revealWaitMs)),
      ]);
      if (!mounted || seq != _loadSeq) return;
      setState(() {
        _feed = feed;
        _seen = seen;
        _answers = answers;
        _fresh = true;
        _failed = false;
      });
      _preloadFirstStories(feed, seen);
      _reveal();
      widget.onLoad?.call(feed.groups);
    } on StoriesException catch (e) {
      if (!mounted || seq != _loadSeq) return;
      // Offline or a server hiccup: keep last launch's stories; anything else hides the bar.
      final temporary = e.code == 'network' || e.code == 'server';
      setState(() => _failed = !(temporary && _feed != null));
      if (temporary && _feed != null) _reveal();
      if (widget.onFail != null) {
        widget.onFail!(e);
      } else {
        debugPrint('[Stories] ${e.message}');
      }
    }
  }

  void _track(StoryEvent e) => _client.track(_bar.isEmpty ? e : e.withBar(_bar));

  // --- Layout and impressions ---------------------------------------------------------

  ({double width, double height, double radius, double gap}) get _metrics {
    final l = _feed?.layout;
    final size = widget.theme.circleSize;
    return (
      width: l?.width.toDouble() ?? size,
      height: l?.height.toDouble() ?? size,
      radius: l?.cornerRadius ?? size / 2,
      gap: l?.gap.toDouble() ?? widget.theme.gap,
    );
  }

  /// One impression per group per bar, by the MRC/IAB rule: at least half the circle on
  /// screen for one continuous second, while the app is active and the viewer is closed.
  void _reportImpressions() {
    final feed = _feed;
    final onScreen = <String>{};
    if (_fresh && feed != null && _visible && !_viewerOpen && _appActive && _scroll.hasClients) {
      final m = _metrics;
      final item = m.width + 12;
      final offset = _scroll.offset;
      final viewport = _scroll.position.viewportDimension;
      for (var i = 0; i < feed.groups.length; i++) {
        final start = widget.theme.barPadding + i * (item + m.gap) - offset;
        final shown = (start + item < viewport ? start + item : viewport) - (start > 0 ? start : 0);
        final id = feed.groups[i].id;
        if (shown >= item / 2 && !_impressed.contains(id)) onScreen.add(id);
      }
    }
    _pending.removeWhere((id, t) {
      if (onScreen.contains(id)) return false;
      t.cancel();
      return true;
    });
    for (final id in onScreen) {
      _pending.putIfAbsent(
        id,
        () => Timer(const Duration(milliseconds: _impressionMs), () {
          _pending.remove(id);
          if (_impressed.add(id)) _track(StoryEvent('impression', id));
        }),
      );
    }
  }

  // --- Viewer -------------------------------------------------------------------------

  bool _openId(String groupId) {
    final i = _feed?.groups.indexWhere((g) => g.id == groupId) ?? -1;
    if (i < 0) return false;
    _openIndex(i);
    return true;
  }

  NavigatorState? _viewerNavigator;

  void _closeViewer() {
    if (_viewerOpen) _viewerNavigator?.maybePop();
  }

  /// Loads and decodes the story each of the first groups opens on, so tapping a circle opens it
  /// at once. Loaded on the tap instead, a story not yet on the device made opening wait.
  void _preloadFirstStories(Feed feed, SeenStore seen) {
    for (final g in feed.groups.take(_preloadGroups)) {
      final first = g.stories[seen.firstUnseenIndex(g)];
      if (first.type == 'image') unawaited(precacheImage(storyImage(first, context), context, onError: (_, __) {}));
    }
  }

  Future<void> _openIndex(int index) async {
    final feed = _feed;
    final seen = _seen;
    if (feed == null || seen == null || _viewerOpen) return;
    setState(() => _viewerOpen = true);
    _reportImpressions();
    // Open once the first story's image is ready, so the viewer doesn't open on black and a
    // spinner. The first stories load with the feed (see _preloadFirstStories), so this is
    // normally at once; meanwhile the circle stays pressed.
    final group = feed.groups[index];
    final first = group.stories[seen.firstUnseenIndex(group)];
    if (first.type == 'image') {
      setState(() => _opening = index);
      await Future.any([
        precacheImage(storyImage(first, context), context, onError: (_, __) {}),
        Future<void>.delayed(const Duration(milliseconds: _openWaitMs)),
      ]);
      if (!mounted) return;
      setState(() => _opening = null);
    }
    _viewerNavigator = Navigator.of(context, rootNavigator: true);
    final drag = ValueNotifier<double>(0);
    final shownGroup = ValueNotifier<int>(index);
    final reason = await _viewerNavigator!.push<CloseReason>(
      PageRouteBuilder(
        // Transparent: the app shows around the story while it moves, and is never dimmed.
        opaque: false,
        transitionDuration: StoriesViewerTransition.openDuration(widget.transition),
        reverseTransitionDuration: StoriesViewerTransition.closeDuration(widget.transition),
        pageBuilder: (_, __, ___) => StoriesViewer(
          feed: feed,
          groupIndex: index,
          seen: seen,
          answers: _answers,
          sendAnswer: _client.sendAnswer,
          track: _track,
          onStoryOpen: widget.onStoryOpen,
          onCtaClick: widget.onCtaClick,
          onShare: widget.onShare,
          drag: drag,
          shownGroup: shownGroup,
        ),
        transitionsBuilder: (context, animation, _, child) => StoriesViewerTransition(
          animation: animation,
          drag: drag,
          // Zoom: the circle of the group being shown, to open from and close into.
          circle: widget.transition == StoriesTransition.zoom ? () => _circleRect(shownGroup.value) : null,
          child: child,
        ),
      ),
    );
    // `drag` isn't disposed here: the close animation still uses it after the result arrives.
    if (!mounted) return;
    // Rings turn grey for what was just watched.
    setState(() => _viewerOpen = false);
    widget.onClose?.call(reason ?? CloseReason.user);
    WidgetsBinding.instance.addPostFrameCallback((_) => _reportImpressions());
  }

  /// Group [index]'s circle on screen, if at least half of it is visible.
  ({Rect rect, double radius})? _circleRect(int index) {
    final feed = _feed;
    if (feed == null || index < 0 || index >= feed.groups.length || !mounted) return null;
    final box = _circleKeys[feed.groups[index].id]?.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.attached || !box.hasSize) return null;
    final m = _metrics;
    final topLeft = box.localToGlobal(Offset.zero);
    // The item is the circle with its title below; the circle is centred at the top.
    final rect = Rect.fromLTWH(topLeft.dx + (box.size.width - m.width) / 2, topLeft.dy, m.width, m.height);
    final screen = Offset.zero & MediaQuery.sizeOf(context);
    final shown = screen.intersect(rect);
    if (shown.width < rect.width / 2 || shown.height <= 0) return null;
    return (rect: rect, radius: m.radius.clamp(0.0, m.width / 2));
  }

  // --- UI -----------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final feed = _feed;
    final seen = _seen;
    if (_failed || feed == null || seen == null || feed.groups.isEmpty) return const SizedBox.shrink();
    final m = _metrics;
    final titles = !widget.theme.hideTitles;
    final height = m.height + (titles ? 6 + widget.theme.titleSize * 1.4 * 2 : 8) + 8;
    return Semantics(
      container: true,
      label: StoriesLabels.bar,
      child: Opacity(
        opacity: _visible ? 1 : 0,
        child: SizedBox(
          height: height,
          child: ListView.separated(
            controller: _scroll,
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: widget.theme.barPadding, vertical: 4),
            itemCount: feed.groups.length,
            separatorBuilder: (_, __) => SizedBox(width: m.gap),
            itemBuilder: (context, i) {
              final g = feed.groups[i];
              return StoryCircle(
                key: _circleKeys.putIfAbsent(g.id, GlobalKey.new),
                group: g,
                width: m.width,
                height: m.height,
                radius: m.radius,
                seen: seen.isGroupSeen(g),
                theme: widget.theme,
                opening: _opening == i,
                onTap: () => _openIndex(i),
              );
            },
          ),
        ),
      ),
    );
  }
}
