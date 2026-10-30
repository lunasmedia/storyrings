package com.lunasmedia.storyrings.core

import java.util.Calendar
import java.util.TimeZone
import kotlin.math.ceil
import kotlin.math.roundToInt

// The /v1/feed response: parsed defensively (spec/cases/feed.json), then typed for the UI.

/** `code`: invalid_token, unknown_bar, network, server, invalid_response. */
class StoriesException(val code: String, message: String, val status: Int? = null) : Exception(message)

/** Shape and size of every item in the bar, from the dashboard. `corner`: % of the shorter side (50 = circle). */
data class BarLayout(val width: Int, val height: Int, val corner: Int, val gap: Int) {
    val cornerRadius: Double get() = minOf(width, height) * corner / 100.0

    fun toJson(): Map<String, Any?> = linkedMapOf("width" to width, "height" to height, "corner" to corner, "gap" to gap)

    companion object {
        val DEFAULTS = BarLayout(width = 68, height = 68, corner = 50, gap = 14)
        private val limits = listOf("width" to (40.0 to 160.0), "height" to (40.0 to 240.0), "corner" to (0.0 to 50.0), "gap" to (0.0 to 48.0))

        /** Fills in and clamps a layout; unknown or invalid values fall back to the defaults. */
        fun resolve(input: Any?): BarLayout {
            val out = DEFAULTS.toJson().mapValues { (it.value as Int) }.toMutableMap()
            val map = input.asObject()
            if (map != null) {
                for ((key, range) in limits) {
                    val v = map[key].asNumber() ?: continue
                    if (!v.isFinite()) continue
                    out[key] = v.coerceIn(range.first, range.second).roundToInt()
                }
            }
            return BarLayout(out["width"]!!, out["height"]!!, out["corner"]!!, out["gap"]!!)
        }
    }
}

/**
 * Defensive parsing at the JSON level, exactly like the other SDKs: malformed groups and stories
 * are dropped rather than crashing the app. Unknown fields are kept.
 */
fun normalizeFeedJson(body: Any?): Map<String, Any?> {
    val root = body.asObject()
    val rawGroups = root?.get("groups").asArray()
    val app = root?.get("app").asObject()
    if (root == null || rawGroups == null || app == null) throw StoriesException("invalid_response", "Unexpected feed format")
    fun validStory(any: Any?): Boolean {
        val s = any.asObject() ?: return false
        val type = s["type"]
        val d = s["durationMs"].asNumber()
        return s["id"] is String && s["url"] is String && (type == "image" || type == "video") && d != null && d > 0
    }
    val groups = rawGroups.mapNotNull { any ->
        val g = any.asObject() ?: return@mapNotNull null
        val stories = g["stories"].asArray()
        if (g["id"] !is String || g["title"] !is String || stories == null) return@mapNotNull null
        val valid = stories.filter(::validStory)
        if (valid.isEmpty()) null else LinkedHashMap(g).apply { put("stories", valid) }
    }
    val appOut = linkedMapOf<String, Any?>(
        "id" to stringify(app["id"]),
        "deepLinkSchemes" to (app["deepLinkSchemes"] ?: emptyList<Any?>()),
        "sharing" to (app["sharing"] == true),
    )
    (app["shareLink"] as? String)?.let { appOut["shareLink"] = it }
    if (app["layout"].asObject() != null) appOut["layout"] = BarLayout.resolve(app["layout"]).toJson()
    val out = linkedMapOf<String, Any?>()
    val bar = root["bar"].asObject()
    val key = bar?.get("key") as? String
    if (bar != null && key != null) out["bar"] = linkedMapOf("id" to stringify(bar["id"]), "key" to key)
    out["app"] = appOut
    out["groups"] = groups
    return out
}

data class RingStyle(
    /** gradient, solid or none. */
    val style: String,
    val colors: List<String>,
    val angle: Double,
    val width: Double,
    val gap: Double,
    /** "background", "transparent" or a hex colour. */
    val gapColor: String,
    val seenColor: String,
    /** none, rotate, pulse or shimmer. */
    val animation: String,
    /** slow, normal or fast. */
    val speed: String,
    val animateOnlyUnseen: Boolean,
)

data class BadgeStyle(
    /** none, preset, text, emoji or countdown. */
    val type: String,
    val text: String,
    val background: String,
    val color: String,
    /** bottom or top-right. */
    val position: String,
)

/** `color`: "inherit" or a hex colour. */
data class TitleStyle(val hidden: Boolean, val color: String, val weight: Int, val maxLines: Int)

/** A group's resolved circle style, as sent by the server (dashboard defaults when absent). */
data class Appearance(val ring: RingStyle, val badge: BadgeStyle, val title: TitleStyle) {
    /** Text in the badge, or null if there's none. Countdowns need the group's end time. */
    fun badgeLabel(endsAtMs: Long?, nowMs: Long = System.currentTimeMillis()): String? = when (badge.type) {
        "none" -> null
        "countdown" -> endsAtMs?.let { formatCountdown(it - nowMs) }
        else -> badge.text.ifEmpty { null }
    }

    companion object {
        val DEFAULTS = Appearance(
            ring = RingStyle(
                style = "gradient", colors = listOf("#feda75", "#d62976", "#962fbf"), angle = 45.0, width = 3.0,
                gap = 2.0, gapColor = "background", seenColor = "#c7c7cc", animation = "none", speed = "normal",
                animateOnlyUnseen = true,
            ),
            badge = BadgeStyle(type = "none", text = "", background = "#e8175d", color = "#ffffff", position = "bottom"),
            title = TitleStyle(hidden = false, color = "inherit", weight = 400, maxLines = 1),
        )

        fun fromJson(json: Any?): Appearance {
            val map = json.asObject() ?: return DEFAULTS
            val d = DEFAULTS
            val r = map["ring"].asObject() ?: emptyMap()
            val b = map["badge"].asObject() ?: emptyMap()
            val t = map["title"].asObject() ?: emptyMap()
            fun str(m: Map<String, Any?>, k: String, fallback: String) = m[k] as? String ?: fallback
            fun num(m: Map<String, Any?>, k: String, fallback: Double) = m[k].asNumber() ?: fallback
            fun bool(m: Map<String, Any?>, k: String, fallback: Boolean) = m[k] as? Boolean ?: fallback
            return Appearance(
                ring = RingStyle(
                    style = str(r, "style", d.ring.style),
                    colors = r["colors"].asArray()?.filterIsInstance<String>() ?: d.ring.colors,
                    angle = num(r, "angle", d.ring.angle),
                    width = num(r, "width", d.ring.width),
                    gap = num(r, "gap", d.ring.gap),
                    gapColor = str(r, "gapColor", d.ring.gapColor),
                    seenColor = str(r, "seenColor", d.ring.seenColor),
                    animation = str(r, "animation", d.ring.animation),
                    speed = str(r, "speed", d.ring.speed),
                    animateOnlyUnseen = bool(r, "animateOnlyUnseen", d.ring.animateOnlyUnseen),
                ),
                badge = BadgeStyle(
                    type = str(b, "type", d.badge.type),
                    text = str(b, "text", d.badge.text),
                    background = str(b, "background", d.badge.background),
                    color = str(b, "color", d.badge.color),
                    position = str(b, "position", d.badge.position),
                ),
                title = TitleStyle(
                    hidden = bool(t, "hidden", d.title.hidden),
                    color = str(t, "color", d.title.color),
                    weight = num(t, "weight", d.title.weight.toDouble()).toInt(),
                    maxLines = num(t, "maxLines", d.title.maxLines.toDouble()).toInt(),
                ),
            )
        }
    }
}

/** "2d", "5h", "12m"; null once the time is up. */
fun formatCountdown(ms: Long): String? {
    if (ms <= 0) return null
    val minutes = ceil(ms / 60000.0).toLong()
    if (minutes < 60) return "${minutes}m"
    val hours = minutes / 60
    if (hours < 48) return "${hours}h"
    return "${hours / 24}d"
}

data class FeedStory(
    val id: String,
    val type: String,
    val url: String,
    val durationMs: Int,
    val title: String?,
    val width: Int?,
    val height: Int?,
    val alt: String,
    val ctaLabel: String?,
    val ctaUrl: String?,
    /** Interactive stickers drawn over the image. */
    val interactions: List<Interaction> = emptyList(),
    /** How it fits the screen. */
    val look: StoryLook = StoryLook(false, null, null),
    val ctaStyle: CtaStyle = CtaStyle.PILL,
) {
    val viewer: ViewerStory get() = ViewerStory(id, durationMs, type)

    companion object {
        internal fun fromJson(json: Map<String, Any?>): FeedStory {
            val cta = json["cta"].asObject()
            return FeedStory(
                id = json["id"] as String,
                type = json["type"] as String,
                url = json["url"] as String,
                durationMs = json["durationMs"].asNumber()!!.roundToInt(),
                title = json["title"] as? String,
                width = json["width"].asNumber()?.toInt(),
                height = json["height"].asNumber()?.toInt(),
                alt = json["alt"] as? String ?: "",
                ctaLabel = cta?.get("label") as? String,
                ctaUrl = cta?.get("url") as? String,
                interactions = parseInteractions(json["interactions"]),
                look = StoryLook.fromJson(json),
                ctaStyle = CtaStyle.fromJson(cta?.get("style")),
            )
        }
    }
}

data class FeedGroup(
    val id: String,
    val title: String,
    /** Still cover (also the poster of animated covers). */
    val coverUrl: String,
    /** Looping muted video for animated covers. */
    val coverVideoUrl: String?,
    val stories: List<FeedStory>,
    val appearance: Appearance,
    /** When the group ends (for countdown badges), in ms since 1970. */
    val endsAtMs: Long?,
) {
    val viewer: ViewerGroup get() = ViewerGroup(id, stories.map { it.viewer })
    val storyIds: List<String> get() = stories.map { it.id }

    companion object {
        internal fun fromJson(json: Map<String, Any?>): FeedGroup {
            val cover = json["cover"].asObject()
            return FeedGroup(
                id = json["id"] as String,
                title = json["title"] as String,
                coverUrl = cover?.get("image") as? String ?: json["coverUrl"]?.let(::stringify) ?: "",
                coverVideoUrl = cover?.get("video") as? String,
                stories = json["stories"].asArray().orEmpty().mapNotNull { it.asObject() }.map(FeedStory::fromJson),
                appearance = Appearance.fromJson(json["appearance"]),
                endsAtMs = (json["endsAt"] as? String)?.let(::parseIsoDate),
            )
        }
    }
}

data class Feed(
    val appId: String,
    val deepLinkSchemes: List<String>,
    val sharing: Boolean,
    /** The app's share link with {group}/{story} placeholders (set when sharing is on). */
    val shareLink: String?,
    val layout: BarLayout?,
    val barKey: String?,
    val groups: List<FeedGroup>,
) {
    val viewerGroups: List<ViewerGroup> get() = groups.map { it.viewer }

    companion object {
        /** From a raw /v1/feed body. Throws [StoriesException] for an unusable response. */
        fun fromBody(body: Any?): Feed = fromNormalized(normalizeFeedJson(body))

        fun fromNormalized(json: Map<String, Any?>): Feed {
            val app = json["app"].asObject() ?: emptyMap()
            return Feed(
                appId = stringify(app["id"]),
                deepLinkSchemes = app["deepLinkSchemes"].asArray()?.filterIsInstance<String>().orEmpty(),
                sharing = app["sharing"] == true,
                shareLink = app["shareLink"] as? String,
                layout = app["layout"]?.let { BarLayout.resolve(it) },
                barKey = json["bar"].asObject()?.get("key") as? String,
                groups = json["groups"].asArray().orEmpty().mapNotNull { it.asObject() }.map(FeedGroup::fromJson),
            )
        }
    }
}

private val isoDate = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})$""")

/** An ISO 8601 date-time with a zone (as the API sends), in ms since 1970. (java.time needs API 26.) */
internal fun parseIsoDate(text: String): Long? {
    val m = isoDate.matchEntire(text) ?: return null
    val (y, mo, d, h, mi, s, frac, zone) = m.destructured
    val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
        clear()
        set(y.toInt(), mo.toInt() - 1, d.toInt(), h.toInt(), mi.toInt(), s.toInt())
    }
    val ms = if (frac.isEmpty()) 0 else (frac.drop(1).padEnd(3, '0').take(3)).toInt()
    val offset = if (zone == "Z") 0 else {
        val digits = zone.drop(1).replace(":", "")
        val minutes = digits.take(2).toInt() * 60 + digits.drop(2).toInt()
        (if (zone[0] == '-') -minutes else minutes) * 60_000
    }
    return cal.timeInMillis + ms - offset
}
