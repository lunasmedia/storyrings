/// App sessions (active users) and the anonymous viewer ID (spec/cases/sessions.json).
library;

import 'dart:convert';
import 'dart:math';

import 'storage.dart';

/// A new app session starts after this long in the background (the Firebase rule).
const sessionTimeoutMs = 30 * 60000;

/// Whether coming back at [now], after leaving at [leftAt], starts a new session.
bool startsNewSession(int? leftAt, int now) => leftAt != null && now - leftAt >= sessionTimeoutMs;

/// Anonymous viewer IDs are replaced after 13 months, the usual limit for audience measurement.
const viewerIdMaxAgeMs = 395 * 86400000;
const _viewerKey = 'stories:viewer';

/// The anonymous ID used to count unique viewers: random, made on this device, with no link
/// to who the person is (the server only keeps a hash of it per app). Null without storage.
Future<String?> loadViewerId(KeyValueStorage? storage, {int? now}) async {
  if (storage == null) return null;
  final at = now ?? DateTime.now().millisecondsSinceEpoch;
  try {
    final raw = await storage.getItem(_viewerKey);
    Object? stored;
    try {
      stored = raw == null || raw.isEmpty ? null : jsonDecode(raw);
    } catch (_) {
      stored = null;
    }
    if (stored is Map &&
        stored['id'] is String &&
        stored['created'] is num &&
        at - (stored['created'] as num) < viewerIdMaxAgeMs) {
      return stored['id'] as String;
    }
    final fresh = randomId();
    await storage.setItem(_viewerKey, jsonEncode({'id': fresh, 'created': at}));
    return fresh;
  } catch (_) {
    return null;
  }
}

/// Forgets the ID (e.g. when someone withdraws consent).
Future<void> clearViewerId(KeyValueStorage? storage) async {
  try {
    await storage?.setItem(_viewerKey, '');
  } catch (_) {}
}

/// A random version 4 UUID.
String randomId() {
  final r = Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}
