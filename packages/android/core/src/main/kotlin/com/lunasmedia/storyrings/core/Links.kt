package com.lunasmedia.storyrings.core

// Share links and which story button links may open (spec/cases/links.json).
// Works on strings rather than java.net.URI, which re-encodes some characters.

private const val SHARE_PREFIX = "#stories="

/** Schemes that may never be opened from a story button. */
val BLOCKED_SCHEMES = setOf("javascript", "data", "vbscript", "file", "blob", "about")

private val schemeRegex = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$", RegexOption.DOT_MATCHES_ALL)

/** A button link is allowed when it's an absolute http(s) URL or uses one of the app's own deep-link schemes. */
fun isAllowedCtaUrl(url: String, deepLinkSchemes: List<String> = emptyList()): Boolean {
    // Control characters and spaces can smuggle schemes past naive checks.
    if (url.any { it.code <= 0x20 || it.code == 0x7f }) return false
    val m = schemeRegex.matchEntire(url) ?: return false
    val scheme = m.groupValues[1].lowercase()
    val rest = m.groupValues[2]
    if (scheme in BLOCKED_SCHEMES) return false
    if (scheme == "http" || scheme == "https") return Regex("^//[^/?#]+").containsMatchIn(rest)
    return scheme in deepLinkSchemes && rest.isNotEmpty()
}

/**
 * How the story button looks: a white pill, a dark pill or an outline, or a swipe up (a chevron
 * over the label, or over a white pill), where swiping up on the story opens the link.
 */
enum class CtaStyle(val json: String) {
    PILL("pill"),
    DARK("dark"),
    OUTLINE("outline"),
    SWIPE("swipe"),
    SWIPE_PILL("swipe-pill"),
    ;

    /** Swiping up on the story opens the link. */
    val isSwipe: Boolean get() = this == SWIPE || this == SWIPE_PILL

    companion object {
        /** Anything unknown (or none, from older servers) is a pill. */
        fun fromJson(value: Any?): CtaStyle = entries.firstOrNull { it.json == value } ?: PILL
    }
}

private const val UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

/** Like JavaScript's encodeURIComponent. */
fun encodeComponent(s: String): String {
    val out = StringBuilder()
    for (b in s.toByteArray(Charsets.UTF_8)) {
        val c = (b.toInt() and 0xff).toChar()
        if (c in UNRESERVED) out.append(c) else out.append('%').append(String.format("%02X", b.toInt() and 0xff))
    }
    return out.toString()
}

/** Like JavaScript's decodeURIComponent; null for malformed escapes or UTF-8. */
internal fun decodeComponent(s: String): String? {
    if ('%' !in s) return s
    val bytes = java.io.ByteArrayOutputStream()
    var i = 0
    while (i < s.length) {
        val c = s[i]
        if (c == '%') {
            val hex = s.substring(i + 1, minOf(i + 3, s.length))
            if (hex.length != 2) return null
            val v = hex.toIntOrNull(16) ?: return null
            bytes.write(v)
            i += 3
        } else {
            bytes.write(c.toString().toByteArray(Charsets.UTF_8))
            i++
        }
    }
    val decoder = Charsets.UTF_8.newDecoder()
        .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
    return try {
        decoder.decode(java.nio.ByteBuffer.wrap(bytes.toByteArray())).toString()
    } catch (_: java.nio.charset.CharacterCodingException) {
        null
    }
}

/** A mobile app's link to a story: its share link (set in the dashboard) with {group} and {story} filled in. */
fun appShareUrl(template: String, groupId: String, storyId: String): String =
    template.split("{group}").joinToString(encodeComponent(groupId))
        .split("{story}").joinToString(encodeComponent(storyId))

/** Websites: a link to a story on a page (any existing fragment is replaced). */
fun shareUrl(pageUrl: String, groupId: String, storyId: String? = null): String {
    val base = pageUrl.substringBefore('#')
    return base + SHARE_PREFIX + encodeComponent(groupId) + (storyId?.let { "/" + encodeComponent(it) } ?: "")
}

data class ShareTarget(val groupId: String, val storyId: String?)

/** The story a web share link points to, or null. */
fun parseShareLink(url: String): ShareTarget? {
    if (schemeRegex.matchEntire(url) == null) return null
    val hash = url.indexOf('#')
    if (hash == -1 || !url.startsWith(SHARE_PREFIX, hash)) return null
    val parts = url.substring(hash + SHARE_PREFIX.length).split("/")
    if (parts.isEmpty() || parts[0].isEmpty() || parts.size > 2) return null
    val groupId = decodeComponent(parts[0]) ?: return null
    if (parts.size == 2 && parts[1].isNotEmpty()) {
        return ShareTarget(groupId, decodeComponent(parts[1]) ?: return null)
    }
    return ShareTarget(groupId, null)
}

/** The URL without a web share link fragment (other fragments are kept). */
fun withoutShareLink(url: String): String = if (parseShareLink(url) == null) url else url.substringBefore('#')
