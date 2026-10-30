package com.lunasmedia.storyrings

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.lunasmedia.storyrings.core.KeyValueStorage
import com.lunasmedia.storyrings.core.Scheduler
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** SharedPreferences (the default storage). */
class SharedPreferencesStorage(context: Context) : KeyValueStorage {
    private val prefs = context.getSharedPreferences("stories_sdk", Context.MODE_PRIVATE)
    override fun getItem(key: String): String? = prefs.getString(key, null)
    override fun setItem(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
}

internal object MainThread : Scheduler {
    private val handler = Handler(Looper.getMainLooper())

    fun post(task: Runnable) {
        if (Looper.myLooper() == Looper.getMainLooper()) task.run() else handler.post(task)
    }

    override fun schedule(delayMs: Long, task: () -> Unit): () -> Unit {
        val r = Runnable { task() }
        handler.postDelayed(r, delayMs)
        return { handler.removeCallbacks(r) }
    }
}

/** Network calls on a small background pool. */
internal val io = Executors.newFixedThreadPool(3) { r -> Thread(r, "stories-io").apply { isDaemon = true } }

internal object UrlConnectionHttp : HttpClient {
    override fun request(method: String, url: String, body: String?, done: (Int, String?) -> Unit) {
        io.execute {
            var conn: HttpURLConnection? = null
            try {
                conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    requestMethod = method
                    connectTimeout = 15_000
                    readTimeout = 15_000
                    setRequestProperty("Accept", "application/json")
                    if (body != null) {
                        doOutput = true
                        setRequestProperty("Content-Type", "text/plain;charset=UTF-8")
                        outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                    }
                }
                val status = conn.responseCode
                val stream = if (status >= 400) conn.errorStream else conn.inputStream
                val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) }
                done(status, text)
            } catch (_: Exception) {
                done(0, null)
            } finally {
                conn?.disconnect()
            }
        }
    }
}

/** App foreground/background for sessions and flushing analytics. */
internal object AppLifecycle {
    fun observe(client: StoriesClient) {
        MainThread.post {
            ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) = client.onForeground()
                override fun onStop(owner: LifecycleOwner) = client.onBackground()
            })
        }
    }
}

/** "Remove animations" in the system's accessibility or developer settings. */
internal fun Context.animationsOff(): Boolean =
    Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
