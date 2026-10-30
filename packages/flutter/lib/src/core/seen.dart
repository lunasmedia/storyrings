/// Which stories this device has seen (spec/cases/seen.json).
library;

import 'dart:convert';

import 'machine.dart';
import 'storage.dart';

const seenMaxIds = 1000;

/// A group counts as seen when all of its current stories are, so adding a story makes its
/// ring active again. Only the newest [seenMaxIds] ids are kept.
class SeenStore {
  SeenStore(this._storage, String appId) : _key = 'stories:seen:$appId';
  final KeyValueStorage? _storage;
  final String _key;
  // Set literals keep insertion order, so the first id is the oldest.
  final _ids = <String>{};

  Future<void> load() async {
    try {
      final raw = await _storage?.getItem(_key);
      final parsed = raw == null || raw.isEmpty ? const [] : jsonDecode(raw);
      if (parsed is List) {
        _ids
          ..clear()
          ..addAll(parsed.whereType<String>());
      }
    } catch (_) {
      // Storage unavailable or corrupt: start empty.
    }
  }

  bool has(String storyId) => _ids.contains(storyId);

  void markSeen(String storyId) {
    if (!_ids.add(storyId)) return;
    // Insertion order: dropping from the front evicts the oldest.
    while (_ids.length > seenMaxIds) {
      _ids.remove(_ids.first);
    }
    _persist();
  }

  bool isGroupSeen(GroupLike group) => group.stories.isNotEmpty && group.stories.every((s) => _ids.contains(s.id));

  /// First unseen story in a group, or 0 if it's fully seen (it replays from the start).
  int firstUnseenIndex(GroupLike group) {
    final i = group.stories.indexWhere((s) => !_ids.contains(s.id));
    return i == -1 ? 0 : i;
  }

  void _persist() {
    _storage?.setItem(_key, jsonEncode(_ids.toList())).catchError((_) {});
  }
}
