/// The /v1/feed response: parsed defensively (spec/cases/feed.json), then typed for the UI.
library;

import 'interactions.dart';
import 'links.dart';
import 'machine.dart';

class StoriesException implements Exception {
  const StoriesException(this.code, this.message, {this.status});

  /// invalid_token, origin_not_allowed, unknown_bar, network, server, invalid_response.
  final String code;
  final String message;
  final int? status;
  @override
  String toString() => 'StoriesException($code): $message';
}

/// Shape and size of every item in the bar, from the dashboard.
class BarLayout {
  const BarLayout({required this.width, required this.height, required this.corner, required this.gap});
  final int width;
  final int height;

  /// Corner rounding as % of the shorter side: 50 = circle, 0 = square.
  final int corner;
  final int gap;

  double get cornerRadius => (width < height ? width : height) * corner / 100;

  Map<String, int> toJson() => {'width': width, 'height': height, 'corner': corner, 'gap': gap};

  static const defaults = BarLayout(width: 68, height: 68, corner: 50, gap: 14);
  static const _limits = {'width': (40, 160), 'height': (40, 240), 'corner': (0, 50), 'gap': (0, 48)};

  /// Fills in and clamps a layout; unknown or invalid values fall back to the defaults.
  static BarLayout resolve(Object? input) {
    final out = defaults.toJson();
    if (input is Map) {
      for (final MapEntry(key: key, value: (min, max)) in _limits.entries) {
        final v = input[key];
        if (v is! num || !v.isFinite) continue;
        out[key] = v.clamp(min, max).round();
      }
    }
    return BarLayout(width: out['width']!, height: out['height']!, corner: out['corner']!, gap: out['gap']!);
  }
}

/// Defensive parsing at the JSON level, exactly like the other SDKs: malformed groups and
/// stories are dropped rather than crashing the app. Unknown fields are kept.
Map<String, Object?> normalizeFeedJson(Object? body) {
  if (body is! Map || body['groups'] is! List || body['app'] == null || body['app'] is! Map) {
    throw const StoriesException('invalid_response', 'Unexpected feed format');
  }
  final app = body['app'] as Map;
  bool validStory(Object? s) =>
      s is Map &&
      s['id'] is String &&
      s['url'] is String &&
      (s['type'] == 'image' || s['type'] == 'video') &&
      s['durationMs'] is num &&
      (s['durationMs'] as num) > 0;
  final groups = <Map<String, Object?>>[];
  for (final g in body['groups'] as List) {
    if (g is! Map || g['id'] is! String || g['title'] is! String || g['stories'] is! List) continue;
    final stories = [
      for (final s in g['stories'] as List)
        if (validStory(s)) Map<String, Object?>.from(s as Map)
    ];
    if (stories.isEmpty) continue;
    groups.add({...Map<String, Object?>.from(g), 'stories': stories});
  }
  final bar = body['bar'];
  return {
    if (bar is Map && bar['key'] is String) 'bar': {'id': '${bar['id']}', 'key': bar['key']},
    'app': {
      'id': '${app['id']}',
      'deepLinkSchemes': app['deepLinkSchemes'] ?? const [],
      'sharing': app['sharing'] == true,
      if (app['shareLink'] is String) 'shareLink': app['shareLink'],
      if (app['layout'] is Map) 'layout': BarLayout.resolve(app['layout']).toJson(),
    },
    'groups': groups,
  };
}

class RingStyle {
  const RingStyle({
    required this.style,
    required this.colors,
    required this.angle,
    required this.width,
    required this.gap,
    required this.gapColor,
    required this.seenColor,
    required this.animation,
    required this.speed,
    required this.animateOnlyUnseen,
  });

  /// gradient, solid or none.
  final String style;
  final List<String> colors;
  final num angle;
  final num width;
  final num gap;

  /// "background", "transparent" or a hex colour.
  final String gapColor;
  final String seenColor;

  /// none, rotate, pulse or shimmer.
  final String animation;

  /// slow, normal or fast.
  final String speed;
  final bool animateOnlyUnseen;
}

class BadgeStyle {
  const BadgeStyle(
      {required this.type, required this.text, required this.background, required this.color, required this.position});

  /// none, preset, text, emoji or countdown.
  final String type;
  final String text;
  final String background;
  final String color;

  /// bottom or top-right.
  final String position;
}

class TitleStyle {
  const TitleStyle({required this.hidden, required this.color, required this.weight, required this.maxLines});
  final bool hidden;

  /// "inherit" or a hex colour.
  final String color;
  final int weight;
  final int maxLines;
}

/// A group's resolved circle style, as sent by the server (dashboard defaults when absent).
class Appearance {
  const Appearance({required this.ring, required this.badge, required this.title});
  final RingStyle ring;
  final BadgeStyle badge;
  final TitleStyle title;

  static const defaults = Appearance(
    ring: RingStyle(
      style: 'gradient',
      colors: ['#feda75', '#d62976', '#962fbf'],
      angle: 45,
      width: 3,
      gap: 2,
      gapColor: 'background',
      seenColor: '#c7c7cc',
      animation: 'none',
      speed: 'normal',
      animateOnlyUnseen: true,
    ),
    badge: BadgeStyle(type: 'none', text: '', background: '#e8175d', color: '#ffffff', position: 'bottom'),
    title: TitleStyle(hidden: false, color: 'inherit', weight: 400, maxLines: 1),
  );

  factory Appearance.fromJson(Object? json) {
    if (json is! Map) return defaults;
    const d = defaults;
    final r = json['ring'] is Map ? json['ring'] as Map : const {};
    final b = json['badge'] is Map ? json['badge'] as Map : const {};
    final t = json['title'] is Map ? json['title'] as Map : const {};
    T pick<T>(Map m, String k, T fallback) => m[k] is T ? m[k] as T : fallback;
    return Appearance(
      ring: RingStyle(
        style: pick(r, 'style', d.ring.style),
        colors: r['colors'] is List
            ? [
                for (final c in r['colors'] as List)
                  if (c is String) c
              ]
            : d.ring.colors,
        angle: pick(r, 'angle', d.ring.angle),
        width: pick(r, 'width', d.ring.width),
        gap: pick(r, 'gap', d.ring.gap),
        gapColor: pick(r, 'gapColor', d.ring.gapColor),
        seenColor: pick(r, 'seenColor', d.ring.seenColor),
        animation: pick(r, 'animation', d.ring.animation),
        speed: pick(r, 'speed', d.ring.speed),
        animateOnlyUnseen: pick(r, 'animateOnlyUnseen', d.ring.animateOnlyUnseen),
      ),
      badge: BadgeStyle(
        type: pick(b, 'type', d.badge.type),
        text: pick(b, 'text', d.badge.text),
        background: pick(b, 'background', d.badge.background),
        color: pick(b, 'color', d.badge.color),
        position: pick(b, 'position', d.badge.position),
      ),
      title: TitleStyle(
        hidden: pick(t, 'hidden', d.title.hidden),
        color: pick(t, 'color', d.title.color),
        weight: pick<num>(t, 'weight', d.title.weight).toInt(),
        maxLines: pick<num>(t, 'maxLines', d.title.maxLines).toInt(),
      ),
    );
  }

  /// Text in the badge, or null if there's none. Countdowns need the group's end date.
  String? badgeLabel(DateTime? endsAt, {DateTime? now}) {
    switch (badge.type) {
      case 'none':
        return null;
      case 'countdown':
        return endsAt == null ? null : formatCountdown(endsAt.difference(now ?? DateTime.now()).inMilliseconds);
      default:
        return badge.text.isEmpty ? null : badge.text;
    }
  }
}

/// "2d", "5h", "12m"; null once the time is up.
String? formatCountdown(int ms) {
  if (ms <= 0) return null;
  final minutes = (ms / 60000).ceil();
  if (minutes < 60) return '${minutes}m';
  final hours = minutes ~/ 60;
  if (hours < 48) return '${hours}h';
  return '${hours ~/ 24}d';
}

class FeedStory implements StoryLike {
  const FeedStory({
    required this.id,
    required this.type,
    required this.url,
    required this.durationMs,
    this.title,
    this.width,
    this.height,
    this.alt = '',
    this.ctaLabel,
    this.ctaUrl,
    this.ctaStyle = CtaStyle.pill,
    this.interactions = const [],
    this.look = const StoryLook(fills: false),
  });
  @override
  final String id;
  @override
  final String type;
  final String url;
  @override
  final int durationMs;
  final String? title;
  final int? width;
  final int? height;
  final String alt;
  final String? ctaLabel;
  final String? ctaUrl;
  final CtaStyle ctaStyle;

  /// Interactive stickers drawn over the image.
  final List<Interaction> interactions;

  /// How it fits the screen.
  final StoryLook look;

  factory FeedStory.fromJson(Map json) {
    final cta = json['cta'];
    return FeedStory(
      id: json['id'] as String,
      type: json['type'] as String,
      url: json['url'] as String,
      durationMs: (json['durationMs'] as num).round(),
      title: json['title'] is String ? json['title'] as String : null,
      width: json['width'] is num ? (json['width'] as num).toInt() : null,
      height: json['height'] is num ? (json['height'] as num).toInt() : null,
      alt: json['alt'] is String ? json['alt'] as String : '',
      ctaLabel: cta is Map && cta['label'] is String ? cta['label'] as String : null,
      ctaUrl: cta is Map && cta['url'] is String ? cta['url'] as String : null,
      ctaStyle: CtaStyle.fromJson(cta is Map ? cta['style'] : null),
      interactions: parseInteractions(json['interactions']),
      look: StoryLook.fromJson(json),
    );
  }
}

class FeedGroup implements GroupLike {
  const FeedGroup({
    required this.id,
    required this.title,
    required this.coverUrl,
    required this.stories,
    required this.appearance,
    this.coverVideoUrl,
    this.endsAt,
  });
  @override
  final String id;
  final String title;

  /// Still cover (also the poster of animated covers).
  final String coverUrl;

  /// Looping muted video for animated covers.
  final String? coverVideoUrl;
  @override
  final List<FeedStory> stories;
  final Appearance appearance;
  final DateTime? endsAt;

  factory FeedGroup.fromJson(Map json) {
    final cover = json['cover'];
    return FeedGroup(
      id: json['id'] as String,
      title: json['title'] as String,
      coverUrl: cover is Map && cover['image'] is String ? cover['image'] as String : '${json['coverUrl'] ?? ''}',
      coverVideoUrl: cover is Map && cover['video'] is String ? cover['video'] as String : null,
      stories: [for (final s in json['stories'] as List) FeedStory.fromJson(s as Map)],
      appearance: Appearance.fromJson(json['appearance']),
      endsAt: json['endsAt'] is String ? DateTime.tryParse(json['endsAt'] as String) : null,
    );
  }
}

class Feed {
  const Feed({
    required this.appId,
    required this.deepLinkSchemes,
    required this.sharing,
    required this.groups,
    this.shareLink,
    this.layout,
    this.barKey,
  });
  final String appId;
  final List<String> deepLinkSchemes;
  final bool sharing;

  /// The app's share link with {group}/{story} placeholders (set when sharing is on).
  final String? shareLink;
  final BarLayout? layout;
  final String? barKey;
  final List<FeedGroup> groups;

  /// From a raw /v1/feed body. Throws [StoriesException] for an unusable response.
  factory Feed.fromBody(Object? body) => Feed.fromNormalized(normalizeFeedJson(body));

  factory Feed.fromNormalized(Map<String, Object?> json) {
    final app = json['app'] as Map;
    final bar = json['bar'];
    return Feed(
      appId: app['id'] as String,
      deepLinkSchemes: [
        for (final s in app['deepLinkSchemes'] as List? ?? const [])
          if (s is String) s
      ],
      sharing: app['sharing'] == true,
      shareLink: app['shareLink'] as String?,
      layout: app['layout'] == null ? null : BarLayout.resolve(app['layout']),
      barKey: bar is Map ? bar['key'] as String? : null,
      groups: [for (final g in json['groups'] as List) FeedGroup.fromJson(g as Map)],
    );
  }
}
