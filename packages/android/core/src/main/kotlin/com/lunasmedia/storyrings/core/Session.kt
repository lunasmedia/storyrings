package com.lunasmedia.storyrings.core

import java.util.UUID

// App sessions (active users) and the anonymous viewer ID (spec/cases/sessions.json).

object Sessions {
    /** A new app session starts after this long in the background (the Firebase rule). */
    const val TIMEOUT_MS = 30L * 60_000
    /** Anonymous viewer IDs are replaced after 13 months, the usual limit for audience measurement. */
    const val VIEWER_ID_MAX_AGE_MS = 395L * 86_400_000
    internal const val VIEWER_KEY = "stories:viewer"

    /** Whether coming back at [now], after leaving at [leftAt], starts a new session. */
    fun startsNew(leftAt: Long?, now: Long) = leftAt != null && now - leftAt >= TIMEOUT_MS

    /**
     * The anonymous ID used to count unique viewers: random, made on this device, with no link to
     * who the person is (the server only keeps a hash of it per app). Null without storage.
     */
    fun loadViewerId(storage: KeyValueStorage?, now: Long = System.currentTimeMillis()): String? {
        storage ?: return null
        return runCatching {
            val stored = runCatching { storage.getItem(VIEWER_KEY)?.takeIf { it.isNotEmpty() }?.let(Json::parse) }
                .getOrNull().asObject()
            val id = stored?.get("id") as? String
            val created = stored?.get("created").asNumber()
            if (id != null && created != null && now - created < VIEWER_ID_MAX_AGE_MS) return id
            val fresh = randomId()
            storage.setItem(VIEWER_KEY, Json.stringify(mapOf("id" to fresh, "created" to now)))
            fresh
        }.getOrNull()
    }

    /** Forgets the ID (e.g. when someone withdraws consent). */
    fun clearViewerId(storage: KeyValueStorage?) {
        runCatching { storage?.setItem(VIEWER_KEY, "") }
    }
}

/** A random version 4 UUID. */
fun randomId(): String = UUID.randomUUID().toString()
