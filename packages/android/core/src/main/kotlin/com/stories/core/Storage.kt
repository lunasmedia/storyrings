package com.stories.core

/** Where the SDK keeps "seen" stories, the last feed and the anonymous viewer ID. */
interface KeyValueStorage {
    fun getItem(key: String): String?
    fun setItem(key: String, value: String)
}

/** For tests, or when nothing should persist between launches. */
class MemoryStorage : KeyValueStorage {
    private val data = HashMap<String, String>()
    override fun getItem(key: String) = data[key]
    override fun setItem(key: String, value: String) {
        data[key] = value
    }
}
