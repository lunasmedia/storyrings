package com.lunasmedia.storyrings.core

// Which stories this device has seen (spec/cases/seen.json).

/**
 * A group counts as seen when all of its current stories are, so adding a story makes its ring
 * active again. Only the newest [MAX_IDS] ids are kept.
 */
class SeenStore(private val storage: KeyValueStorage?, appId: String) {
    private val key = "stories:seen:$appId"
    /** Insertion order: the first id is the oldest. */
    private val ids = LinkedHashSet<String>()

    init {
        // Storage unavailable or corrupt: start empty.
        runCatching { storage?.getItem(key)?.takeIf { it.isNotEmpty() }?.let(Json::parse).asArray() }
            .getOrNull()?.filterIsInstance<String>()?.let(ids::addAll)
    }

    fun has(storyId: String) = storyId in ids

    fun markSeen(storyId: String) {
        if (!ids.add(storyId)) return
        val extra = ids.size - MAX_IDS
        if (extra > 0) ids.removeAll(ids.take(extra).toSet())
        runCatching { storage?.setItem(key, Json.stringify(ids.toList())) }
    }

    fun isGroupSeen(storyIds: List<String>) = storyIds.isNotEmpty() && storyIds.all(ids::contains)

    /** First unseen story in a group, or 0 if it's fully seen (it replays from the start). */
    fun firstUnseenIndex(storyIds: List<String>) = storyIds.indexOfFirst { it !in ids }.coerceAtLeast(0)

    companion object {
        const val MAX_IDS = 1000
    }
}
