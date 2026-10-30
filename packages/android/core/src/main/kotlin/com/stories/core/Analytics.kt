package com.stories.core

// Batches analytics events (spec/cases/analytics.json) and sends them to /v1/events.

/** Sends one batch and calls `done` with whether it was accepted. `beacon`: the app is going away, so it isn't retried. */
fun interface AnalyticsTransport {
    fun send(url: String, body: String, beacon: Boolean, done: (Boolean) -> Unit)
}

/** Runs a task later (the flush timer); returns a way to cancel it. */
fun interface Scheduler {
    fun schedule(delayMs: Long, task: () -> Unit): () -> Unit
}

/**
 * Batches events and sends them every few seconds, or at once when a batch is full.
 * Use it from one thread (the main thread); `done` must be called back on that thread.
 */
class AnalyticsQueue(
    val url: String,
    /** e.g. "android@1.0.0". */
    val sdk: String,
    private val transport: AnalyticsTransport,
    private val scheduler: Scheduler,
    private val flushIntervalMs: Long = FLUSH_INTERVAL_MS,
    private val maxBatch: Int = MAX_BATCH,
    /** Cap on events held while the network is failing (the oldest are dropped). */
    private val maxQueue: Int = MAX_QUEUE,
    private val now: () -> Long = System::currentTimeMillis,
    val sessionId: String = randomId(),
    /** The anonymous viewer ID, read when sending (null = unique viewers aren't counted). */
    private val viewer: (() -> String?)? = null,
    /** ios or android. */
    val platform: String? = null,
    val automation: Boolean = false,
) {
    private val queue = ArrayList<Map<String, Any?>>()
    private var cancelTimer: (() -> Unit)? = null
    private var sending = false

    val pending: Int get() = queue.size

    /** Queues an event (a [StoryEvent]'s or activity event's JSON) with the current time. */
    fun track(event: Map<String, Any?>) {
        queue += LinkedHashMap(event).apply { put("ts", now()) }
        if (queue.size > maxQueue) queue.subList(0, queue.size - maxQueue).clear()
        if (queue.size >= maxBatch) flush() else schedule()
    }

    /** Sends everything queued. With [beacon] (the app is going away) failed sends aren't kept. */
    fun flush(beacon: Boolean = false) {
        clearTimer()
        // A send in progress continues with the rest when it succeeds.
        if (sending && !beacon) return
        sendNext(beacon)
    }

    private fun body(batch: List<Map<String, Any?>>): String {
        val out = linkedMapOf<String, Any?>("sdk" to sdk, "sessionId" to sessionId)
        viewer?.invoke()?.let { out["viewer"] = it }
        platform?.let { out["platform"] = it }
        if (automation) out["automation"] = true
        out["events"] = batch
        return Json.stringify(out)
    }

    private fun sendNext(beacon: Boolean) {
        while (queue.isNotEmpty()) {
            val batch = queue.take(maxBatch)
            queue.subList(0, batch.size).clear()
            if (beacon) {
                transport.send(url, body(batch), true) {}
                continue
            }
            sending = true
            transport.send(url, body(batch), false) { ok ->
                sending = false
                if (ok) {
                    sendNext(false)
                } else {
                    // Put the batch back and retry on the next flush.
                    queue.addAll(0, batch)
                    schedule()
                }
            }
            return
        }
    }

    /** Sends what's left without retrying (the app is going away) and stops the timer. */
    fun dispose() {
        clearTimer()
        flush(beacon = true)
    }

    /** Stops the flush timer without sending (tests). */
    fun cancelTimer() = clearTimer()

    private fun schedule() {
        if (cancelTimer != null) return
        cancelTimer = scheduler.schedule(flushIntervalMs) {
            cancelTimer = null
            flush()
        }
    }

    private fun clearTimer() {
        cancelTimer?.invoke()
        cancelTimer = null
    }

    companion object {
        const val FLUSH_INTERVAL_MS = 5000L
        const val MAX_BATCH = 50
        const val MAX_QUEUE = 500
    }
}
