package com.lunasmedia.storyrings

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.lunasmedia.storyrings.core.CloseReason
import com.lunasmedia.storyrings.core.Feed
import com.lunasmedia.storyrings.core.FeedGroup
import com.lunasmedia.storyrings.core.KeyValueStorage
import com.lunasmedia.storyrings.core.SeenStore
import com.lunasmedia.storyrings.core.StoriesException
import com.lunasmedia.storyrings.core.StoriesLabels
import com.lunasmedia.storyrings.core.StoryEvent
import com.lunasmedia.storyrings.core.normalizeTags

/** Viewability: how long a circle must stay at least half on screen to count as an impression. */
private const val IMPRESSION_MS = 1000L

/** Longest the bar stays hidden on launch while waiting for the live feed and covers. */
private const val REVEAL_WAIT_MS = 500L

/** Longest a tap waits for the first story's image before the viewer opens anyway. */
private const val OPEN_WAIT_MS = 1500L

/** How many groups, from the start of the bar, have their first story loaded with the feed. */
private const val PRELOAD_GROUPS = 4

/** How the viewer opens and closes. With "Remove animations" on, both are a short fade. */
enum class StoriesTransition {
    /** Slides up from the bottom; shrinks away towards the bottom of the screen. */
    SLIDE,

    /**
     * Springs out of the tapped circle and goes back into the circle of the group being watched
     * (slides when that circle isn't on screen, e.g. a group opened from code).
     */
    ZOOM,
}

/** Opens stories from code (a push notification, a deep link), and refreshes. Keep one per bar (e.g. `remember { }`). */
class StoriesBarController {
    internal var state: BarState? = null

    /** Live groups currently shown. */
    val groups: List<FeedGroup> get() = state?.feed?.groups.orEmpty()

    /** Opens the viewer at a group, by id. False until the feed has loaded, or if the group isn't live. */
    fun open(groupId: String): Boolean = state?.open(groupId) ?: false

    /** Closes the viewer if it's open. */
    fun close() {
        state?.viewer?.close()
    }

    /** Refetches the feed. */
    fun refresh() {
        state?.load(force = true)
    }
}

class BarCallbacks(
    val onLoad: ((List<FeedGroup>) -> Unit)? = null,
    val onFail: ((StoriesException) -> Unit)? = null,
    val onClose: ((CloseReason) -> Unit)? = null,
    val viewer: ViewerCallbacks = ViewerCallbacks(),
)

internal data class BarConfig(val token: String, val apiUrl: String, val bar: String, val tags: List<String>, val analytics: Boolean)

internal class BarState(private val client: StoriesClient, val config: BarConfig) {
    var feed by mutableStateOf<Feed?>(null)
        private set
    var seen by mutableStateOf<SeenStore?>(null)
        private set
    var visible by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    var viewer by mutableStateOf<ViewerController?>(null)
        private set
    /** Bumped when seen state changes, so rings redraw. */
    var seenVersion by mutableIntStateOf(0)
        private set

    var callbacks = BarCallbacks()
    private val handler = Handler(Looper.getMainLooper())
    private var fresh = false
    private var loadSeq = 0
    private val revealTask = Runnable { reveal() }
    var appActive = true
        set(value) {
            field = value
            // Offline at launch: try again when the app comes back.
            if (value && !failed && !fresh) load(force = true)
            reportImpressions()
        }

    // Circles' bounds in the window and their corner radius (px), for the zoom transition.
    private val circles = HashMap<String, Rect>()
    var cornerPx = 0f
    var transition = StoriesTransition.SLIDE

    // Impressions
    private var frames = HashMap<String, Rect>()
    private var viewport: Rect? = null
    private val impressed = HashSet<String>()
    private val pending = HashMap<String, Runnable>()

    fun start() {
        fresh = false
        failed = false
        loadSeq++
        // Lay out last launch's feed (hidden) while the live one loads; it shows if the network is slow.
        client.cachedFeed(config.bar, config.tags)?.let {
            feed = it
            seen = client.seenStore(it.appId)
        }
        handler.removeCallbacks(revealTask)
        handler.postDelayed(revealTask, REVEAL_WAIT_MS)
        load()
    }

    fun dispose() {
        loadSeq++
        opening = false
        handler.removeCallbacks(revealTask)
        pending.values.forEach(handler::removeCallbacks)
        pending.clear()
    }

    private fun reveal() {
        visible = true
        handler.post { reportImpressions() }
    }

    fun load(force: Boolean = false) {
        val seq = loadSeq
        client.loadFeed(config.bar, config.tags, force) { result ->
            if (seq != loadSeq) return@loadFeed
            result.onSuccess { loaded ->
                val seenStore = client.seenStore(loaded.appId)
                // Show new covers only once they're loaded, so they don't pop in.
                preloadCovers(loaded) {
                    if (seq != loadSeq) return@preloadCovers
                    feed = loaded
                    seen = seenStore
                    preloadFirstStories(loaded, seenStore)
                    fresh = true
                    failed = false
                    reveal()
                    callbacks.onLoad?.invoke(loaded.groups)
                }
            }.onFailure { e ->
                val error = e as? StoriesException ?: StoriesException("network", e.message ?: "Error")
                // Offline or a server hiccup: keep last launch's stories; anything else hides the bar.
                val temporary = error.code == "network" || error.code == "server"
                failed = !(temporary && feed != null)
                if (temporary && feed != null) reveal()
                callbacks.onFail?.invoke(error) ?: Log.w("Stories", error.message ?: error.code)
            }
        }
    }

    /**
     * Loads and decodes the story each of the first groups opens on, so tapping a circle opens it
     * at once. Loaded on the tap instead, a story not yet on the device made opening wait.
     */
    private fun preloadFirstStories(feed: Feed, seen: SeenStore) {
        for (group in feed.groups.take(PRELOAD_GROUPS)) {
            val first = group.stories.getOrNull(seen.firstUnseenIndex(group.storyIds)) ?: continue
            if (first.type == "image") ImageCache.load(first.url) {}
        }
    }

    private fun preloadCovers(feed: Feed, done: () -> Unit) {
        val urls = feed.groups.take(8).map { it.coverUrl }.filter { it.isNotEmpty() }
        var finished = false
        var remaining = urls.size
        val finish = {
            if (!finished) {
                finished = true
                done()
            }
        }
        if (remaining == 0) return finish()
        handler.postDelayed({ finish() }, REVEAL_WAIT_MS)
        // A missing cover just shows the placeholder; nothing to report.
        urls.forEach { url -> ImageCache.load(url) { if (--remaining == 0) finish() } }
    }

    fun track(event: StoryEvent) = client.track(if (config.bar.isEmpty()) event else event.withBar(config.bar))

    fun updateFrame(id: String, bounds: Rect) {
        frames[id] = bounds
        reportImpressions()
    }

    fun updateCircle(id: String, bounds: Rect) {
        circles[id] = bounds
    }

    /** Group [index]'s circle on screen, for the zoom transition; null when it isn't visible (it slides then). */
    fun origin(index: Int): ViewerOrigin? {
        if (transition != StoriesTransition.ZOOM) return null
        val id = feed?.groups?.getOrNull(index)?.id ?: return null
        val r = circles[id] ?: return null
        val port = viewport ?: return null
        val shown = minOf(r.right, port.right) - maxOf(r.left, port.left)
        val visible = shown >= r.width / 2 && r.bottom > port.top && r.top < port.bottom
        return if (visible && r.width > 0) ViewerOrigin(r, minOf(cornerPx, r.width / 2, r.height / 2)) else null
    }

    fun updateViewport(bounds: Rect) {
        viewport = bounds
        reportImpressions()
    }

    /**
     * One impression per group per bar, by the MRC/IAB rule: at least half the circle on screen
     * for one continuous second, while the app is active and the viewer is closed.
     */
    fun reportImpressions() {
        val showing = HashSet<String>()
        val feed = feed
        val port = viewport
        if (fresh && visible && viewer == null && appActive && feed != null && port != null) {
            for (g in feed.groups) {
                val f = frames[g.id] ?: continue
                if (g.id in impressed) continue
                val shown = minOf(f.right, port.right) - maxOf(f.left, port.left)
                val onScreenVertically = f.bottom > port.top && f.top < port.bottom
                if (onScreenVertically && shown >= f.width / 2) showing += g.id
            }
        }
        pending.entries.removeAll { (id, task) -> (id !in showing).also { if (it) handler.removeCallbacks(task) } }
        for (id in showing) {
            if (id in pending) continue
            val task = Runnable {
                pending.remove(id)
                if (impressed.add(id)) track(StoryEvent("impression", id))
            }
            pending[id] = task
            handler.postDelayed(task, IMPRESSION_MS)
        }
    }

    fun open(groupId: String): Boolean {
        val index = feed?.groups?.indexOfFirst { it.id == groupId } ?: -1
        if (index < 0) return false
        open(index)
        return true
    }

    private var opening = false
    /** The circle tapped to open the viewer, shown pressed while its first story loads. */
    var openingIndex by mutableStateOf<Int?>(null)
        private set

    fun open(index: Int) {
        val feed = feed ?: return
        val seen = seen ?: return
        if (viewer != null || opening) return
        val group = feed.groups.getOrNull(index) ?: return
        // Open once the first story's image is ready, so the viewer doesn't open on black and a
        // spinner. The first stories load with the feed (see preloadFirstStories), so this is
        // normally at once; meanwhile the circle stays pressed.
        val first = group.stories.getOrNull(seen.firstUnseenIndex(group.storyIds))
        val show = Runnable {
            if (!opening) return@Runnable
            opening = false
            openingIndex = null
            viewer = ViewerController(
                feed, index, seen, ::track, callbacks.viewer,
                answers = client.answerStore(feed.appId),
                sendAnswer = client::sendAnswer,
            )
            reportImpressions()
        }
        opening = true
        if (first == null || first.type != "image" || ImageCache.cached(first.url) != null) return show.run()
        openingIndex = index
        handler.postDelayed(show, OPEN_WAIT_MS)
        ImageCache.load(first.url) {
            handler.removeCallbacks(show)
            show.run()
        }
    }

    fun viewerFinished(reason: CloseReason) {
        viewer = null
        // Rings turn grey for what was just watched.
        seenVersion++
        callbacks.onClose?.invoke(reason)
        handler.post { reportImpressions() }
    }
}

/**
 * An Instagram-style story bar. Tapping a circle opens the full-screen viewer.
 *
 * ```kotlin
 * StoriesBar(token = "pk_live_…", apiUrl = "https://stories.example.com")
 * StoriesBar(token = "pk_live_…", apiUrl = "…", bar = "product-page")   // a second story bar
 * StoriesBar(token = "pk_live_…", apiUrl = "…", tags = listOf("london")) // the person's tags
 * ```
 *
 * @param token Public token from the dashboard (Settings → Apps & websites → your app).
 * @param apiUrl Your Stories server, e.g. https://stories.example.com.
 * @param bar Which story bar to show: its key from the dashboard. Null = the main bar.
 * @param tags The person's tags from your own user data (e.g. listOf("london", "premium")).
 *   Groups with an audience only show to people whose tags pass it. Never personal data such as
 *   emails or IDs. Changing them reloads the feed.
 * @param analytics Send analytics events.
 * @param reach Count unique viewers with an anonymous ID kept on the device. Pass false until
 *   the person consents if your privacy rules require it.
 * @param storage Where seen stories, the last feed and the anonymous ID are kept (default SharedPreferences).
 * @param transition How the viewer opens and closes: [StoriesTransition.SLIDE] (up from the bottom,
 *   shrinking away towards the bottom) or [StoriesTransition.ZOOM] (out of the tapped circle and back into it).
 * @param onCtaClick Return [CtaResult.HANDLED] to handle a story button's link yourself.
 * @param onShare Return [ShareResult.HANDLED] to share yourself (shown when sharing is on).
 */
@Composable
fun StoriesBar(
    token: String,
    apiUrl: String,
    modifier: Modifier = Modifier,
    bar: String? = null,
    tags: List<String> = emptyList(),
    analytics: Boolean = true,
    reach: Boolean = true,
    storage: KeyValueStorage? = null,
    theme: StoriesTheme = StoriesTheme(),
    transition: StoriesTransition = StoriesTransition.SLIDE,
    controller: StoriesBarController? = null,
    textColor: Color = if (isSystemInDarkTheme()) Color.White else Color.Black,
    onLoad: ((List<FeedGroup>) -> Unit)? = null,
    onFail: ((StoriesException) -> Unit)? = null,
    onStoryOpen: ((StoryOpenEvent) -> Unit)? = null,
    onClose: ((CloseReason) -> Unit)? = null,
    onCtaClick: ((CtaClickEvent) -> CtaResult)? = null,
    onShare: ((ShareEvent) -> ShareResult)? = null,
) {
    val context = LocalContext.current
    val config = BarConfig(token, apiUrl, bar?.trim()?.lowercase().orEmpty(), normalizeTags(tags), analytics)
    val client = remember(token, apiUrl, analytics) {
        StoriesClient.start(context, token, apiUrl, analytics, reach, storage)
    }
    LaunchedEffect(client, reach) { client.setReach(reach) }
    val state = remember(client, config) { BarState(client, config) }
    // Callbacks can capture new values on each recomposition.
    val callbacks by rememberUpdatedState(BarCallbacks(onLoad, onFail, onClose, ViewerCallbacks(onStoryOpen, onCtaClick, onShare)))
    state.callbacks = callbacks
    controller?.state = state
    DisposableEffect(state) {
        state.start()
        onDispose { state.dispose() }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, state) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) state.appActive = true
            if (event == Lifecycle.Event.ON_PAUSE) state.appActive = false
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    state.transition = transition
    state.viewer?.let { viewer -> StoriesViewer(viewer, state::origin, state::viewerFinished) }

    val feed = state.feed
    val seen = state.seen
    if (state.failed || feed == null || seen == null || feed.groups.isEmpty()) {
        // Nothing to show, and no space taken.
        Box(modifier)
        return
    }
    val layout = feed.layout
    val width = layout?.width?.dp ?: theme.circleSize
    val height = layout?.height?.dp ?: theme.circleSize
    val radius = layout?.cornerRadius?.dp ?: (theme.circleSize / 2)
    val gap = layout?.gap?.dp ?: theme.gap
    state.cornerPx = with(LocalDensity.current) { radius.toPx() }
    // Read, so rings redraw when the viewer closes.
    state.seenVersion
    Row(
        modifier
            .alpha(if (state.visible) 1f else 0f)
            .onGloballyPositioned { state.updateViewport(it.boundsInWindow()) }
            .semantics { contentDescription = StoriesLabels.BAR }
            .horizontalScroll(rememberScrollState())
            .padding(start = theme.barPadding, end = theme.barPadding, top = 4.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(gap),
        verticalAlignment = Alignment.Top,
    ) {
        feed.groups.forEachIndexed { index, group ->
            StoryCircle(
                group = group,
                width = width,
                height = height,
                radius = radius,
                seen = seen.isGroupSeen(group.storyIds),
                theme = theme,
                textColor = textColor,
                opening = state.openingIndex == index,
                onTap = { state.open(index) },
                modifier = Modifier.onGloballyPositioned { state.updateFrame(group.id, it.boundsInWindow()) },
                onCircleBounds = { state.updateCircle(group.id, it) },
            )
        }
    }
}
