// Conformance: every case in /spec/cases must give its `expect` result with the Dart code,
// exactly as it does for the TypeScript SDKs (see spec/README.md).
import 'dart:convert';
import 'dart:io';

import 'package:collection/collection.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stories_sdk/stories_core.dart';

final _spec = Directory('../../spec');
const _eq = DeepCollectionEquality();

/// JSON round trip, so results compare like the decoded expectations (1 == 1.0, no nulls kept
/// where the TypeScript side leaves keys out).
Object? _json(Object? value) => jsonDecode(jsonEncode(value));

void main() {
  test('constants match spec/constants.json', () {
    final c = jsonDecode(File('${_spec.path}/constants.json').readAsStringSync()) as Map;
    expect(c['viewableMs'], {'image': viewableMs.image, 'video': viewableMs.video});
    expect(c['tapMaxMs'], tapMaxMs);
    expect(c['sessionTimeoutMs'], sessionTimeoutMs);
    expect(c['viewerIdMaxAgeMs'], viewerIdMaxAgeMs);
    expect(c['seenMaxIds'], seenMaxIds);
    expect(c['analytics'], {'flushIntervalMs': 5000, 'maxBatch': 50, 'maxQueue': 500});
    expect((c['tags'] as Map)['pattern'], tagPattern.pattern.replaceAll(r'\$', r'$'));
    expect((c['tags'] as Map)['maxPerPerson'], maxUserTags);
    final labels = c['labels'] as Map;
    expect(labels['openGroup'], [StoriesLabels.openGroup('Sale', 1, false), StoriesLabels.openGroup('Sale', 3, true)]);
    expect(labels['storyPosition'], StoriesLabels.storyPosition('Sale', 0, 3));
    expect(labels['viewer'], StoriesLabels.viewer('Sale'));
    expect(labels['close'], StoriesLabels.close);
    expect(labels['share'], StoriesLabels.share);
    expect(labels['shareFailed'], StoriesLabels.shareFailed);
    expect(labels['loading'], StoriesLabels.loading);
    expect(labels['countdownUnits'], InteractionLabels.countdownUnits);
    expect(labels['countdownEnded'], InteractionLabels.countdownEnded);
    expect(labels['pollOption'], InteractionLabels.pollOption('Red', 40));
    expect(labels['slider'], InteractionLabels.slider('How hot?'));
    expect(labels['sliderAverage'], InteractionLabels.sliderAverage);
    expect(c['answersMaxIds'], answersMaxIds);
    expect((c['storage'] as Map)['answers'], 'stories:answers:<appId>');
    expect(c['interactions'], {
      'unitsPerWidth': interactionUnitsPerWidth,
      'defaultAccent': interactionDefaultAccent,
      'defaultEmoji': interactionDefaultEmoji,
      'correctColor': interactionCorrectColor,
      'wrongColor': interactionWrongColor,
    });
  });

  final files = _spec.listSync().isEmpty
      ? <File>[]
      : (Directory('${_spec.path}/cases').listSync().whereType<File>().where((f) => f.path.endsWith('.json')).toList()
        ..sort((a, b) => a.path.compareTo(b.path)));
  for (final file in files) {
    final data = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    final suite = data['suite'] as String;
    final run = _suites[suite];
    group('conformance: $suite', () {
      test('has an adapter', () => expect(run, isNotNull, reason: 'no Dart adapter for "$suite"'));
      if (run == null) return;
      for (final c in (data['cases'] as List).cast<Map<String, dynamic>>()) {
        test(c['name'] as String, () async {
          final actual = _json(await run(c['input'] as Map<String, dynamic>));
          final expected = c['expect'];
          if (!_eq.equals(actual, expected)) {
            fail('Expected:\n${const JsonEncoder.withIndent('  ').convert(expected)}\n'
                'Actual:\n${const JsonEncoder.withIndent('  ').convert(actual)}');
          }
        });
      }
    });
  }
}

typedef _Suite = Future<Object?> Function(Map<String, dynamic> input);

final Map<String, _Suite> _suites = {
  'viewer': _viewer,
  'feed': _feed,
  'tags': _tags,
  'links': _links,
  'gestures': _gestures,
  'seen': _seen,
  'analytics': _analytics,
  'sessions': _sessions,
  'interactions': _interactions,
  'display': (input) async => StoryLook.fromJson(input['story'] as Map).toJson(),
};

Future<Object?> _interactions(Map<String, dynamic> input) async {
  double r3(double v) => (v * 1000).round() / 1000;
  switch (input['op']) {
    case 'parse':
      return {'interactions': parseInteractions(input['interactions']).map((i) => i.toJson()).toList()};
    case 'place':
      final c = (input['container'] as List).cast<num>();
      final m = (input['media'] as List?)?.cast<num>();
      final p = placeInteraction(
        containerWidth: c[0].toDouble(),
        containerHeight: c[1].toDouble(),
        mediaWidth: m?[0].toDouble(),
        mediaHeight: m?[1].toDouble(),
        cover: input['fit'] == 'cover',
        x: (input['x'] as num).toDouble(),
        y: (input['y'] as num).toDouble(),
        width: (input['width'] as num).toDouble(),
      );
      return {'x': r3(p.x), 'y': r3(p.y), 'width': r3(p.width), 'scale': r3(p.scale)};
    case 'percentages':
      return {'percents': percentages((input['counts'] as List).cast<num>().map((n) => n.toInt()).toList())};
    case 'countdown':
      final c = countdownParts(DateTime.parse(input['endsAt'] as String), DateTime.parse(input['now'] as String));
      return {'ended': c.ended, 'days': c.days, 'hours': c.hours, 'minutes': c.minutes, 'seconds': c.seconds};
  }
  throw ArgumentError('unknown op');
}

// --- viewer -----------------------------------------------------------------------------

ViewerAction _action(Map a) => switch (a['type']) {
      'NEXT' => Next(auto: a['auto'] == true),
      'PREV' => const Prev(),
      'NEXT_GROUP' => const NextGroup(),
      'PREV_GROUP' => const PrevGroup(),
      'TICK' => Tick((a['ms'] as num).toInt()),
      'PAUSE' => const Pause(),
      'RESUME' => const Resume(),
      'MEDIA_LOADING' => const MediaLoading(),
      'HIDE' => const Hide(),
      'SHOW' => const Show(),
      'MEDIA_READY' => MediaReady(durationMs: a['durationMs'] as num?, failed: a['failed'] == true),
      'CLOSE' => const Close(),
      _ => throw ArgumentError('Unknown action ${a['type']}'),
    };

Future<Object?> _viewer(Map<String, dynamic> input) async {
  final groups = [
    for (final g in input['groups'] as List)
      GroupLike(
        id: g['id'] as String,
        stories: [
          for (final s in g['stories'] as List)
            StoryLike(
                id: s['id'] as String,
                durationMs: (s['durationMs'] as num).toInt(),
                type: (s['type'] as String?) ?? 'image'),
        ],
      ),
  ];
  final starts = (input['startStoryIndex'] as Map?) ?? const {};
  int start(int g) => (starts['$g'] as num?)?.toInt() ?? 0;
  Map<String, Object?> snap(ViewerState s) => {
        'at': s.open ? groups[s.groupIndex].stories[s.storyIndex].id : 'closed',
        ...s.toJson(),
      };
  final opened = openViewer(groups, (input['open'] as num).toInt(), startStoryIndex: start);
  var state = opened;
  final steps = <Object?>[];
  for (final raw in input['steps'] as List) {
    final action = _action(raw as Map);
    final next = reduce(state, action, groups, startStoryIndex: start);
    final events = [...actionEvents(state, action, groups), ...transitionEvents(state, next, groups)];
    state = next;
    steps.add({
      'action': raw,
      'state': snap(next),
      'events': [for (final e in events) e.toJson()],
      'progress': progressSegments(next, groups),
    });
  }
  return {
    'opened': snap(opened),
    'events': [for (final e in transitionEvents(closed, opened, groups)) e.toJson()],
    'steps': steps,
  };
}

// --- feed / tags / links ------------------------------------------------------------------

Future<Object?> _feed(Map<String, dynamic> input) async {
  try {
    return {'feed': normalizeFeedJson(input['body'])};
  } on StoriesException catch (e) {
    return {'error': e.code};
  }
}

Future<Object?> _tags(Map<String, dynamic> input) async {
  if (input['op'] == 'normalize') return {'tags': normalizeTags(input['tags'])};
  return {
    'matches': matchesTagFilter(
      [for (final c in input['conditions'] as List) TagCondition.fromJson(c as Map<String, dynamic>)],
      {for (final t in input['tags'] as List) t as String},
    ),
  };
}

Future<Object?> _links(Map<String, dynamic> input) async {
  final target = input['target'] as Map?;
  switch (input['op']) {
    case 'shareUrl':
      return {
        'url': shareUrl(input['pageUrl'] as String,
            groupId: target!['groupId'] as String, storyId: target['storyId'] as String?)
      };
    case 'parseShareLink':
      final t = parseShareLink(input['url'] as String);
      return {
        'target': t == null ? null : {'groupId': t.groupId, if (t.storyId != null) 'storyId': t.storyId},
      };
    case 'withoutShareLink':
      return {'url': withoutShareLink(input['url'] as String)};
    case 'appShareUrl':
      return {
        'url': appShareUrl(input['template'] as String,
            groupId: target!['groupId'] as String, storyId: target['storyId'] as String)
      };
    case 'ctaAllowed':
      return {
        'allowed': isAllowedCtaUrl(
            input['url'] as String, [for (final s in (input['schemes'] as List?) ?? const []) s as String])
      };
    case 'ctaStyle':
      final style = CtaStyle.fromJson(input['style']);
      return {'style': style.json, 'swipe': style.isSwipe};
  }
  throw ArgumentError('Unknown links op ${input['op']}');
}

// --- gestures / seen ----------------------------------------------------------------------

Future<Object?> _gestures(Map<String, dynamic> input) async {
  final calls = <Object?>[];
  num round(num v) => (v * 1000).round() / 1000;
  final r = GestureRecognizer(GestureHandlers(
    onPress: () => calls.add(['press']),
    onRelease: () => calls.add(['release']),
    onTap: (x) => calls.add(['tap', round(x)]),
    onSwipe: (d) => calls.add(['swipe', d.name]),
    onDrag: (dx, dy) => calls.add(['drag', dx, dy]),
  ));
  final width = (input['width'] as num).toDouble();
  for (final e in input['events'] as List) {
    final a = e as List;
    double n(int i) => (a[i] as num).toDouble();
    switch (a[0]) {
      case 'down':
        r.down(n(1), n(2), (a[3] as num).toInt());
      case 'move':
        r.move(n(1), n(2));
      case 'up':
        r.up(n(1), n(2), (a[3] as num).toInt(), width);
      default:
        r.cancel();
    }
  }
  return {'calls': calls};
}

Future<Object?> _seen(Map<String, dynamic> input) async {
  final store = SeenStore(null, 'app');
  await store.load();
  GroupLike group(List ids) =>
      GroupLike(id: 'g', stories: [for (final id in ids) StoryLike(id: id as String, durationMs: 1)]);
  final results = <Object?>[];
  for (final raw in input['ops'] as List) {
    final op = raw as List;
    switch (op[0]) {
      case 'markSeen':
        store.markSeen(op[1] as String);
        results.add(null);
      case 'markMany':
        for (var i = 0; i < (op[2] as num); i++) {
          store.markSeen('${op[1]}$i');
        }
        results.add(null);
      case 'has':
        results.add(store.has(op[1] as String));
      case 'isGroupSeen':
        results.add(store.isGroupSeen(group(op[1] as List)));
      case 'firstUnseenIndex':
        results.add(store.firstUnseenIndex(group(op[1] as List)));
    }
  }
  return {'results': results};
}

// --- analytics / sessions -----------------------------------------------------------------

Future<Object?> _analytics(Map<String, dynamic> input) async {
  final options = input['options'] as Map;
  var now = 0;
  var failNext = 0;
  final sent = <Map<String, Object?>>[];
  final queue = AnalyticsQueue(
    url: 'https://api.example.com/v1/events?token=pk_live_x',
    sdk: options['sdk'] as String,
    sessionId: options['sessionId'] as String,
    maxBatch: (options['maxBatch'] as num?)?.toInt() ?? 50,
    maxQueue: (options['maxQueue'] as num?)?.toInt() ?? 500,
    platform: options['platform'] as String?,
    automation: options['automation'] == true,
    viewer: options['viewer'] == null ? null : () => options['viewer'] as String,
    flushInterval: const Duration(days: 365),
    now: () => now,
    transport: (url, body, {required beacon}) async {
      sent.add({'body': jsonDecode(body), 'beacon': beacon});
      if (failNext > 0) {
        failNext--;
        throw Exception('network');
      }
    },
  );
  Future<void> settle() => Future<void>.delayed(Duration.zero);
  final steps = <Object?>[];
  for (final raw in input['steps'] as List) {
    final step = raw as Map;
    final before = sent.length;
    if (step['track'] != null) {
      now = (step['at'] as num?)?.toInt() ?? now;
      queue.track(Map<String, Object?>.from(step['track'] as Map));
      await settle();
    } else if (step['flush'] != null) {
      final f = step['flush'] as Map;
      failNext = (f['fail'] as num?)?.toInt() ?? 0;
      await queue.flush(beacon: f['beacon'] == true);
      await settle();
    }
    steps.add({'sent': sent.sublist(before), 'pending': queue.pending});
  }
  queue.cancelTimer();
  return {'steps': steps};
}

Future<Object?> _sessions(Map<String, dynamic> input) async {
  if (input['op'] == 'newSession') {
    return {'newSession': startsNewSession((input['leftAt'] as num?)?.toInt(), (input['now'] as num).toInt())};
  }
  final storage = MemoryStorage();
  final stored = input['stored'];
  if (input.containsKey('stored')) {
    await storage.setItem('stories:viewer', stored is String ? stored : jsonEncode(stored));
  }
  final id = await loadViewerId(storage, now: (input['now'] as num).toInt());
  final keptId = stored is Map ? stored['id'] : null;
  return {'kept': id != null && id == keptId, 'stored': await storage.getItem('stories:viewer') != null};
}
