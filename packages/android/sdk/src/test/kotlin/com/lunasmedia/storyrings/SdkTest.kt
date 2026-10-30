package com.lunasmedia.storyrings

import com.lunasmedia.storyrings.core.CloseReason
import com.lunasmedia.storyrings.core.Feed
import com.lunasmedia.storyrings.core.Json
import com.lunasmedia.storyrings.core.MemoryStorage
import com.lunasmedia.storyrings.core.SeenStore
import com.lunasmedia.storyrings.core.StoryEvent
import com.lunasmedia.storyrings.core.normalizeTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun story(id: String, title: String? = null, cta: Map<String, String>? = null) = buildMap<String, Any?> {
    put("id", id); put("type", "image"); put("url", "https://cdn.example.com/$id.jpg"); put("durationMs", 5000); put("alt", "Slide $id")
    title?.let { put("title", it) }
    cta?.let { put("cta", it) }
}

private fun feedBody(sharing: Boolean = false, shareLink: String? = null) = mapOf(
    "app" to buildMap { put("id", "app-1"); put("deepLinkSchemes", listOf("myshop")); put("sharing", sharing); shareLink?.let { put("shareLink", it) } },
    "bar" to mapOf("id" to "bar-1", "key" to "main"),
    "groups" to listOf(
        mapOf("id" to "g1", "title" to "Sale", "coverUrl" to "https://cdn.example.com/c1.png", "stories" to listOf(
            story("s1", "First"),
            story("s2", "Second", mapOf("label" to "Shop now", "url" to "https://shop.example.com/sale")),
        )),
        mapOf("id" to "g2", "title" to "New in", "coverUrl" to "https://cdn.example.com/c2.png", "stories" to listOf(story("s3", "Third"))),
    ),
)

/** A fake Stories API: serves the feed and records analytics batches. */
private class FakeApi(var feedStatus: Int = 200, var feed: Any? = feedBody()) : HttpClient {
    val feedUrls = mutableListOf<String>()
    val batches = mutableListOf<Map<String, Any?>>()

    @Suppress("UNCHECKED_CAST")
    override fun request(method: String, url: String, body: String?, done: (Int, String?) -> Unit) {
        if (url.contains("/v1/feed")) {
            feedUrls += url
            done(feedStatus, Json.stringify(if (feedStatus == 200) feed else mapOf("error" to mapOf("code" to "unauthorized"))))
        } else {
            batches += Json.parse(body!!) as Map<String, Any?>
            done(204, null)
        }
    }
}

private var tokens = 0

class ClientTest {
    private fun client(api: FakeApi) =
        StoriesClient.create("pk_live_test${tokens++}", "https://api.example.com/", MemoryStorage(), api)

    private fun load(c: StoriesClient, bar: String = "", tags: List<String> = emptyList()): Result<Feed> {
        var result: Result<Feed>? = null
        c.loadFeed(bar, tags) { result = it }
        return result!!
    }

    @Test
    fun sendsTheBarKeyAndTagsAndRemembersTheFeed() {
        val api = FakeApi()
        val c = client(api)
        val feed = load(c, "product-page", normalizeTags(listOf("Premium", " london "))).getOrThrow()
        assertEquals(listOf("g1", "g2"), feed.groups.map { it.id })
        val url = api.feedUrls.single()
        assertTrue(url, url.contains("bar=product-page"))
        assertTrue(url, url.contains("tags=london%2Cpremium"))
        assertEquals(2, c.cachedFeed("product-page", listOf("london", "premium"))?.groups?.size)
        // A second bar showing it doesn't refetch.
        load(c, "product-page", listOf("london", "premium"))
        assertEquals(1, api.feedUrls.size)
    }

    @Test
    fun reportsARejectedToken() {
        val result = load(client(FakeApi(feedStatus = 401)))
        assertEquals("invalid_token", (result.exceptionOrNull() as com.lunasmedia.storyrings.core.StoriesException).code)
    }

    @Test
    fun countsAnAppSessionAsAndroid() {
        val api = FakeApi()
        val c = client(api)
        c.dispose() // sends what's queued
        val batch = api.batches.single()
        assertEquals("android@$STORIES_SDK_VERSION", batch["sdk"])
        assertEquals("android", batch["platform"])
        assertNotNull(batch["viewer"])
        @Suppress("UNCHECKED_CAST")
        assertEquals("app_open", (batch["events"] as List<Map<String, Any?>>).first()["type"])
    }

    @Test
    fun startsANewSessionAfterThirtyMinutesAway() {
        val api = FakeApi()
        var now = 0L
        val c = StoriesClient.create("pk_live_test${tokens++}", "https://api.example.com", MemoryStorage(), api, now = { now })
        c.onBackground()
        now = 10 * 60_000
        c.onForeground()
        c.onBackground()
        now += 31 * 60_000
        c.onForeground()
        c.dispose()
        @Suppress("UNCHECKED_CAST")
        val opens = api.batches.flatMap { it["events"] as List<Map<String, Any?>> }.count { it["type"] == "app_open" }
        assertEquals(2, opens)
    }
}

class ViewerControllerTest {
    private val events = mutableListOf<StoryEvent>()
    private var finished: CloseReason? = null
    private var opened: String? = null
    private var sharedText: String? = null

    private fun viewer(body: Any? = feedBody(), group: Int = 0, callbacks: ViewerCallbacks = ViewerCallbacks(), seen: SeenStore = SeenStore(null, "app-1")): ViewerController {
        events.clear()
        finished = null
        return ViewerController(Feed.fromBody(body), group, seen, { events += it }, callbacks).apply {
            host = object : ViewerHost {
                override fun announce(text: String) = Unit
                override fun openUrl(url: String) { opened = url }
                override fun share(text: String, title: String, shared: () -> Unit) { sharedText = text; shared() }
                override fun finish(reason: CloseReason) { finished = reason }
            }
            start()
        }
    }

    private fun ViewerController.tap(x: Double) {
        gestures.down(x, 300.0, 0)
        gestures.up(x, 300.0, 100, 400.0)
    }

    private val types get() = events.map { it.type }

    @Test
    fun tapsMoveForwardAndBackAndAreReported() {
        val v = viewer()
        v.tap(300.0)
        assertEquals("s2", v.story.id)
        v.tap(40.0)
        assertEquals("s1", v.story.id)
        assertEquals(listOf("group_open", "tap_forward", "tap_back"), types)
        assertEquals("s1", events[1].storyId)
    }

    @Test
    fun swipesChangeGroupAndSwipeDownCloses() {
        val v = viewer()
        v.gestures.down(300.0, 300.0, 0)
        v.gestures.move(150.0, 305.0)
        v.gestures.up(100.0, 305.0, 200, 400.0)
        assertEquals("g2", v.group.id)
        v.gestures.down(200.0, 100.0, 1000)
        v.gestures.move(200.0, 200.0)
        v.gestures.up(200.0, 300.0, 1200, 400.0)
        assertEquals(CloseReason.USER, finished)
        assertEquals(listOf("group_open", "group_skip", "group_open", "exit"), types)
    }

    @Test
    fun holdingPausesAndReleasingResumes() {
        val v = viewer()
        v.gestures.down(200.0, 300.0, 0)
        assertTrue(v.state.paused)
        v.gestures.up(200.0, 300.0, 800, 400.0)
        assertFalse(v.state.paused)
        assertEquals("s1", v.story.id)
    }

    @Test
    fun framesRunTheTimerAndCountAView() {
        val v = viewer()
        v.mediaReady(v.state.seq)
        v.frame(0)
        for (t in 16L..1200L step 16) v.frame(t)
        assertTrue(types.contains("story_view"))
        for (t in 1216L..5100L step 16) v.frame(t)
        assertEquals("s2", v.story.id)
        assertFalse(types.contains("tap_forward")) // moved on by itself
    }

    @Test
    fun opensAllowedButtonLinksAndLetsTheAppHandleThem() {
        val v = viewer()
        v.tap(300.0)
        v.cta()
        assertEquals("https://shop.example.com/sale", opened)
        var handled: String? = null
        opened = null
        val w = viewer(callbacks = ViewerCallbacks(onCtaClick = { handled = it.url; it.close(); CtaResult.HANDLED }))
        w.tap(300.0)
        w.cta()
        assertEquals("https://shop.example.com/sale", handled)
        assertEquals(null, opened)
        assertEquals(CloseReason.USER, finished)
        assertTrue(types.contains("cta_click"))
    }

    @Test
    fun shareFillsInTheStoryLinkOnlyWhenSharingIsOn() {
        assertFalse(viewer().canShare)
        val v = viewer(feedBody(sharing = true, shareLink = "https://news.example.com/stories/{group}/{story}"), group = 1)
        assertTrue(v.canShare)
        v.share()
        assertEquals("Third\nhttps://news.example.com/stories/g2/s3", sharedText)
        assertEquals(StoryEvent("share", "g2", "s3"), events.last())
        assertTrue(v.state.paused) // until the share sheet closes
        v.shareDone()
        assertFalse(v.state.paused)
    }

    @Test
    fun startsAtTheFirstUnseenStory() {
        val seen = SeenStore(null, "app-1").apply { markSeen("s1") }
        assertEquals("s2", viewer(seen = seen).story.id)
    }
}
