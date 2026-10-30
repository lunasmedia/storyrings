package com.stories.core

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// Interactive stickers: polls, quizzes, emoji sliders, links and countdowns drawn over a story's
// image (spec/README.md, "Interactions"; spec/cases/interactions.json).

object Interactions {
    /** Sizes inside a sticker are in units of its displayed width / 600. */
    const val UNITS_PER_WIDTH = 600.0
    const val DEFAULT_ACCENT = "#c2255c"
    const val DEFAULT_EMOJI = "😍"
    const val CORRECT_COLOR = "#2f9e44"
    const val WRONG_COLOR = "#e03131"
    internal const val DESIGN_WIDTH = 1080.0
    internal const val DESIGN_HEIGHT = 1920.0
}

/** A sticker, placed by its centre ([x], [y]) and [width] in the image's 1080 × 1920 design space. */
data class Interaction(
    val id: String,
    val x: Double,
    val y: Double,
    val width: Double,
    /** "#rrggbb". */
    val accent: String,
    val kind: Kind,
) {
    sealed interface Kind {
        data class Poll(val question: String, val options: List<String>) : Kind
        data class Quiz(val question: String, val options: List<String>, val correct: Int) : Kind
        data class Slider(val question: String, val emoji: String) : Kind
        data class Link(val label: String, val url: String) : Kind
        /** [endsAt] as sent; [endsAtMs] parsed. */
        data class Countdown(val title: String, val endsAt: String, val endsAtMs: Long) : Kind
    }

    /** Polls, quizzes and sliders take answers. */
    val answerable: Boolean get() = kind is Kind.Poll || kind is Kind.Quiz || kind is Kind.Slider

    val json: Map<String, Any?>
        get() = linkedMapOf<String, Any?>("id" to id, "x" to x, "y" to y, "width" to width, "accent" to accent) +
            when (kind) {
                is Kind.Poll -> mapOf("kind" to "poll", "question" to kind.question, "options" to kind.options)
                is Kind.Quiz -> mapOf("kind" to "quiz", "question" to kind.question, "options" to kind.options, "correct" to kind.correct)
                is Kind.Slider -> mapOf("kind" to "slider", "question" to kind.question, "emoji" to kind.emoji)
                is Kind.Link -> mapOf("kind" to "link", "label" to kind.label, "url" to kind.url)
                is Kind.Countdown -> mapOf("kind" to "countdown", "title" to kind.title, "endsAt" to kind.endsAt)
            }
}

private val HEX = Regex("^#[0-9a-fA-F]{6}$")

/** A story's `interactions` from the feed; malformed stickers are dropped. */
fun parseInteractions(raw: Any?): List<Interaction> = raw.asArray().orEmpty().mapNotNull { any ->
    val r = any.asObject() ?: return@mapNotNull null
    val id = r["id"] as? String ?: return@mapNotNull null
    val x = r["x"].asNumber() ?: return@mapNotNull null
    val y = r["y"].asNumber() ?: return@mapNotNull null
    val width = r["width"].asNumber()?.takeIf { it > 0 } ?: return@mapNotNull null
    val accent = (r["accent"] as? String)?.takeIf { HEX.matches(it) } ?: Interactions.DEFAULT_ACCENT
    fun text(key: String) = r[key] as? String ?: ""
    val options = r["options"].asArray().orEmpty().filterIsInstance<String>().take(4)
    val kind: Interaction.Kind? = when (r["kind"]) {
        "poll" -> if (options.size >= 2) Interaction.Kind.Poll(text("question"), options) else null
        "quiz" -> {
            val c = r["correct"].asNumber()
            if (options.size >= 2 && c != null && c == floor(c) && c >= 0 && c < options.size) {
                Interaction.Kind.Quiz(text("question"), options, c.toInt())
            } else null
        }
        "slider" -> Interaction.Kind.Slider(text("question"), text("emoji").ifEmpty { Interactions.DEFAULT_EMOJI })
        "link" -> {
            val label = r["label"] as? String
            val url = r["url"] as? String
            if (!label.isNullOrEmpty() && url != null) Interaction.Kind.Link(label, url) else null
        }
        "countdown" -> (r["endsAt"] as? String)?.let { s -> parseIsoDate(s)?.let { Interaction.Kind.Countdown(text("title"), s, it) } }
        else -> null
    }
    kind?.let { Interaction(id, x, y, width, accent, it) }
}

data class Placement(
    /** Centre, in the viewer's coordinates. */
    val x: Double,
    val y: Double,
    /** Displayed width. */
    val width: Double,
    /** Displayed pixels per design pixel. */
    val scale: Double,
)

/**
 * Where a sticker goes on the story image as displayed: the image (its size, or 1080 × 1920 when
 * unknown) is fitted into the container (`cover` or `contain`), and the design space mapped onto it.
 */
fun placeInteraction(
    containerWidth: Double,
    containerHeight: Double,
    mediaWidth: Double?,
    mediaHeight: Double?,
    cover: Boolean,
    x: Double,
    y: Double,
    width: Double,
): Placement {
    val mw = mediaWidth?.takeIf { it > 0 } ?: Interactions.DESIGN_WIDTH
    val mh = mediaHeight?.takeIf { it > 0 } ?: Interactions.DESIGN_HEIGHT
    val s = if (cover) max(containerWidth / mw, containerHeight / mh) else min(containerWidth / mw, containerHeight / mh)
    val w = mw * s
    val h = mh * s
    val left = (containerWidth - w) / 2
    val top = (containerHeight - h) / 2
    val k = w / Interactions.DESIGN_WIDTH
    return Placement(left + x * k, top + y * h / Interactions.DESIGN_HEIGHT, width * k, k)
}

/** Whole percentages that add up to 100 (largest remainder; ties go to the earlier option). */
fun percentages(counts: List<Int>): List<Int> {
    val total = counts.sum()
    if (total <= 0) return counts.map { 0 }
    val exact = counts.map { it * 100.0 / total }
    val out = exact.map { floor(it).toInt() }.toMutableList()
    var left = 100 - out.sum()
    val order = exact.indices.sortedWith(compareByDescending<Int> { exact[it] - floor(exact[it]) }.thenBy { it })
    for (i in order) {
        if (left <= 0) break
        out[i]++
        left--
    }
    return out
}

data class CountdownParts(val ended: Boolean, val days: Int, val hours: Int, val minutes: Int, val seconds: Int)

fun countdownParts(endsAtMs: Long, nowMs: Long = System.currentTimeMillis()): CountdownParts {
    val left = Math.floorDiv(endsAtMs - nowMs, 1000L)
    if (left <= 0) return CountdownParts(true, 0, 0, 0, 0)
    return CountdownParts(false, (left / 86400).toInt(), (left % 86400 / 3600).toInt(), (left % 3600 / 60).toInt(), (left % 60).toInt())
}

/** What people answered so far: votes per option (poll, quiz) or the average (slider, 0–100). */
data class AnswerResults(val total: Int, val counts: List<Int>?, val average: Int?) {
    val json: Map<String, Any?>
        get() = buildMap {
            put("total", total)
            counts?.let { put("counts", it) }
            average?.let { put("average", it) }
        }

    companion object {
        fun fromJson(json: Any?): AnswerResults? {
            val o = json.asObject() ?: return null
            val total = o["total"].asNumber() ?: return null
            return AnswerResults(
                total.toInt(),
                o["counts"].asArray()?.mapNotNull { it.asNumber()?.toInt() },
                o["average"].asNumber()?.toInt(),
            )
        }
    }
}

/** A person's answer to a sticker, and the results they were shown. */
data class StoredAnswer(val value: Int, val results: AnswerResults? = null)

/**
 * Answers kept on the device, so a story shows what the person answered when they come back.
 * Keyed by story and sticker; the oldest are dropped past [MAX_IDS].
 */
class AnswerStore(private val storage: KeyValueStorage?, appId: String) {
    private val key = "stories:answers:$appId"
    /** Insertion order: the first is the oldest. */
    private val map = LinkedHashMap<String, StoredAnswer>()

    init {
        // Storage unavailable or corrupt: start empty.
        runCatching { storage?.getItem(key)?.takeIf { it.isNotEmpty() }?.let(Json::parse).asObject() }.getOrNull()
            ?.forEach { (k, v) ->
                val a = v.asObject() ?: return@forEach
                val value = a["value"].asNumber() ?: return@forEach
                map[k] = StoredAnswer(value.toInt(), AnswerResults.fromJson(a["results"]))
            }
    }

    @Synchronized
    fun get(storyId: String, interactionId: String): StoredAnswer? = map["$storyId:$interactionId"]

    @Synchronized
    fun set(storyId: String, interactionId: String, answer: StoredAnswer) {
        val k = "$storyId:$interactionId"
        map.remove(k)
        map[k] = answer
        val extra = map.size - MAX_IDS
        if (extra > 0) map.keys.take(extra).forEach(map::remove)
        val out = map.mapValues { (_, a) ->
            buildMap<String, Any?> {
                put("value", a.value)
                a.results?.let { put("results", it.json) }
            }
        }
        runCatching { storage?.setItem(key, Json.stringify(out)) }
    }

    companion object {
        const val MAX_IDS = 200
    }
}

fun answersUrl(apiUrl: String, token: String): String =
    "${apiUrl.trimEnd('/')}/v1/answers?token=${java.net.URLEncoder.encode(token, "UTF-8")}"

/** The JSON body of an answer. */
fun answerBody(storyId: String, interactionId: String, value: Int, viewer: String?): String =
    Json.stringify(buildMap {
        put("storyId", storyId)
        put("interactionId", interactionId)
        put("value", value)
        viewer?.let { put("viewer", it) }
    })

object InteractionLabels {
    val COUNTDOWN_UNITS = listOf("days", "hours", "mins", "secs")
    const val COUNTDOWN_ENDED = "Ended"
    fun pollOption(option: String, percent: Int) = "$option, $percent%"
    fun slider(question: String) = if (question.isEmpty()) "Slide to answer" else "$question Slide to answer"
    const val SLIDER_AVERAGE = "Average"
}

// --- Fitting the screen (spec/cases/display.json)

/**
 * How a story fits the screen: covering it, or shown whole with the gaps in [fillTop]/[fillBottom];
 * and a designed video's [overlay].
 */
data class StoryLook(
    /** Covers the screen (edges may be cropped). False: shown whole ("fit"). */
    val fills: Boolean,
    /** Gap colours for a story shown whole, top to bottom ("#rrggbb"); null = black. */
    val fillTop: String?,
    val fillBottom: String?,
    /**
     * A designed video's text and stickers: a transparent 1080 × 1920 image drawn over it, fitted as
     * a story image would be. Videos only, http(s) only; null = none.
     */
    val overlay: String? = null,
) {
    val json: Map<String, Any?>
        get() = mapOf(
            "fit" to if (fills) "fill" else "fit",
            "fill" to if (fillTop != null && fillBottom != null) mapOf("top" to fillTop, "bottom" to fillBottom) else null,
            "overlay" to overlay,
        )

    companion object {
        fun fromJson(json: Map<String, Any?>): StoryLook {
            val fills = json["fit"] == "fill"
            val f = json["fill"].asObject()
            val top = (f?.get("top") as? String)?.takeIf { HEX.matches(it) }
            val bottom = (f?.get("bottom") as? String)?.takeIf { HEX.matches(it) }
            val overlay = (json["overlay"] as? String)
                ?.takeIf { json["type"] == "video" && Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(it) }
            return if (!fills && top != null && bottom != null) StoryLook(false, top, bottom, overlay) else StoryLook(fills, null, null, overlay)
        }
    }
}
