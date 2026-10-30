/// Where the SDK keeps "seen" stories, the last feed and the anonymous viewer ID.
library;

abstract interface class KeyValueStorage {
  Future<String?> getItem(String key);
  Future<void> setItem(String key, String value);
}

/// For tests, or when nothing should persist.
class MemoryStorage implements KeyValueStorage {
  final _data = <String, String>{};
  @override
  Future<String?> getItem(String key) async => _data[key];
  @override
  Future<void> setItem(String key, String value) async => _data[key] = value;
}
