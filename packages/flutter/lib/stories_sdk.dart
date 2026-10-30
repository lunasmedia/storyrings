/// Stories for Flutter: an Instagram-style story bar and full-screen viewer, managed in the
/// Stories dashboard.
///
/// ```dart
/// StoriesClient.start(token: 'pk_live_…', apiUrl: 'https://stories.example.com'); // at launch
/// StoriesBar(token: 'pk_live_…', apiUrl: 'https://stories.example.com')
/// ```
library;

export 'src/client.dart' show SharedPreferencesStorage, StoriesClient, sdkVersion;
export 'src/core/feed.dart' show Appearance, BarLayout, Feed, FeedGroup, FeedStory, StoriesException;
export 'src/core/machine.dart' show CloseReason;
export 'src/core/storage.dart' show KeyValueStorage, MemoryStorage;
export 'src/widgets/bar.dart' show StoriesBar, StoriesBarController;
export 'src/widgets/style.dart' show StoriesTheme;
export 'src/widgets/viewer.dart'
    show CtaClickEvent, CtaClickHandler, ShareEvent, ShareHandler, StoriesTransition, StoryOpenEvent;
