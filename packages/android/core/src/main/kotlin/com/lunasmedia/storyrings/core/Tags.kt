package com.lunasmedia.storyrings.core

// User tags and story group tag filters (spec/cases/tags.json).

object Tags {
    /** Lowercase letters, digits and . _ : - (e.g. "london", "city:london"). */
    const val PATTERN = "^[a-z0-9][a-z0-9._:-]{0,63}$"
    const val MAX_PER_PERSON = 50
    private val regex = Regex(PATTERN)

    internal fun isValid(tag: String) = regex.matches(tag)
}

/**
 * Lowercased, trimmed, de-duplicated and sorted; anything that isn't a valid tag is dropped.
 * Accepts a list or a comma-separated string.
 */
fun normalizeTags(tags: Any?): List<String> {
    val list: List<Any?> = when (tags) {
        is String -> tags.split(",")
        is Iterable<*> -> tags.toList()
        else -> emptyList()
    }
    return list.filterIsInstance<String>()
        .map { it.trim().lowercase() }
        .filter(Tags::isValid)
        .toSortedSet()
        .take(Tags.MAX_PER_PERSON)
}

/** `mode`: "include" (people with any of the tags pass) or "exclude" (people with none of them pass). */
data class TagCondition(val mode: String, val tags: List<String>)

/** Every condition must pass. */
fun matchesTagFilter(conditions: List<TagCondition>, tags: Set<String>): Boolean = conditions.all { c ->
    val any = c.tags.any(tags::contains)
    if (c.mode == "include") any else !any
}
