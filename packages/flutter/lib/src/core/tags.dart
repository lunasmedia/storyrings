/// User tags and story group tag filters (spec/cases/tags.json).
library;

/// Lowercase letters, digits and . _ : - (e.g. "london", "city:london").
final tagPattern = RegExp(r'^[a-z0-9][a-z0-9._:-]{0,63}$');
const maxUserTags = 50;

/// Lowercased, trimmed, de-duplicated and sorted; anything that isn't a valid tag is dropped.
/// Accepts a list or a comma-separated string.
List<String> normalizeTags(Object? tags) {
  final list = tags is String ? tags.split(',') : (tags is Iterable ? tags : const []);
  final out = <String>{};
  for (final raw in list) {
    if (raw is! String) continue;
    final tag = raw.trim().toLowerCase();
    if (tagPattern.hasMatch(tag)) out.add(tag);
  }
  final sorted = out.toList()..sort();
  return sorted.length > maxUserTags ? sorted.sublist(0, maxUserTags) : sorted;
}

class TagCondition {
  const TagCondition({required this.mode, required this.tags});
  factory TagCondition.fromJson(Map<String, dynamic> json) =>
      TagCondition(mode: json['mode'] as String, tags: List<String>.from(json['tags'] as List));

  /// 'include' (people with any of the tags pass) or 'exclude' (people with none of them pass).
  final String mode;
  final List<String> tags;
}

/// Every condition must pass.
bool matchesTagFilter(List<TagCondition> conditions, Set<String> tags) => conditions.every(
      (c) => c.mode == 'include' ? c.tags.any(tags.contains) : !c.tags.any(tags.contains),
    );
