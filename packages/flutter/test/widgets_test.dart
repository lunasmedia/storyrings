import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:stories_sdk/stories_sdk.dart';

Map<String, Object?> _story(String id, {String? title, Map<String, String>? cta}) => {
      'id': id,
      'type': 'image',
      'url': 'https://cdn.example.com/$id.jpg',
      'durationMs': 5000,
      'width': 1080,
      'height': 1920,
      'alt': 'Slide $id',
      if (title != null) 'title': title,
      'cta': cta,
    };

Map<String, Object?> _feed({bool sharing = false, String? shareLink}) => {
      'app': {
        'id': 'app-1',
        'deepLinkSchemes': ['myshop'],
        'sharing': sharing,
        if (shareLink != null) 'shareLink': shareLink,
      },
      'bar': {'id': 'bar-1', 'key': 'main'},
      'groups': [
        {
          'id': 'g1',
          'title': 'Sale',
          'coverUrl': 'https://cdn.example.com/c1.png',
          'updatedAt': '2026-10-20T00:00:00Z',
          'stories': [
            _story('s1', title: 'First'),
            _story('s2', title: 'Second', cta: {'label': 'Shop now', 'url': 'https://shop.example.com/sale'}),
          ],
        },
        {
          'id': 'g2',
          'title': 'New in',
          'coverUrl': 'https://cdn.example.com/c2.png',
          'updatedAt': '2026-10-20T00:00:00Z',
          'stories': [_story('s3', title: 'Third')],
        },
      ],
    };

/// A fake Stories API: serves [body] for the feed and records analytics batches.
class _Api {
  _Api(this.body, {this.status = 200});
  final Object? body;
  final int status;
  final feedUrls = <Uri>[];
  final events = <Map<String, Object?>>[];
  final answers = <Map<String, Object?>>[];

  late final client = MockClient((req) async {
    if (req.url.path == '/v1/feed') {
      feedUrls.add(req.url);
      return http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
    }
    if (req.url.path == '/v1/answers') {
      answers.add(jsonDecode(req.body) as Map<String, Object?>);
      return http.Response(
          jsonEncode({
            'results': {
              'total': 4,
              'counts': [3, 1]
            }
          }),
          200);
    }
    final batch = jsonDecode(req.body) as Map<String, Object?>;
    events.addAll((batch['events'] as List).cast<Map<String, Object?>>());
    return http.Response('', 204);
  });

  List<String> get eventTypes => [for (final e in events) e['type'] as String];
}

var _n = 0;

/// Starts a client on a fresh token, so tests don't share state.
StoriesClient _start(_Api api) => StoriesClient.start(
      token: 'pk_live_test${_n++}',
      apiUrl: 'https://api.example.com',
      storage: MemoryStorage(),
      httpClient: api.client,
    );

Future<void> _pumpBar(
  WidgetTester tester,
  StoriesClient client, {
  String? bar,
  List<String> tags = const [],
  StoriesBarController? controller,
  void Function(StoriesException)? onFail,
  void Function(CloseReason)? onClose,
  CtaClickHandler? onCtaClick,
  ShareHandler? onShare,
  StoriesTransition transition = StoriesTransition.slide,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: StoriesBar(
        token: client.token,
        apiUrl: client.apiUrl,
        storage: client.storage,
        bar: bar,
        tags: tags,
        controller: controller,
        onFail: onFail,
        onClose: onClose,
        onCtaClick: onCtaClick,
        onShare: onShare,
        transition: transition,
      ),
    ),
  ));
  // Feed, cover wait and reveal.
  await tester.pump(const Duration(milliseconds: 600));
  await tester.pump(const Duration(milliseconds: 600));
}

/// A pushed or popped route shows from the next frame, then animates.
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

/// Lets analytics batches go out, then stops the client so no timers are left running.
Future<void> _finish(WidgetTester tester, StoriesClient client) async {
  await tester.pump(const Duration(seconds: 6));
  client.dispose();
  await tester.pump();
}

void main() {
  testWidgets('shows a circle per group, labelled for screen readers', (tester) async {
    final api = _Api(_feed());
    final client = _start(api);
    await _pumpBar(tester, client);
    expect(find.bySemanticsLabel('Sale, 2 stories'), findsOneWidget);
    expect(find.bySemanticsLabel('New in, 1 story'), findsOneWidget);
    expect(find.text('Sale'), findsOneWidget);
    await _finish(tester, client);
    expect(api.eventTypes, contains('app_open'));
    expect(api.eventTypes.where((t) => t == 'impression').length, 2);
  });

  testWidgets('sends the bar key and normalised tags with the feed request', (tester) async {
    final api = _Api(_feed());
    final client = _start(api);
    await _pumpBar(tester, client, bar: 'Product-Page', tags: const ['Premium', ' london ']);
    final url = api.feedUrls.single;
    expect(url.queryParameters['bar'], 'product-page');
    expect(url.queryParameters['tags'], 'london,premium');
    await _finish(tester, client);
  });

  testWidgets('hides itself and reports a rejected token', (tester) async {
    final api = _Api({
      'error': {'code': 'unauthorized'}
    }, status: 401);
    final client = _start(api);
    StoriesException? error;
    await _pumpBar(tester, client, onFail: (e) => error = e);
    expect(error?.code, 'invalid_token');
    expect(find.byType(GestureDetector), findsNothing);
    await _finish(tester, client);
  });

  testWidgets('opens the viewer, taps forward, closes, and reports each step', (tester) async {
    final api = _Api(_feed());
    final client = _start(api);
    CloseReason? closed;
    await _pumpBar(tester, client, onClose: (r) => closed = r);
    await tester.tap(find.bySemanticsLabel('Sale, 2 stories'));
    await _settle(tester);
    expect(find.text('First'), findsOneWidget);

    // A tap on the right side moves to the next story.
    // Test screens are 800×600: this is the right side (anything past 30% goes forward).
    await tester.tapAt(const Offset(640, 300));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Second'), findsOneWidget);

    await tester.tap(find.byTooltip('Close stories'));
    await _settle(tester);
    expect(closed, CloseReason.user);
    expect(find.text('Second'), findsNothing);

    await _finish(tester, client);
    expect(api.eventTypes, containsAllInOrder(['group_open', 'tap_forward', 'exit']));
    final tap = api.events.firstWhere((e) => e['type'] == 'tap_forward');
    expect(tap, containsPair('storyId', 's1'));
  });

  testWidgets('keeps the group\'s cover in the header while moving between stories', (tester) async {
    final api = _Api(_feed());
    final client = _start(api);
    await _pumpBar(tester, client);
    await tester.tap(find.bySemanticsLabel('Sale, 2 stories'));
    await _settle(tester);
    Element cover() => tester.element(find.descendant(
        of: find.byKey(const ValueKey('header')),
        matching: find.byWidgetPredicate((w) => w is Image && w.image is NetworkImage)));
    final before = cover();

    // The next story is still loading, so the spinner shows: the header mustn't be rebuilt.
    await tester.tapAt(const Offset(640, 300));
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.text('Second'), findsOneWidget);
    expect(identical(cover(), before), isTrue);

    await tester.tap(find.byTooltip('Close stories'));
    await _settle(tester);
    await _finish(tester, client);
  });

  testWidgets('lets the app handle a story button', (tester) async {
    final api = _Api(_feed());
    final client = _start(api);
    final controller = StoriesBarController();
    String? opened;
    await _pumpBar(tester, client, controller: controller, onCtaClick: (e) {
      opened = e.url;
      e.close();
      return false;
    });
    expect(controller.open('g1'), isTrue);
    await _settle(tester);
    await tester.tapAt(const Offset(700, 300));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.text('Shop now'));
    await _settle(tester);
    expect(opened, 'https://shop.example.com/sale');
    await _finish(tester, client);
    expect(api.eventTypes, contains('cta_click'));
  });

  testWidgets('shows Share only when sharing is on, with the story link filled in', (tester) async {
    final off = _Api(_feed());
    final offClient = _start(off);
    final controller = StoriesBarController();
    await _pumpBar(tester, offClient, controller: controller);
    controller.open('g2');
    await _settle(tester);
    expect(find.byTooltip('Share story'), findsNothing);
    await tester.tap(find.byTooltip('Close stories'));
    await _settle(tester);
    await _finish(tester, offClient);

    final on = _Api(_feed(sharing: true, shareLink: 'https://news.example.com/stories/{group}/{story}'));
    final onClient = _start(on);
    ShareEvent? shared;
    await _pumpBar(tester, onClient, controller: controller, onShare: (e) {
      shared = e;
      return false;
    });
    controller.open('g2');
    await _settle(tester);
    await tester.tap(find.byTooltip('Share story'));
    await tester.pump();
    expect(shared?.url, 'https://news.example.com/stories/g2/s3');
    expect(shared?.title, 'Third');
    await tester.tap(find.byTooltip('Close stories'));
    await _settle(tester);
    await _finish(tester, onClient);
    expect(on.eventTypes, contains('share'));
  });

  testWidgets('zoom opens from the circle and closes back into it', (tester) async {
    final api = _Api(_feed());
    final client = _start(api);
    CloseReason? closed;
    await _pumpBar(tester, client, onClose: (r) => closed = r, transition: StoriesTransition.zoom);
    final circle = tester.getRect(find.bySemanticsLabel('Sale, 2 stories'));
    await tester.tap(find.bySemanticsLabel('Sale, 2 stories'));
    // Past the brief wait for the first image (it never loads in tests), then the route's first frames.
    await tester.pump(const Duration(milliseconds: 260));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 16));
    // Early in the zoom the story is drawn small, near the circle; then it grows to full size.
    final story = find.text('First');
    expect(story, findsOneWidget);
    final early = tester.getRect(story);
    expect(early.center.dy, lessThan(circle.bottom + 120));
    await tester.pump(const Duration(milliseconds: 600));
    expect(tester.getRect(story).width, greaterThan(early.width * 2));

    await tester.tap(find.byTooltip('Close stories'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(closed, CloseReason.user);
    expect(find.text('First'), findsNothing);
    await _finish(tester, client);
  });

  testWidgets('votes in a poll without leaving the story, and shows the results', (tester) async {
    final body = _feed();
    final story = ((body['groups'] as List)[0] as Map)['stories'][0] as Map<String, Object?>;
    story['interactions'] = [
      {
        'id': 'p1',
        'kind': 'poll',
        'x': 540,
        'y': 1200,
        'width': 760,
        'accent': '#c2255c',
        'question': 'Which?',
        'options': ['Red', 'Blue']
      },
    ];
    final api = _Api(body);
    final client = _start(api);
    await _pumpBar(tester, client);
    await tester.tap(find.bySemanticsLabel('Sale, 2 stories'));
    await _settle(tester);
    expect(find.text('Which?'), findsOneWidget);

    await tester.tap(find.text('Red'));
    await tester.pump();
    expect(find.text('✓ Red'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 50));
    // With the anonymous viewer ID (reach is on by default), so one person counts once.
    expect(api.answers.single,
        allOf(containsPair('storyId', 's1'), containsPair('interactionId', 'p1'), containsPair('value', 0)));
    expect(api.answers.single['viewer'], isA<String>());
    expect(find.text('75%'), findsOneWidget);
    expect(find.text('25%'), findsOneWidget);
    // Still the first story: the tap didn't move on.
    expect(find.text('First'), findsOneWidget);
    await _finish(tester, client);
  });
}
