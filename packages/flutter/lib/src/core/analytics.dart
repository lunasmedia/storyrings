/// Batches analytics events (spec/cases/analytics.json) and sends them to /v1/events.
library;

import 'dart:async';
import 'dart:convert';

import 'session.dart';

/// Sends one batch. `beacon`: the app is going away, so the send isn't retried.
typedef Transport = Future<void> Function(String url, String body, {required bool beacon});

/// Batches events and sends them every few seconds, or at once when a batch is full.
class AnalyticsQueue {
  AnalyticsQueue({
    required this.url,
    required this.sdk,
    required this.transport,
    this.flushInterval = const Duration(seconds: 5),
    this.maxBatch = 50,
    this.maxQueue = 500,
    int Function()? now,
    String? sessionId,
    this.viewer,
    this.platform,
    this.automation = false,
  })  : _now = now ?? (() => DateTime.now().millisecondsSinceEpoch),
        sessionId = sessionId ?? randomId();

  final String url;

  /// e.g. "flutter@1.0.0".
  final String sdk;
  final Transport transport;
  final Duration flushInterval;
  final int maxBatch;

  /// Cap on events held while the network is failing (the oldest are dropped).
  final int maxQueue;
  final int Function() _now;
  final String sessionId;

  /// The anonymous viewer ID, read when sending (null = unique viewers aren't counted).
  final String? Function()? viewer;

  /// ios or android.
  final String? platform;
  final bool automation;

  final _queue = <Map<String, Object?>>[];
  Timer? _timer;
  Future<void>? _inFlight;

  int get pending => _queue.length;

  /// Queues an event (a story event's or activity event's JSON) with the current time.
  void track(Map<String, Object?> event) {
    _queue.add({...event, 'ts': _now()});
    if (_queue.length > maxQueue) _queue.removeRange(0, _queue.length - maxQueue);
    if (_queue.length >= maxBatch) {
      unawaited(flush());
    } else {
      _schedule();
    }
  }

  /// Sends everything queued. With [beacon] (the app is going away) failed sends aren't kept.
  Future<void> flush({bool beacon = false}) async {
    _clearTimer();
    if (_inFlight != null && !beacon) await _inFlight;
    while (_queue.isNotEmpty) {
      final take = _queue.length < maxBatch ? _queue.length : maxBatch;
      final batch = _queue.sublist(0, take);
      _queue.removeRange(0, take);
      final v = viewer?.call();
      final body = jsonEncode({
        'sdk': sdk,
        'sessionId': sessionId,
        if (v != null) 'viewer': v,
        if (platform != null) 'platform': platform,
        if (automation) 'automation': true,
        'events': batch,
      });
      final send = transport(url, body, beacon: beacon);
      if (beacon) {
        unawaited(send.catchError((_) {}));
        continue;
      }
      _inFlight = send;
      try {
        await send;
      } catch (_) {
        // Put the batch back and retry on the next flush.
        _queue.insertAll(0, batch);
        _schedule();
        return;
      } finally {
        _inFlight = null;
      }
    }
  }

  void dispose() {
    _clearTimer();
    unawaited(flush(beacon: true));
  }

  /// Stops the flush timer without sending (tests).
  void cancelTimer() => _clearTimer();

  void _schedule() {
    _timer ??= Timer(flushInterval, () {
      _timer = null;
      unawaited(flush());
    });
  }

  void _clearTimer() {
    _timer?.cancel();
    _timer = null;
  }
}
