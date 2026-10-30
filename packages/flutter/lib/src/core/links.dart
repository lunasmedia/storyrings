/// Share links and which story button links may open (spec/cases/links.json).
/// Works on strings rather than `Uri`, which re-encodes `%` in fragments.
library;

const _prefix = '#stories=';

/// Schemes that may never be opened from a story button.
const blockedSchemes = {'javascript', 'data', 'vbscript', 'file', 'blob', 'about'};

/// A button link is allowed when it's an absolute http(s) URL or uses one of the app's own
/// deep-link schemes.
bool isAllowedCtaUrl(String url, [List<String> deepLinkSchemes = const []]) {
  // Control characters and spaces can smuggle schemes past naive checks.
  if (RegExp(r'[\u0000- \u007f]').hasMatch(url)) return false;
  final match = RegExp(r'^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$', dotAll: true).firstMatch(url);
  if (match == null) return false;
  final scheme = match.group(1)!.toLowerCase();
  final rest = match.group(2)!;
  if (blockedSchemes.contains(scheme)) return false;
  if (scheme == 'http' || scheme == 'https') return RegExp(r'^//[^/?#]+').hasMatch(rest);
  return deepLinkSchemes.contains(scheme) && rest.isNotEmpty;
}

/// How the story button looks: a white pill, a dark pill or an outline, or a swipe up (a chevron
/// over the label, or over a white pill), where swiping up on the story opens the link.
enum CtaStyle {
  pill('pill'),
  dark('dark'),
  outline('outline'),
  swipe('swipe'),
  swipePill('swipe-pill');

  const CtaStyle(this.json);
  final String json;

  /// Anything unknown (or none, from older servers) is a pill.
  static CtaStyle fromJson(Object? value) =>
      CtaStyle.values.firstWhere((s) => s.json == value, orElse: () => CtaStyle.pill);

  /// Swiping up on the story opens the link.
  bool get isSwipe => this == swipe || this == swipePill;
}

/// A mobile app's link to a story: its share link (set in the dashboard) with {group} and
/// {story} filled in.
String appShareUrl(String template, {required String groupId, required String storyId}) =>
    template.split('{group}').join(Uri.encodeComponent(groupId)).split('{story}').join(Uri.encodeComponent(storyId));

/// Websites: a link to a story on a page (any existing fragment is replaced).
String shareUrl(String pageUrl, {required String groupId, String? storyId}) {
  final hash = pageUrl.indexOf('#');
  final base = hash == -1 ? pageUrl : pageUrl.substring(0, hash);
  return '$base$_prefix${Uri.encodeComponent(groupId)}'
      '${storyId != null ? '/${Uri.encodeComponent(storyId)}' : ''}';
}

/// The story a web share link points to, or null.
({String groupId, String? storyId})? parseShareLink(String url) {
  final uri = Uri.tryParse(url);
  if (uri == null || !uri.hasScheme) return null;
  final hash = url.indexOf('#');
  if (hash == -1 || !url.startsWith(_prefix, hash)) return null;
  final parts = url.substring(hash + _prefix.length).split('/');
  if (parts.isEmpty || parts[0].isEmpty || parts.length > 2) return null;
  try {
    final groupId = Uri.decodeComponent(parts[0]);
    return parts.length == 2 && parts[1].isNotEmpty
        ? (groupId: groupId, storyId: Uri.decodeComponent(parts[1]))
        : (groupId: groupId, storyId: null);
  } catch (_) {
    return null;
  }
}

/// The URL without a web share link fragment (other fragments are kept).
String withoutShareLink(String url) {
  if (parseShareLink(url) == null) return url;
  return url.substring(0, url.indexOf('#'));
}
