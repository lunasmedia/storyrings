package com.stories.sdk

import android.content.Context
import com.stories.core.AnalyticsQueue
import com.stories.core.AnswerResults
import com.stories.core.AnswerStore
import com.stories.core.Feed
import com.stories.core.Json
import com.stories.core.KeyValueStorage
import com.stories.core.Scheduler
import com.stories.core.SeenStore
import com.stories.core.Sessions
import com.stories.core.StoriesException
import com.stories.core.StoryEvent
import com.stories.core.answerBody
import com.stories.core.answersUrl
import com.stories.core.normalizeFeedJson
import java.net.URLEncoder

/** The SDK version, sent with analytics as `android@<version>`. */
const val STORIES_SDK_VERSION = "0.1.0"

/** One HTTP request; `done(status, body)` with status 0 for a network failure. */
fun interface HttpClient {
    fun request(method: String, url: String, body: String?, done: (status: Int, body: String?) -> Unit)
}

/**
 * Loads feeds and holds per-app state (seen stories, analytics) shared by every story bar, like
 * the other SDKs' clients. Use it from the main thread.
 */
class StoriesClient internal constructor(
    val token: String,
    apiUrl: String,
    val analytics: Boolean,
    reach: Boolean,
    val storage: KeyValueStorage,
    private val http: HttpClient,
    /** Runs a callback on the main thread. */
    private val main: (Runnable) -> Unit,
    scheduler: Scheduler,
    private val now: () -> Long = System::currentTimeMillis,
) {
    val apiUrl: String = apiUrl.trimEnd('/')
    private var queue: AnalyticsQueue? = null
    private var viewerId: String? = null
    private var reachOn = false
    private var leftAt: Long? = null
    private val waiting = HashMap<String, MutableList<(Result<Feed>) -> Unit>>()
    /** The last feed per story bar this launch, so bars that reappear don't refetch. */
    private val latest = HashMap<String, Feed>()
    private val seen = HashMap<String, SeenStore>()
    private val answers = HashMap<String, AnswerStore>()

    init {
        if (analytics) {
            queue = AnalyticsQueue(
                url = "${this.apiUrl}/v1/events?token=${URLEncoder.encode(token, "UTF-8")}",
                sdk = "android@$STORIES_SDK_VERSION",
                transport = { url, body, _, done ->
                    // 4xx means the batch itself is bad: retrying won't help, so it counts as handled.
                    http.request("POST", url, body) { status, _ -> main(Runnable { done(status in 1..499) }) }
                },
                scheduler = scheduler,
                viewer = { viewerId },
                platform = "android",
            )
            if (reach) setReach(true)
            // A session starts now, and again after 30+ minutes away (the Firebase rule).
            queue?.track(mapOf("type" to "app_open"))
        }
    }

    /** The app went to the background: send what's queued before it may be stopped. */
    internal fun onBackground() {
        if (leftAt == null) leftAt = now()
        queue?.flush(beacon = true)
    }

    internal fun onForeground() {
        if (Sessions.startsNew(leftAt, now())) queue?.track(mapOf("type" to "app_open"))
        leftAt = null
    }

    /**
     * Turns unique-viewer counting on or off (e.g. when someone gives or withdraws consent).
     * Turning it off also deletes the stored anonymous ID.
     */
    fun setReach(enabled: Boolean) {
        reachOn = enabled && queue != null
        if (!reachOn) {
            viewerId = null
            if (!enabled) Sessions.clearViewerId(storage)
            return
        }
        viewerId = Sessions.loadViewerId(storage)
    }

    internal fun track(event: StoryEvent) {
        queue?.track(event.toJson())
    }

    private fun feedKey(bar: String, tags: List<String>) =
        "stories:feed:$token${if (bar.isEmpty()) "" else ":$bar"}${if (tags.isEmpty()) "" else "#${tags.joinToString(",")}"}"

    /**
     * Fetches a story bar's feed once per launch (again with [force]), sharing one request
     * between bars that ask at the same time. [bar]: its key ("" = the main bar); [tags] normalised.
     */
    internal fun loadFeed(bar: String, tags: List<String>, force: Boolean = false, done: (Result<Feed>) -> Unit) {
        val key = feedKey(bar, tags)
        if (!force) latest[key]?.let { return done(Result.success(it)) }
        waiting[key]?.let { it += done; return }
        waiting[key] = mutableListOf(done)
        fetch(bar, tags) { result ->
            val typed = result.map { normalized ->
                // Remembered so the next launch can show the bar before the network answers.
                runCatching { storage.setItem(key, Json.stringify(normalized)) }
                Feed.fromNormalized(normalized).also { latest[key] = it }
            }
            waiting.remove(key)?.forEach { it(typed) }
        }
    }

    /** A story bar's feed from the previous launch, if any. */
    internal fun cachedFeed(bar: String, tags: List<String>): Feed? = runCatching {
        storage.getItem(feedKey(bar, tags))?.takeIf { it.isNotEmpty() }?.let { raw ->
            @Suppress("UNCHECKED_CAST")
            Feed.fromNormalized(Json.parse(raw) as Map<String, Any?>)
        }
    }.getOrNull()

    private fun fetch(bar: String, tags: List<String>, done: (Result<Map<String, Any?>>) -> Unit) {
        val query = buildString {
            append("token=").append(URLEncoder.encode(token, "UTF-8"))
            if (bar.isNotEmpty()) append("&bar=").append(URLEncoder.encode(bar, "UTF-8"))
            if (tags.isNotEmpty()) append("&tags=").append(URLEncoder.encode(tags.joinToString(","), "UTF-8"))
        }
        http.request("GET", "$apiUrl/v1/feed?$query", null) { status, body ->
            val result: Result<Map<String, Any?>> = when {
                status == 0 -> Result.failure(StoriesException("network", "Could not reach the Stories API"))
                status == 401 -> Result.failure(StoriesException("invalid_token", "Invalid Stories token", 401))
                status == 404 && bar.isNotEmpty() -> Result.failure(StoriesException(
                    "unknown_bar",
                    "No story bar with the key \"$bar\" for this token. Check the key under Settings → Apps & websites in the dashboard.",
                    404,
                ))
                status >= 400 -> Result.failure(StoriesException("server", "Stories API error ($status)", status))
                else -> try {
                    Result.success(normalizeFeedJson(Json.parse(body ?: "")))
                } catch (e: StoriesException) {
                    Result.failure(e)
                } catch (_: Exception) {
                    Result.failure(StoriesException("invalid_response", "Stories API returned invalid JSON", status))
                }
            }
            main(Runnable { done(result) })
        }
    }

    internal fun seenStore(appId: String): SeenStore = seen.getOrPut(appId) { SeenStore(storage, appId) }

    /** Answers to polls, quizzes and sliders kept on this device. */
    internal fun answerStore(appId: String): AnswerStore = answers.getOrPut(appId) { AnswerStore(storage, appId) }

    /** Sends an answer to a poll, quiz or slider; `done` gets the results on the main thread, or null. */
    internal fun sendAnswer(storyId: String, interactionId: String, value: Int, done: (AnswerResults?) -> Unit) {
        http.request("POST", answersUrl(apiUrl, token), answerBody(storyId, interactionId, value, viewerId)) { status, body ->
            val results = if (status == 200) runCatching { AnswerResults.fromJson((Json.parse(body ?: "") as? Map<*, *>)?.get("results")) }.getOrNull() else null
            main(Runnable { done(results) })
        }
    }

    /** Stops analytics (tests, or a sign-out that should stop counting). */
    fun dispose() {
        queue?.dispose()
        queue = null
        synchronized(clients) { clients.values.removeAll { it === this } }
    }

    companion object {
        private val clients = HashMap<String, StoriesClient>()

        /**
         * One client per token / API URL / analytics setting, shared by every bar. Call it in
         * `Application.onCreate` (or your launcher activity) so sessions (active users) are
         * counted before a bar is on screen.
         */
        @JvmStatic
        @JvmOverloads
        fun start(
            context: Context,
            token: String,
            apiUrl: String,
            analytics: Boolean = true,
            reach: Boolean = true,
            storage: KeyValueStorage? = null,
        ): StoriesClient {
            require(token.isNotEmpty()) { "Stories: a public token is required" }
            val key = "$token|$apiUrl|$analytics"
            synchronized(clients) {
                clients[key]?.let { return it }
                val app = context.applicationContext
                val client = StoriesClient(
                    token = token, apiUrl = apiUrl, analytics = analytics, reach = reach,
                    storage = storage ?: SharedPreferencesStorage(app),
                    http = UrlConnectionHttp, main = MainThread::post, scheduler = MainThread,
                )
                AppLifecycle.observe(client)
                clients[key] = client
                return client
            }
        }

        /** For tests: a client with fake platform pieces. */
        internal fun create(
            token: String, apiUrl: String, storage: KeyValueStorage, http: HttpClient,
            analytics: Boolean = true, reach: Boolean = true, now: () -> Long = System::currentTimeMillis,
        ) = StoriesClient(token, apiUrl, analytics, reach, storage, http, { it.run() }, { _, _ -> {} }, now)
    }
}
