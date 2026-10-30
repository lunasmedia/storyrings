package com.lunasmedia.storyrings

import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import java.net.HttpURLConnection
import java.net.URL

/**
 * Downloaded images in memory, so covers preloaded before the bar appears show at once.
 * Use from the main thread; downloads and decoding happen on the IO pool.
 */
internal object ImageCache {
    /**
     * Covers and other small images keep a cache of their own, so a few big story photos (loaded
     * ahead to open at once) can never push them out.
     */
    private val small = object : LruCache<String, Bitmap>(16 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val large = object : LruCache<String, Bitmap>(64 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    /** Images up to this many bytes decoded count as small. */
    private const val SMALL_BYTES = 2 * 1024 * 1024
    private val waiting = HashMap<String, MutableList<(Bitmap?) -> Unit>>()

    fun cached(url: String): Bitmap? = small.get(url) ?: large.get(url)

    /** Calls back on the main thread with the image, or null if it couldn't load. */
    fun load(url: String, done: (Bitmap?) -> Unit) {
        cached(url)?.let { return done(it) }
        waiting[url]?.let { it += done; return }
        waiting[url] = mutableListOf(done)
        io.execute {
            val bitmap = runCatching {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 15_000
                conn.readTimeout = 15_000
                try {
                    if (conn.responseCode >= 400) null else decode(conn.inputStream.use { it.readBytes() })
                } finally {
                    conn.disconnect()
                }
            }.getOrNull()
            MainThread.post {
                if (bitmap != null) (if (bitmap.byteCount <= SMALL_BYTES) small else large).put(url, bitmap)
                waiting.remove(url)?.forEach { it(bitmap) }
            }
        }
    }
}

/**
 * Decodes an image no bigger than it needs to be to cover the screen: phone photos are often 12
 * megapixels or more (48 MB and up decoded), far beyond what the screen shows. Decoded whole, one
 * filled the cache by itself.
 */
private fun decode(data: ByteArray): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
    val screen = Resources.getSystem().displayMetrics
    val sw = minOf(screen.widthPixels, screen.heightPixels)
    val sh = maxOf(screen.widthPixels, screen.heightPixels)
    // Halved while both sides still cover the screen's.
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= sw && bounds.outHeight / (sample * 2) >= sh) sample *= 2
    return BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

/** A network image that shows immediately when cached, and reports when it loaded or failed. */
@Composable
internal fun RemoteImage(
    url: String,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    onResult: ((Boolean) -> Unit)? = null,
) {
    var image by remember(url) { mutableStateOf<ImageBitmap?>(ImageCache.cached(url)?.asImageBitmap()) }
    LaunchedEffect(url) {
        if (url.isEmpty()) return@LaunchedEffect onResult?.invoke(false) ?: Unit
        ImageCache.load(url) { bitmap ->
            if (bitmap != null) image = bitmap.asImageBitmap()
            onResult?.invoke(bitmap != null)
        }
    }
    image?.let { Image(bitmap = it, contentDescription = null, modifier = modifier, contentScale = contentScale) }
}
