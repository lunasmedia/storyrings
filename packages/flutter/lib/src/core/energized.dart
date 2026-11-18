// The Energized style's order (spec/cases/energized.json).
import 'machine.dart';

/// How long each group's story previews in its card before the next card takes a turn.
const energizedPreviewMs = 7000;

/// The card previewing now: which group, its story (always the first), and which turn this is.
class EnergizedPreview {
  const EnergizedPreview(
      {required this.groupIndex, required this.storyIndex, required this.storyId, required this.turn});
  final int groupIndex;
  final int storyIndex;
  final String storyId;

  /// Goes up every time a preview starts (even the same group again): restart the media.
  final int turn;

  Map<String, Object> toJson() =>
      {'groupIndex': groupIndex, 'storyIndex': storyIndex, 'storyId': storyId, 'turn': turn};

  @override
  bool operator ==(Object other) =>
      other is EnergizedPreview &&
      other.groupIndex == groupIndex &&
      other.storyIndex == storyIndex &&
      other.storyId == storyId &&
      other.turn == turn;

  @override
  int get hashCode => Object.hash(groupIndex, storyIndex, storyId, turn);
}

/// One group at a time shows its first story (only ever the first, seen or not) inside its card
/// for [energizedPreviewMs], then the next group does, through every group in bar order and back to
/// the first; the UI scrolls each card into view for its turn. It starts from the first fully
/// visible group. When the bar is scrolled so that the card previewing is no longer fully
/// visible, it starts again from the first visible one. The UI reports which cards are fully on
/// screen, passes time with [tick] and draws [current].
class EnergizedCycle {
  EnergizedCycle(this._groups) {
    _order = _withStories(Iterable.generate(_groups.length));
  }

  List<GroupLike> _groups;

  /// Indexes of the groups with stories, in bar order: the turns go through these.
  List<int> _order = const [];

  /// Indexes of the groups with stories whose cards are fully on screen.
  List<int> _visible = const [];

  /// Where in [_order] the preview is, or -1 when nothing previews.
  int _position = -1;
  int _elapsed = 0;
  int _turns = 0;

  /// New feed: starts again from the first visible group that still has stories.
  void setGroups(List<GroupLike> groups) {
    _groups = groups;
    _order = _withStories(Iterable.generate(groups.length));
    _visible = _withStories(_visible);
    _restart();
  }

  /// Indexes of the groups whose cards are fully on screen, in any order. Groups without
  /// stories are skipped. While the card previewing is among them nothing changes (the bar
  /// scrolled to it, or only a little); otherwise it starts again from the first.
  void setVisible(Iterable<int> indexes) {
    _visible = _withStories(indexes);
    final index = _currentIndex;
    if (index != null && _visible.contains(index)) return;
    _restart();
  }

  /// Time passing (only while previews may play: on screen, nothing covering the bar).
  void tick(int ms) {
    if (_position < 0 || ms <= 0) return;
    _elapsed += ms;
    while (_elapsed >= energizedPreviewMs) {
      _elapsed -= energizedPreviewMs;
      _position = (_position + 1) % _order.length;
      _turns++;
    }
  }

  /// Milliseconds left of the current preview (for scheduling the next tick).
  int get remainingMs => _position < 0 ? 0 : energizedPreviewMs - _elapsed;

  EnergizedPreview? get current {
    final groupIndex = _currentIndex;
    if (groupIndex == null) return null;
    final group = _groups[groupIndex];
    if (group.stories.isEmpty) return null;
    return EnergizedPreview(groupIndex: groupIndex, storyIndex: 0, storyId: group.stories.first.id, turn: _turns);
  }

  int? get _currentIndex => _position >= 0 && _position < _order.length ? _order[_position] : null;

  /// From the first visible group, or nothing when none is.
  void _restart() {
    _elapsed = 0;
    _position = _visible.isEmpty ? -1 : _order.indexOf(_visible.first);
    if (_position >= 0) _turns++;
  }

  List<int> _withStories(Iterable<int> indexes) =>
      indexes.toSet().where((i) => i >= 0 && i < _groups.length && _groups[i].stories.isNotEmpty).toList()..sort();
}
