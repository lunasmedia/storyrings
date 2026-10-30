package com.stories.core

// Conformance: every case in /spec/cases must give its `expect` result with the Kotlin code,
// exactly as it does for the other SDKs (see spec/README.md).

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

private val spec = File(System.getProperty("stories.spec") ?: "../../../spec")

private fun read(file: File): Any? = Json.parse(file.readText())

@Suppress("UNCHECKED_CAST")
private fun Any?.obj() = this as Map<String, Any?>

@Suppress("UNCHECKED_CAST")
private fun Any?.list() = this as List<Any?>

private fun Any?.int() = (this as Number).toInt()

/** JSON equality: numbers compare by value (1 == 1.0), objects ignore key order. */
private fun same(a: Any?, b: Any?): Boolean = when {
    a is Number && b is Number -> a.toDouble() == b.toDouble()
    a is Map<*, *> && b is Map<*, *> -> a.keys == b.keys && a.keys.all { same(a[it], b[it]) }
    a is List<*> && b is List<*> -> a.size == b.size && a.indices.all { same(a[it], b[it]) }
    else -> a == b
}

class ConformanceTest {
    @Test
    fun constantsMatchSpec() {
        val c = read(File(spec, "constants.json")).obj()
        assertEquals(mapOf("image" to 1000L, "video" to 2000L), mapOf("image" to Viewable.IMAGE_MS.toLong(), "video" to Viewable.VIDEO_MS.toLong()).also {
            assertTrue(same(c["viewableMs"], it))
        })
        assertTrue(same(c["tapMaxMs"], Gestures.TAP_MAX_MS))
        assertTrue(same(c["sessionTimeoutMs"], Sessions.TIMEOUT_MS))
        assertTrue(same(c["viewerIdMaxAgeMs"], Sessions.VIEWER_ID_MAX_AGE_MS))
        assertTrue(same(c["seenMaxIds"], SeenStore.MAX_IDS))
        assertTrue(same(c["analytics"], mapOf(
            "flushIntervalMs" to AnalyticsQueue.FLUSH_INTERVAL_MS,
            "maxBatch" to AnalyticsQueue.MAX_BATCH,
            "maxQueue" to AnalyticsQueue.MAX_QUEUE,
        )))
        val tags = c["tags"].obj()
        assertEquals(tags["pattern"], Tags.PATTERN)
        assertTrue(same(tags["maxPerPerson"], Tags.MAX_PER_PERSON))
        val labels = c["labels"].obj()
        assertEquals(labels["openGroup"], listOf(StoriesLabels.openGroup("Sale", 1, false), StoriesLabels.openGroup("Sale", 3, true)))
        assertEquals(labels["storyPosition"], StoriesLabels.storyPosition("Sale", 0, 3))
        assertEquals(labels["viewer"], StoriesLabels.viewer("Sale"))
        mapOf(
            "close" to StoriesLabels.CLOSE, "pause" to StoriesLabels.PAUSE, "play" to StoriesLabels.PLAY,
            "mute" to StoriesLabels.MUTE, "unmute" to StoriesLabels.UNMUTE, "previous" to StoriesLabels.PREVIOUS,
            "next" to StoriesLabels.NEXT, "share" to StoriesLabels.SHARE, "linkCopied" to StoriesLabels.LINK_COPIED,
            "shareFailed" to StoriesLabels.SHARE_FAILED, "bar" to StoriesLabels.BAR, "loading" to StoriesLabels.LOADING,
        ).forEach { (key, value) -> assertEquals("label $key", labels[key], value) }
        assertEquals(labels["countdownUnits"], InteractionLabels.COUNTDOWN_UNITS)
        assertEquals(labels["countdownEnded"], InteractionLabels.COUNTDOWN_ENDED)
        assertEquals(labels["pollOption"], InteractionLabels.pollOption("Red", 40))
        assertEquals(labels["slider"], InteractionLabels.slider("How hot?"))
        assertEquals(labels["sliderAverage"], InteractionLabels.SLIDER_AVERAGE)
        assertTrue(same(c["answersMaxIds"], AnswerStore.MAX_IDS))
        assertEquals(c["storage"].obj()["answers"], "stories:answers:<appId>")
        assertTrue(same(c["interactions"], mapOf(
            "unitsPerWidth" to Interactions.UNITS_PER_WIDTH, "defaultAccent" to Interactions.DEFAULT_ACCENT,
            "defaultEmoji" to Interactions.DEFAULT_EMOJI, "correctColor" to Interactions.CORRECT_COLOR,
            "wrongColor" to Interactions.WRONG_COLOR,
        )))
    }

    @Test
    fun everySuiteHasAnAdapter() {
        val files = File(spec, "cases").listFiles { f -> f.extension == "json" }.orEmpty()
        assertTrue(files.isNotEmpty())
        for (f in files) assertNotNull("no Kotlin adapter for ${f.name}", suites[read(f).obj()["suite"]])
    }

    @Test fun viewer() = run("viewer")
    @Test fun feed() = run("feed")
    @Test fun tags() = run("tags")
    @Test fun links() = run("links")
    @Test fun gestures() = run("gestures")
    @Test fun seen() = run("seen")
    @Test fun analytics() = run("analytics")
    @Test fun sessions() = run("sessions")
    @Test fun interactions() = run("interactions")
    @Test fun display() = run("display")

    private fun run(suite: String) {
        val data = read(File(spec, "cases/$suite.json")).obj()
        val adapter = suites.getValue(suite)
        val failures = mutableListOf<String>()
        val cases = data["cases"].list()
        assertTrue(cases.isNotEmpty())
        for (raw in cases) {
            val c = raw.obj()
            // Round trip, so results compare like the decoded expectations.
            val actual = Json.parse(Json.stringify(adapter(c["input"].obj())))
            if (!same(actual, c["expect"])) {
                failures += "${c["name"]}\nExpected: ${Json.stringify(c["expect"])}\nActual:   ${Json.stringify(actual)}"
            }
        }
        if (failures.isNotEmpty()) fail("$suite: ${failures.size} failing\n\n" + failures.joinToString("\n\n"))
    }
}

private val suites: Map<String, (Map<String, Any?>) -> Any?> = mapOf(
    "viewer" to ::viewer, "feed" to ::feed, "tags" to ::tags, "links" to ::links,
    "gestures" to ::gestures, "seen" to ::seen, "analytics" to ::analytics, "sessions" to ::sessions,
    "interactions" to ::interactions,
    "display" to { input -> StoryLook.fromJson(input["story"].obj()).json },
)

// --- interactions

private fun Any?.num() = (this as Number).toDouble()

private fun interactions(input: Map<String, Any?>): Any? {
    fun r3(v: Double) = Math.round(v * 1000) / 1000.0
    return when (input["op"]) {
        "parse" -> mapOf("interactions" to parseInteractions(input["interactions"]).map { it.json })
        "place" -> {
            val c = input["container"].list()
            val m = input["media"] as? List<*>
            val p = placeInteraction(
                c[0].num(), c[1].num(), m?.get(0)?.num(), m?.get(1)?.num(), input["fit"] == "cover",
                input["x"].num(), input["y"].num(), input["width"].num(),
            )
            mapOf("x" to r3(p.x), "y" to r3(p.y), "width" to r3(p.width), "scale" to r3(p.scale))
        }
        "percentages" -> mapOf("percents" to percentages(input["counts"].list().map { it.int() }))
        "countdown" -> {
            val c = countdownParts(parseIsoDate(input["endsAt"] as String)!!, parseIsoDate(input["now"] as String)!!)
            mapOf("ended" to c.ended, "days" to c.days, "hours" to c.hours, "minutes" to c.minutes, "seconds" to c.seconds)
        }
        else -> error("unknown op")
    }
}

// --- viewer

private fun action(a: Map<String, Any?>): ViewerAction = when (a["type"]) {
    "NEXT" -> ViewerAction.Next(auto = a["auto"] == true)
    "PREV" -> ViewerAction.Prev
    "NEXT_GROUP" -> ViewerAction.NextGroup
    "PREV_GROUP" -> ViewerAction.PrevGroup
    "TICK" -> ViewerAction.Tick(a["ms"].int())
    "PAUSE" -> ViewerAction.Pause
    "RESUME" -> ViewerAction.Resume
    "MEDIA_LOADING" -> ViewerAction.MediaLoading
    "HIDE" -> ViewerAction.Hide
    "SHOW" -> ViewerAction.Show
    "MEDIA_READY" -> ViewerAction.MediaReady((a["durationMs"] as? Number)?.toDouble(), a["failed"] == true)
    "CLOSE" -> ViewerAction.Close
    else -> error("Unknown action $a")
}

private fun viewer(input: Map<String, Any?>): Any {
    val groups = input["groups"].list().map { g ->
        val gm = g.obj()
        ViewerGroup(gm["id"] as String, gm["stories"].list().map { s ->
            val sm = s.obj()
            ViewerStory(sm["id"] as String, sm["durationMs"].int(), sm["type"] as? String ?: "image")
        })
    }
    val starts = input["startStoryIndex"] as? Map<*, *> ?: emptyMap<String, Any?>()
    val start: StartStoryIndex = { (starts["$it"] as? Number)?.toInt() ?: 0 }
    fun snap(s: ViewerState): Map<String, Any?> = LinkedHashMap(s.toJson()).apply {
        put("at", if (s.open) groups[s.groupIndex].stories[s.storyIndex].id else "closed")
    }
    val opened = openViewer(groups, input["open"].int(), start)
    var state = opened
    val steps = input["steps"].list().map { raw ->
        val a = action(raw.obj())
        val next = reduce(state, a, groups, start)
        val events = actionEvents(state, a, groups) + transitionEvents(state, next, groups)
        state = next
        mapOf("action" to raw, "state" to snap(next), "events" to events.map { it.toJson() }, "progress" to progressSegments(next, groups))
    }
    return mapOf(
        "opened" to snap(opened),
        "events" to transitionEvents(ViewerState.CLOSED, opened, groups).map { it.toJson() },
        "steps" to steps,
    )
}

// --- feed / tags / links

private fun feed(input: Map<String, Any?>): Any = try {
    mapOf("feed" to normalizeFeedJson(input["body"]))
} catch (e: StoriesException) {
    mapOf("error" to e.code)
}

private fun tags(input: Map<String, Any?>): Any {
    if (input["op"] == "normalize") return mapOf("tags" to normalizeTags(input["tags"]))
    val conditions = input["conditions"].list().map { c ->
        val m = c.obj()
        TagCondition(m["mode"] as String, m["tags"].list().map { it as String })
    }
    return mapOf("matches" to matchesTagFilter(conditions, input["tags"].list().map { it as String }.toSet()))
}

private fun links(input: Map<String, Any?>): Any {
    val target = input["target"] as? Map<*, *>
    return when (input["op"]) {
        "shareUrl" -> mapOf("url" to shareUrl(input["pageUrl"] as String, target!!["groupId"] as String, target["storyId"] as? String))
        "parseShareLink" -> mapOf("target" to parseShareLink(input["url"] as String)?.let { t ->
            linkedMapOf<String, Any?>("groupId" to t.groupId).apply { t.storyId?.let { put("storyId", it) } }
        })
        "withoutShareLink" -> mapOf("url" to withoutShareLink(input["url"] as String))
        "appShareUrl" -> mapOf("url" to appShareUrl(input["template"] as String, target!!["groupId"] as String, target["storyId"] as String))
        "ctaAllowed" -> mapOf("allowed" to isAllowedCtaUrl(input["url"] as String, (input["schemes"] as? List<*>).orEmpty().map { it as String }))
        "ctaStyle" -> CtaStyle.fromJson(input["style"]).let { mapOf("style" to it.json, "swipe" to it.isSwipe) }
        else -> error("Unknown links op $input")
    }
}

// --- gestures / seen

private fun gestures(input: Map<String, Any?>): Any {
    val calls = mutableListOf<Any?>()
    val r = GestureRecognizer(GestureHandlers(
        onTap = { calls.add(listOf("tap", Math.round(it * 1000) / 1000.0)) },
        onPress = { calls.add(listOf("press")) },
        onRelease = { calls.add(listOf("release")) },
        onSwipe = { calls.add(listOf("swipe", it.json)) },
        onDrag = { dx, dy -> calls.add(listOf("drag", dx, dy)) },
    ))
    val width = (input["width"] as Number).toDouble()
    for (e in input["events"].list()) {
        val a = e.list()
        fun n(i: Int) = (a[i] as Number).toDouble()
        when (a[0]) {
            "down" -> r.down(n(1), n(2), (a[3] as Number).toLong())
            "move" -> r.move(n(1), n(2))
            "up" -> r.up(n(1), n(2), (a[3] as Number).toLong(), width)
            else -> r.cancel()
        }
    }
    return mapOf("calls" to calls)
}

private fun seen(input: Map<String, Any?>): Any {
    val store = SeenStore(null, "app")
    val results = input["ops"].list().map { raw ->
        val op = raw.list()
        when (op[0]) {
            "markSeen" -> null.also { store.markSeen(op[1] as String) }
            "markMany" -> null.also { repeat(op[2].int()) { i -> store.markSeen("${op[1]}$i") } }
            "has" -> store.has(op[1] as String)
            "isGroupSeen" -> store.isGroupSeen(op[1].list().map { it as String })
            "firstUnseenIndex" -> store.firstUnseenIndex(op[1].list().map { it as String })
            else -> error("Unknown seen op $op")
        }
    }
    return mapOf("results" to results)
}

// --- analytics / sessions

private fun analytics(input: Map<String, Any?>): Any {
    val options = input["options"].obj()
    var now = 0L
    var failNext = 0
    val sent = mutableListOf<Map<String, Any?>>()
    val viewerId = options["viewer"] as? String
    val queue = AnalyticsQueue(
        url = "https://api.example.com/v1/events?token=pk_live_x",
        sdk = options["sdk"] as String,
        transport = { _, body, beacon, done ->
            sent += mapOf("body" to Json.parse(body), "beacon" to beacon)
            if (failNext > 0) {
                failNext--
                done(false)
            } else {
                done(true)
            }
        },
        scheduler = { _, _ -> {} },
        maxBatch = (options["maxBatch"] as? Number)?.toInt() ?: 50,
        maxQueue = (options["maxQueue"] as? Number)?.toInt() ?: 500,
        now = { now },
        sessionId = options["sessionId"] as String,
        viewer = viewerId?.let { id -> { id } },
        platform = options["platform"] as? String,
        automation = options["automation"] == true,
    )
    val steps = input["steps"].list().map { raw ->
        val step = raw.obj()
        val before = sent.size
        val track = step["track"]
        val flush = step["flush"]
        if (track != null) {
            (step["at"] as? Number)?.let { now = it.toLong() }
            queue.track(track.obj())
        } else if (flush != null) {
            val f = flush.obj()
            failNext = (f["fail"] as? Number)?.toInt() ?: 0
            queue.flush(beacon = f["beacon"] == true)
        }
        mapOf("sent" to sent.subList(before, sent.size).toList(), "pending" to queue.pending)
    }
    queue.cancelTimer()
    return mapOf("steps" to steps)
}

private fun sessions(input: Map<String, Any?>): Any {
    if (input["op"] == "newSession") {
        return mapOf("newSession" to Sessions.startsNew((input["leftAt"] as? Number)?.toLong(), (input["now"] as Number).toLong()))
    }
    val storage = MemoryStorage()
    val stored = input["stored"]
    if (input.containsKey("stored")) storage.setItem("stories:viewer", stored as? String ?: Json.stringify(stored))
    val id = Sessions.loadViewerId(storage, (input["now"] as Number).toLong())
    val keptId = (stored as? Map<*, *>)?.get("id")
    return mapOf("kept" to (id != null && id == keptId), "stored" to (storage.getItem("stories:viewer") != null))
}
