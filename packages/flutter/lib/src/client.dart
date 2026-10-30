/// Loads feeds and holds per-app state (seen stories, analytics) shared by every story bar,
/// like the React Native SDK's client.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../stories_core.dart';

const sdkVersion = '0.1.0';

/// Persists in SharedPreferences (UserDefaults on iOS, SharedPreferences on Android).
class SharedPreferencesStorage implements KeyValueStorage {
  final _prefs = SharedPreferencesAsync();
  @override
  Future<String?> getItem(String key) => _prefs.getString(key);
  @override
  Future<void> setItem(String key, String value) => _prefs.setString(key, value);
}

class StoriesClient with WidgetsBindingObserver {
  StoriesClient._({
    required this.token,
    required String apiUrl,
    required this.analytics,
    required bool reach,
    KeyValueStorage? storage,
    http.Client? httpClient,
  })  : apiUrl = apiUrl.replaceFirst(RegExp(r'/$'), ''),
        storage = storage ?? SharedPreferencesStorage(),
        _http = httpClient ?? http.Client() {
    if (analytics) {
      _queue = AnalyticsQueue(
        url: '${this.apiUrl}/v1/events?token=${Uri.encodeComponent(token)}',
        sdk: 'flutter@$sdkVersion',
        viewer: () => _viewerId,
        platform: Platform.isIOS ? 'ios' : 'android',
        transport: _send,
      );
      if (reach) setReach(true);
      // A session starts now, and again after 30+ minutes away (the Firebase rule).
      _queue!.track(const ActivityEvent('app_open').toJson());
      WidgetsBinding.instance.addObserver(this);
    }
  }

  final String token;
  final String apiUrl;
  final bool analytics;
  final KeyValueStorage storage;
  final http.Client _http;
  AnalyticsQueue? _queue;
  String? _viewerId;
  bool _reachOn = false;
  int? _leftAt;
  final _feeds = <String, Future<Feed>>{};
  final _seen = <String, Future<SeenStore>>{};
  final _answers = <String, Future<AnswerStore>>{};

  static final _clients = <String, StoriesClient>{};

  /// One client per token / API URL / analytics setting, shared by every bar.
  /// Call it at app launch so sessions are counted before a bar is on screen.
  static StoriesClient start({
    required String token,
    required String apiUrl,
    bool analytics = true,
    bool reach = true,
    KeyValueStorage? storage,
    http.Client? httpClient,
  }) {
    if (token.isEmpty) throw ArgumentError('Stories: a public token is required');
    final key = '$token|$apiUrl|$analytics';
    return _clients[key] ??= StoriesClient._(
      token: token,
      apiUrl: apiUrl,
      analytics: analytics,
      reach: reach,
      storage: storage,
      httpClient: httpClient,
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (startsNewSession(_leftAt, DateTime.now().millisecondsSinceEpoch)) {
        _queue?.track(const ActivityEvent('app_open').toJson());
      }
      _leftAt = null;
    } else if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _leftAt ??= DateTime.now().millisecondsSinceEpoch;
      // Send what's queued before the app may be suspended.
      unawaited(_queue?.flush(beacon: true));
    }
  }

  /// Turns unique-viewer counting on or off (e.g. when someone gives or withdraws consent).
  /// Turning it off also deletes the stored anonymous ID.
  void setReach(bool enabled) {
    _reachOn = enabled && _queue != null;
    if (!_reachOn) {
      _viewerId = null;
      if (!enabled) unawaited(clearViewerId(storage));
      return;
    }
    unawaited(loadViewerId(storage).then((id) {
      if (_reachOn) _viewerId = id;
    }));
  }

  void track(StoryEvent event) => _queue?.track(event.toJson());

  String _feedKey(String bar, List<String> tags) =>
      'stories:feed:$token${bar.isEmpty ? '' : ':$bar'}${tags.isEmpty ? '' : '#${tags.join(',')}'}';

  /// Fetches a story bar's feed once and shares it between the bars showing it.
  /// [bar]: its key from the dashboard ('' = the main bar). [tags] must be normalised.
  Future<Feed> loadFeed({String bar = '', List<String> tags = const [], bool force = false}) {
    final key = _feedKey(bar, tags);
    final existing = _feeds[key];
    if (existing != null && !force) return existing;
    final future = _fetch(bar, tags).then((normalized) {
      // Remembered so the next launch can show the bar before the network answers.
      unawaited(storage.setItem(key, jsonEncode(normalized)).catchError((_) {}));
      return Feed.fromNormalized(normalized);
    });
    _feeds[key] = future;
    // Don't keep failures, so a later refresh can retry.
    future.catchError((Object _) {
      if (_feeds[key] == future) _feeds.remove(key);
      return Feed.fromNormalized(const {
        'app': {'id': ''},
        'groups': []
      });
    });
    return future;
  }

  /// A story bar's feed from the previous launch, if any.
  Future<Feed?> cachedFeed({String bar = '', List<String> tags = const []}) async {
    try {
      final raw = await storage.getItem(_feedKey(bar, tags));
      return raw == null || raw.isEmpty ? null : Feed.fromNormalized(jsonDecode(raw) as Map<String, Object?>);
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, Object?>> _fetch(String bar, List<String> tags) async {
    final query = {
      'token': token,
      if (bar.isNotEmpty) 'bar': bar,
      if (tags.isNotEmpty) 'tags': tags.join(','),
    };
    final url = Uri.parse('$apiUrl/v1/feed').replace(queryParameters: query);
    http.Response res;
    try {
      res = await _http.get(url).timeout(const Duration(seconds: 15));
    } catch (_) {
      throw const StoriesException('network', 'Could not reach the Stories API');
    }
    if (res.statusCode == 401) throw const StoriesException('invalid_token', 'Invalid Stories token', status: 401);
    if (res.statusCode == 404 && bar.isNotEmpty) {
      throw StoriesException('unknown_bar',
          'No story bar with the key "$bar" for this token. Check the key under Settings → Apps & websites in the dashboard.',
          status: 404);
    }
    if (res.statusCode >= 400) {
      throw StoriesException('server', 'Stories API error (${res.statusCode})', status: res.statusCode);
    }
    try {
      return normalizeFeedJson(jsonDecode(utf8.decode(res.bodyBytes)));
    } on StoriesException {
      rethrow;
    } catch (_) {
      throw StoriesException('invalid_response', 'Stories API returned invalid JSON', status: res.statusCode);
    }
  }

  Future<SeenStore> seenStore(String appId) => _seen[appId] ??= () async {
        final s = SeenStore(storage, appId);
        await s.load();
        return s;
      }();

  /// Answers to polls, quizzes and sliders kept on this device.
  Future<AnswerStore> answerStore(String appId) => _answers[appId] ??= () async {
        final s = AnswerStore(storage, appId);
        await s.load();
        return s;
      }();

  /// Sends an answer to a poll, quiz or slider; the results so far, or null if it failed.
  Future<AnswerResults?> sendAnswer(String storyId, String interactionId, int value) async {
    try {
      final res = await _http.post(
        Uri.parse(answersUrl(apiUrl, token)),
        headers: {'Content-Type': 'text/plain;charset=UTF-8'},
        body: answerBody(storyId, interactionId, value, _viewerId),
      );
      if (res.statusCode != 200) return null;
      final json = jsonDecode(res.body);
      return json is Map ? AnswerResults.fromJson(json['results']) : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> _send(String url, String body, {required bool beacon}) async {
    final res = await _http.post(Uri.parse(url), headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: body);
    if (res.statusCode >= 500) throw Exception('HTTP ${res.statusCode}');
  }

  /// Stops analytics and lifecycle observing (tests, or a sign-out that should stop counting).
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _queue?.dispose();
    _queue = null;
    _clients.removeWhere((_, c) => c == this);
  }
}
