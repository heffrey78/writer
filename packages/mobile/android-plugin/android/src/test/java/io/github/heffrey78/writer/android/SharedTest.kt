package io.github.heffrey78.writer.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Reading what's shared with Writer (#204), for each kind of share. */
class SharedTest {
    @Test
    fun aPicture() {
        assertEquals(Shared(listOf("content://photos/1"), null, null), readShare(ACTION_SEND, "image/jpeg", listOf("content://photos/1"), null, null))
    }

    @Test
    fun severalPictures() {
        val three = listOf("content://photos/1", "content://photos/2", "content://photos/3")
        assertEquals(Shared(three, null, null), readShare(ACTION_SEND_MULTIPLE, "image/*", three, null, null))
    }

    @Test
    fun text() {
        assertEquals(Shared(emptyList<String>(), "The ford floods in spring.", null), readShare(ACTION_SEND, "text/plain", emptyList<String>(), "  The ford floods in spring.\n", null))
    }

    @Test
    fun aLinkWithItsWordsAndTitle() {
        val shared = readShare(ACTION_SEND, "text/plain", emptyList<String>(), "Old bridges of the valley https://example.com/bridges", "Old bridges")
        assertEquals(Shared(emptyList<String>(), "Old bridges of the valley https://example.com/bridges", "Old bridges"), shared)
    }

    @Test
    fun aPictureWithACaption() {
        assertEquals(Shared(listOf("content://photos/1"), "From the north bank", null), readShare(ACTION_SEND, "image/png", listOf("content://photos/1"), "From the north bank", " "))
    }

    @Test
    fun notAShare() {
        assertNull(readShare("android.intent.action.MAIN", null, emptyList<String>(), null, null))
        assertNull(readShare(null, null, emptyList<String>(), null, null))
        // Nothing Writer keeps.
        assertNull(readShare(ACTION_SEND, "text/plain", emptyList<String>(), "   ", null))
        assertNull(readShare(ACTION_SEND, "application/pdf", listOf("content://files/1"), null, null))
    }

    @Test
    fun safeNames() {
        assertEquals("IMG_2041.jpg", safeName("IMG_2041.jpg", "picture"))
        assertEquals("evil.jpg", safeName("../../evil.jpg", "picture"))
        assertEquals("hidden", safeName(".hidden", "picture"))
        assertEquals("picture-1", safeName(null, "picture-1"))
        assertEquals("caf_.png", safeName("café.png", "picture"))
    }
}
