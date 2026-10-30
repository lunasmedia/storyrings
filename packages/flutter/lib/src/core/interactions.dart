/// Interactive stickers: polls, quizzes, emoji sliders, links and countdowns drawn over a
/// story's image (spec/README.md, "Interactions"; spec/cases/interactions.json).
library;

import 'dart:convert';
import 'dart:math' as math;

import 'storage.dart';

/// Sizes inside a sticker are in units of its displayed width / 600.
const interactionUnitsPerWidth = 600.0;
const interactionDefaultAccent = '#c2255c';
const interactionDefaultEmoji = '😍';
const interactionCorrectColor = '#2f9e44';
const interactionWrongColor = '#e03131';
const answersMaxIds = 200;
const _designWidth = 1080.0;
const _designHeight = 1920.0;

sealed class InteractionKind {
  const InteractionKind();
}

class PollKind extends InteractionKind {
  const PollKind(this.question, this.options);
  final String question;
  final List<String> options;
}

class QuizKind extends InteractionKind {
  const QuizKind(this.question, this.options, this.correct);
  final String question;
  final List<String> options;
  final int correct;
}

class SliderKind extends InteractionKind {
  const SliderKind(this.question, this.emoji);
  final String question;
  final String emoji;
}

class LinkKind extends InteractionKind {
  const LinkKind(this.label, this.url);
  final String label;
  final String url;
}

class CountdownKind extends InteractionKind {
  const CountdownKind(this.title, this.endsAtText, this.endsAt);
  final String title;

  /// As sent.
  final String endsAtText;
  final DateTime endsAt;
}

/// A sticker, placed by its centre ([x], [y]) and [width] in the image's 1080 × 1920 design space.
class Interaction {
  const Interaction({
    required this.id,
    required this.x,
    required this.y,
    required this.width,
    required this.accent,
    required this.kind,
  });
  final String id;
  final double x;
  final double y;
  final double width;

  /// "#rrggbb".
  final String accent;
  final InteractionKind kind;

  /// Polls, quizzes and sliders take answers.
  bool get answerable => kind is PollKind || kind is QuizKind || kind is SliderKind;

  Map<String, Object?> toJson() => {
        'id': id,
        'x': x,
        'y': y,
        'width': width,
        'accent': accent,
        ...switch (kind) {
          PollKind(:final question, :final options) => {'kind': 'poll', 'question': question, 'options': options},
          QuizKind(:final question, :final options, :final correct) => {
              'kind': 'quiz',
              'question': question,
              'options': options,
              'correct': correct,
            },
          SliderKind(:final question, :final emoji) => {'kind': 'slider', 'question': question, 'emoji': emoji},
          LinkKind(:final label, :final url) => {'kind': 'link', 'label': label, 'url': url},
          CountdownKind(:final title, :final endsAtText) => {'kind': 'countdown', 'title': title, 'endsAt': endsAtText},
        },
      };
}

final _hex = RegExp(r'^#[0-9a-fA-F]{6}$');

/// A story's `interactions` from the feed; malformed stickers are dropped.
List<Interaction> parseInteractions(Object? raw) {
  if (raw is! List) return const [];
  final out = <Interaction>[];
  for (final r in raw) {
    if (r is! Map) continue;
    final id = r['id'], x = r['x'], y = r['y'], width = r['width'];
    if (id is! String || x is! num || y is! num || width is! num || width <= 0) continue;
    final accent = r['accent'] is String && _hex.hasMatch(r['accent'] as String)
        ? r['accent'] as String
        : interactionDefaultAccent;
    String text(String key) => r[key] is String ? r[key] as String : '';
    final options =
        (r['options'] is List ? (r['options'] as List).whereType<String>() : const <String>[]).take(4).toList();
    final correct = r['correct'];
    final InteractionKind? kind = switch (r['kind']) {
      'poll' => options.length >= 2 ? PollKind(text('question'), options) : null,
      'quiz' =>
        options.length >= 2 && correct is num && correct == correct.floor() && correct >= 0 && correct < options.length
            ? QuizKind(text('question'), options, correct.toInt())
            : null,
      'slider' => SliderKind(text('question'), text('emoji').isEmpty ? interactionDefaultEmoji : text('emoji')),
      'link' => r['label'] is String && (r['label'] as String).isNotEmpty && r['url'] is String
          ? LinkKind(r['label'] as String, r['url'] as String)
          : null,
      'countdown' => switch (r['endsAt']) {
          final String s when DateTime.tryParse(s) != null => CountdownKind(text('title'), s, DateTime.parse(s)),
          _ => null,
        },
      _ => null,
    };
    if (kind != null) {
      out.add(
          Interaction(id: id, x: x.toDouble(), y: y.toDouble(), width: width.toDouble(), accent: accent, kind: kind));
    }
  }
  return out;
}

class Placement {
  const Placement(this.x, this.y, this.width, this.scale);

  /// Centre, in the viewer's coordinates.
  final double x;
  final double y;

  /// Displayed width.
  final double width;

  /// Displayed pixels per design pixel.
  final double scale;
}

/// Where a sticker goes on the story image as displayed: the image (its size, or 1080 × 1920 when
/// unknown) is fitted into the container (`cover` or `contain`), and the design space mapped onto it.
Placement placeInteraction({
  required double containerWidth,
  required double containerHeight,
  double? mediaWidth,
  double? mediaHeight,
  required bool cover,
  required double x,
  required double y,
  required double width,
}) {
  final mw = (mediaWidth ?? 0) > 0 ? mediaWidth! : _designWidth;
  final mh = (mediaHeight ?? 0) > 0 ? mediaHeight! : _designHeight;
  final s =
      cover ? math.max(containerWidth / mw, containerHeight / mh) : math.min(containerWidth / mw, containerHeight / mh);
  final w = mw * s, h = mh * s;
  final left = (containerWidth - w) / 2, top = (containerHeight - h) / 2;
  final k = w / _designWidth;
  return Placement(left + x * k, top + y * h / _designHeight, width * k, k);
}

/// Whole percentages that add up to 100 (largest remainder; ties go to the earlier option).
List<int> percentages(List<int> counts) {
  final total = counts.fold(0, (a, b) => a + b);
  if (total <= 0) return counts.map((_) => 0).toList();
  final exact = counts.map((c) => c * 100 / total).toList();
  final out = exact.map((e) => e.floor()).toList();
  var left = 100 - out.fold(0, (a, b) => a + b);
  final order = List.generate(exact.length, (i) => i)
    ..sort((a, b) {
      final ra = exact[a] - exact[a].floor(), rb = exact[b] - exact[b].floor();
      return ra != rb ? rb.compareTo(ra) : a.compareTo(b);
    });
  for (final i in order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

class CountdownParts {
  const CountdownParts(this.ended, this.days, this.hours, this.minutes, this.seconds);
  final bool ended;
  final int days;
  final int hours;
  final int minutes;
  final int seconds;
}

CountdownParts countdownParts(DateTime endsAt, [DateTime? now]) {
  final ms = endsAt.difference(now ?? DateTime.now()).inMilliseconds;
  final left = (ms / 1000).floor();
  if (left <= 0) return const CountdownParts(true, 0, 0, 0, 0);
  return CountdownParts(false, left ~/ 86400, left % 86400 ~/ 3600, left % 3600 ~/ 60, left % 60);
}

/// What people answered so far: votes per option (poll, quiz) or the average (slider, 0–100).
class AnswerResults {
  const AnswerResults(this.total, {this.counts, this.average});
  final int total;
  final List<int>? counts;
  final int? average;

  static AnswerResults? fromJson(Object? json) {
    if (json is! Map || json['total'] is! num) return null;
    return AnswerResults(
      (json['total'] as num).toInt(),
      counts: json['counts'] is List ? (json['counts'] as List).whereType<num>().map((n) => n.toInt()).toList() : null,
      average: json['average'] is num ? (json['average'] as num).toInt() : null,
    );
  }

  Map<String, Object?> toJson() => {
        'total': total,
        if (counts != null) 'counts': counts,
        if (average != null) 'average': average,
      };
}

/// A person's answer to a sticker, and the results they were shown.
class StoredAnswer {
  const StoredAnswer(this.value, [this.results]);
  final int value;
  final AnswerResults? results;
}

/// Answers kept on the device, so a story shows what the person answered when they come back.
/// Keyed by story and sticker; the oldest are dropped past [answersMaxIds].
class AnswerStore {
  AnswerStore(this._storage, String appId) : _key = 'stories:answers:$appId';
  final KeyValueStorage? _storage;
  final String _key;
  // Map literals keep insertion order, so the first entry is the oldest.
  final _map = <String, StoredAnswer>{};

  Future<void> load() async {
    try {
      final raw = await _storage?.getItem(_key);
      final parsed = raw == null || raw.isEmpty ? null : jsonDecode(raw);
      if (parsed is! Map) return;
      _map.clear();
      parsed.forEach((k, v) {
        if (k is String && v is Map && v['value'] is num) {
          _map[k] = StoredAnswer((v['value'] as num).toInt(), AnswerResults.fromJson(v['results']));
        }
      });
    } catch (_) {
      // Storage unavailable or corrupt: start empty.
    }
  }

  StoredAnswer? get(String storyId, String interactionId) => _map['$storyId:$interactionId'];

  void set(String storyId, String interactionId, StoredAnswer answer) {
    final k = '$storyId:$interactionId';
    _map
      ..remove(k)
      ..[k] = answer;
    while (_map.length > answersMaxIds) {
      _map.remove(_map.keys.first);
    }
    final out =
        _map.map((k, a) => MapEntry(k, {'value': a.value, if (a.results != null) 'results': a.results!.toJson()}));
    _storage?.setItem(_key, jsonEncode(out)).catchError((_) {});
  }
}

String answersUrl(String apiUrl, String token) {
  var base = apiUrl;
  while (base.endsWith('/')) {
    base = base.substring(0, base.length - 1);
  }
  return '$base/v1/answers?token=${Uri.encodeQueryComponent(token)}';
}

/// The JSON body of an answer.
String answerBody(String storyId, String interactionId, int value, String? viewer) => jsonEncode({
      'storyId': storyId,
      'interactionId': interactionId,
      'value': value,
      if (viewer != null) 'viewer': viewer,
    });

abstract final class InteractionLabels {
  static const countdownUnits = ['days', 'hours', 'mins', 'secs'];
  static const countdownEnded = 'Ended';
  static String pollOption(String option, int percent) => '$option, $percent%';
  static String slider(String question) => question.isEmpty ? 'Slide to answer' : '$question Slide to answer';
  static const sliderAverage = 'Average';
}

// --- Fitting the screen (spec/cases/display.json)

/// How a story fits the screen: covering it, or shown whole with the gaps in [fillTop]/[fillBottom].
class StoryLook {
  const StoryLook({required this.fills, this.fillTop, this.fillBottom, this.overlay});

  /// Covers the screen (edges may be cropped). False: shown whole ("fit").
  final bool fills;

  /// Gap colours for a story shown whole, top to bottom ("#rrggbb"); null = black.
  final String? fillTop;
  final String? fillBottom;

  /// A designed video's text and stickers: a transparent 1080 × 1920 image drawn over it, fitted
  /// as a story image would be. Videos only, http(s) only; null = none.
  final String? overlay;

  factory StoryLook.fromJson(Map json) {
    final fills = json['fit'] == 'fill';
    final f = json['fill'];
    String? hex(Object? v) => v is String && _hex.hasMatch(v) ? v : null;
    final top = f is Map ? hex(f['top']) : null;
    final bottom = f is Map ? hex(f['bottom']) : null;
    final o = json['overlay'];
    final overlay =
        json['type'] == 'video' && o is String && RegExp(r'^https?://', caseSensitive: false).hasMatch(o) ? o : null;
    return !fills && top != null && bottom != null
        ? StoryLook(fills: false, fillTop: top, fillBottom: bottom, overlay: overlay)
        : StoryLook(fills: fills, overlay: overlay);
  }

  Map<String, Object?> toJson() => {
        'fit': fills ? 'fill' : 'fit',
        'fill': fillTop != null && fillBottom != null ? {'top': fillTop, 'bottom': fillBottom} : null,
        'overlay': overlay,
      };
}
