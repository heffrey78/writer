package io.github.heffrey78.writer.android

/*
 * What another app shared with Writer (#204), read from its intent: pictures (`streams`, one or
 * several), and text, which may be a link, with a subject some apps send as its title. Plain values,
 * so the reading is tested on the JVM without Android (SharedTest).
 */

const val ACTION_SEND = "android.intent.action.SEND"
const val ACTION_SEND_MULTIPLE = "android.intent.action.SEND_MULTIPLE"

data class Shared<T>(val streams: List<T>, val text: String?, val subject: String?)

/**
 * The share in an intent's action, streams and extras, or null when it isn't one (the app opened
 * from its icon), or shares nothing Writer keeps: no picture and no words.
 */
fun <T> readShare(action: String?, type: String?, streams: List<T>, text: CharSequence?, subject: CharSequence?): Shared<T>? {
    if (action != ACTION_SEND && action != ACTION_SEND_MULTIPLE) return null
    // Pictures only: a share of another kind of file is left alone (the filters ask for no other).
    val pictures = if (type == null || type.startsWith("image/") || type == "*/*" || type.startsWith("text/")) streams else emptyList()
    val words = text?.toString()?.trim()?.ifEmpty { null }
    if (pictures.isEmpty() && words == null) return null
    return Shared(if (action == ACTION_SEND) pictures.take(1) else pictures, words, subject?.toString()?.trim()?.ifEmpty { null })
}

/** A shared file's name, safe as a file's on the phone: no folders, nothing hidden, never empty. */
fun safeName(name: String?, fallback: String): String {
    val base = name?.substringAfterLast('/')?.replace(Regex("[^A-Za-z0-9._ -]"), "_")?.trimStart('.')?.take(120)
    return if (base.isNullOrBlank()) fallback else base
}
