package com.stories.core

/**
 * A small JSON reader and writer, so the core behaves identically on the JVM and on Android
 * (whose built-in org.json differs between versions). Objects are `Map<String, Any?>` (key order
 * kept), arrays `List<Any?>`, numbers `Long` or `Double`, and null is `null`.
 */
object Json {
    class ParseException(message: String) : Exception(message)

    fun parse(text: String): Any? {
        val p = Parser(text)
        p.skipSpace()
        val value = p.value()
        p.skipSpace()
        if (!p.done) throw ParseException("Unexpected text at ${p.pos}")
        return value
    }

    fun stringify(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

    private fun write(out: StringBuilder, value: Any?) {
        when (value) {
            null -> out.append("null")
            is String -> writeString(out, value)
            is Boolean -> out.append(value)
            is Int, is Long, is Short, is Byte -> out.append(value)
            is Number -> {
                val d = value.toDouble()
                when {
                    !d.isFinite() -> out.append("null")
                    d == Math.rint(d) && Math.abs(d) < 1e15 -> out.append(d.toLong())
                    else -> out.append(d)
                }
            }
            is Map<*, *> -> {
                out.append('{')
                var first = true
                for ((k, v) in value) {
                    if (!first) out.append(',')
                    first = false
                    writeString(out, k.toString())
                    out.append(':')
                    write(out, v)
                }
                out.append('}')
            }
            is Iterable<*> -> {
                out.append('[')
                var first = true
                for (v in value) {
                    if (!first) out.append(',')
                    first = false
                    write(out, v)
                }
                out.append(']')
            }
            is Array<*> -> write(out, value.asList())
            else -> writeString(out, value.toString())
        }
    }

    private fun writeString(out: StringBuilder, s: String) {
        out.append('"')
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                '\b' -> out.append("\\b")
                '\u000C' -> out.append("\\f")
                else -> if (c < ' ' || c == ' ' || c == ' ') {
                    out.append(String.format("\\u%04x", c.code))
                } else {
                    out.append(c)
                }
            }
        }
        out.append('"')
    }

    private class Parser(val s: String) {
        var pos = 0
        val done get() = pos >= s.length

        fun skipSpace() {
            while (pos < s.length && s[pos] in " \t\n\r") pos++
        }

        fun value(): Any? {
            if (done) throw ParseException("Unexpected end")
            return when (val c = s[pos]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c in '0'..'9') num() else throw ParseException("Unexpected '$c' at $pos")
            }
        }

        private fun literal(word: String, value: Any?): Any? {
            if (!s.startsWith(word, pos)) throw ParseException("Expected $word at $pos")
            pos += word.length
            return value
        }

        private fun obj(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            pos++
            skipSpace()
            if (s.getOrNull(pos) == '}') return out.also { pos++ }
            while (true) {
                skipSpace()
                if (s.getOrNull(pos) != '"') throw ParseException("Expected a key at $pos")
                val key = str()
                skipSpace()
                if (s.getOrNull(pos) != ':') throw ParseException("Expected ':' at $pos")
                pos++
                skipSpace()
                out[key] = value()
                skipSpace()
                when (s.getOrNull(pos)) {
                    ',' -> pos++
                    '}' -> return out.also { pos++ }
                    else -> throw ParseException("Expected ',' or '}' at $pos")
                }
            }
        }

        private fun arr(): List<Any?> {
            val out = ArrayList<Any?>()
            pos++
            skipSpace()
            if (s.getOrNull(pos) == ']') return out.also { pos++ }
            while (true) {
                skipSpace()
                out.add(value())
                skipSpace()
                when (s.getOrNull(pos)) {
                    ',' -> pos++
                    ']' -> return out.also { pos++ }
                    else -> throw ParseException("Expected ',' or ']' at $pos")
                }
            }
        }

        private fun str(): String {
            val out = StringBuilder()
            pos++
            while (true) {
                if (done) throw ParseException("Unterminated string")
                val c = s[pos++]
                when {
                    c == '"' -> return out.toString()
                    c == '\\' -> {
                        if (done) throw ParseException("Unterminated string")
                        when (val e = s[pos++]) {
                            '"', '\\', '/' -> out.append(e)
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000C')
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'u' -> {
                                if (pos + 4 > s.length) throw ParseException("Bad escape")
                                out.append(s.substring(pos, pos + 4).toInt(16).toChar())
                                pos += 4
                            }
                            else -> throw ParseException("Bad escape \\$e")
                        }
                    }
                    c < ' ' -> throw ParseException("Control character in string")
                    else -> out.append(c)
                }
            }
        }

        private fun num(): Number {
            val start = pos
            if (s[pos] == '-') pos++
            while (pos < s.length && s[pos] in '0'..'9') pos++
            var integer = true
            if (pos < s.length && s[pos] == '.') {
                integer = false
                pos++
                while (pos < s.length && s[pos] in '0'..'9') pos++
            }
            if (pos < s.length && (s[pos] == 'e' || s[pos] == 'E')) {
                integer = false
                pos++
                if (pos < s.length && (s[pos] == '+' || s[pos] == '-')) pos++
                while (pos < s.length && s[pos] in '0'..'9') pos++
            }
            val text = s.substring(start, pos)
            if (text == "-" || text.isEmpty()) throw ParseException("Bad number at $start")
            return if (integer) text.toLongOrNull() ?: text.toDouble() else text.toDouble()
        }
    }
}

// Helpers for reading parsed JSON defensively.

@Suppress("UNCHECKED_CAST")
internal fun Any?.asObject(): Map<String, Any?>? = this as? Map<String, Any?>

internal fun Any?.asArray(): List<Any?>? = this as? List<Any?>

/** A JSON number (booleans aren't numbers here), as a Double. */
internal fun Any?.asNumber(): Double? = (this as? Number)?.toDouble()

/** Like string interpolation in the other SDKs: whole numbers without ".0", null as "null". */
internal fun stringify(value: Any?): String = when (value) {
    null -> "null"
    is String -> value
    is Number -> Json.stringify(value)
    is Boolean -> value.toString()
    else -> value.toString()
}
