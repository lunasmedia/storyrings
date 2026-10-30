package com.stories.sdk

import android.content.Context
import android.util.AttributeSet
import android.widget.FrameLayout
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import com.stories.core.CloseReason
import com.stories.core.FeedGroup
import com.stories.core.StoriesException

/**
 * The story bar for View-based screens. Add it like any view with `wrap_content` height; it
 * takes no space while there are no live stories. Needs an AndroidX activity (ComponentActivity
 * or AppCompatActivity).
 *
 * ```kotlin
 * val stories = StoriesBarView(context).apply {
 *     token = "pk_live_…"
 *     apiUrl = "https://stories.example.com"
 *     onCtaClick = { event -> router.open(event.url); CtaResult.HANDLED }
 * }
 * layout.addView(stories)
 * ```
 *
 * In XML: `<com.stories.sdk.StoriesBarView android:layout_width="match_parent"
 * android:layout_height="wrap_content" />`, then set `token` and `apiUrl` in code.
 */
class StoriesBarView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {
    val controller = StoriesBarController()

    var token by mutableStateOf("")
    var apiUrl by mutableStateOf("")
    /** Which story bar to show, by its key; null = the main bar. */
    var bar by mutableStateOf<String?>(null)
    /** The person's tags; changing them reloads the feed. */
    var tags by mutableStateOf(emptyList<String>())
    /** Unique-viewer counting; turning it off deletes the anonymous ID. */
    var reach by mutableStateOf(true)
    var analytics by mutableStateOf(true)
    var theme by mutableStateOf(StoriesTheme())
    /** How the viewer opens and closes: [StoriesTransition.SLIDE] (default) or [StoriesTransition.ZOOM]. */
    var transition by mutableStateOf(StoriesTransition.SLIDE)

    var onLoad by mutableStateOf<((List<FeedGroup>) -> Unit)?>(null)
    var onFail by mutableStateOf<((StoriesException) -> Unit)?>(null)
    var onStoryOpen by mutableStateOf<((StoryOpenEvent) -> Unit)?>(null)
    var onClose by mutableStateOf<((CloseReason) -> Unit)?>(null)
    var onCtaClick by mutableStateOf<((CtaClickEvent) -> CtaResult)?>(null)
    var onShare by mutableStateOf<((ShareEvent) -> ShareResult)?>(null)

    init {
        addView(ComposeView(context).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                if (token.isNotEmpty() && apiUrl.isNotEmpty()) {
                    StoriesBar(
                        token = token, apiUrl = apiUrl, bar = bar, tags = tags, analytics = analytics, reach = reach,
                        theme = theme, transition = transition, controller = controller, onLoad = onLoad, onFail = onFail,
                        onStoryOpen = onStoryOpen, onClose = onClose, onCtaClick = onCtaClick, onShare = onShare,
                    )
                }
            }
        })
    }

    /** Opens the viewer at a group, by id (e.g. from a push notification). */
    fun open(groupId: String): Boolean = controller.open(groupId)

    /** Refetches the feed. */
    fun refresh() = controller.refresh()
}
