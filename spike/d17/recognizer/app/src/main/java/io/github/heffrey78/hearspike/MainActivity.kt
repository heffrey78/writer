package io.github.heffrey78.hearspike

import android.app.Activity
import android.content.Intent
import android.media.AudioFormat
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.WindowManager
import android.widget.TextView
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream

/**
 * Android's own on-device recognizer on one of the spike's clips, as if spoken: the clip is fed
 * through a pipe at the pace it was spoken, and each partial and final result is written with its
 * time, for the bench to score as it scores the engines (bench --events). A session of the
 * recognizer ends at a pause, or stops reading after about 20 s; another is started at once, as
 * Writer would have to, and the audio while none is listening is counted as lost.
 *
 *   adb shell am start -n io.github.heffrey78.hearspike/.MainActivity --es clip librispeech-test-clean
 *
 * The clip is read from, and the events written to, the app's files folder on the shared storage.
 */
class MainActivity : Activity() {
    private lateinit var out: FileOutputStream
    private lateinit var status: TextView
    private var t0 = 0L
    private var done = false

    private fun event(kind: String, text: String = "") {
        if (done) return
        if (kind == "done") done = true
        val line = JSONObject().put("t", (SystemClock.elapsedRealtime() - t0) / 1000.0).put("kind", kind).put("text", text)
        out.write("$line\n".toByteArray())
        out.flush()
    }

    private fun first(results: Bundle?): String = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Android stops recognizing for an app that's no longer in front: the screen stays on.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        status = TextView(this)
        setContentView(status)
        val clip = intent.getStringExtra("clip") ?: "librispeech-test-clean"
        val dir = getExternalFilesDir(null)!!
        val wav = File(dir, "$clip.wav")
        out = FileOutputStream(File(dir, "$clip.events.jsonl"))
        status.text = "Hearing $clip…"
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            event("error", "no on-device recognition")
            event("done")
            return finish()
        }

        t0 = SystemClock.elapsedRealtime()
        listen()

        // The clip at the pace it was spoken: 100 ms of samples every 100 ms, after the WAV header.
        // While no session is listening (between one ending and the next starting), the samples
        // are lost, as a microphone's would be.
        Thread {
            FileInputStream(wav).use { input ->
                input.skip(44)
                val piece = ByteArray(3200)
                var n = 0
                while (true) {
                    val got = input.read(piece)
                    if (got <= 0) break
                    n++
                    val due = t0 + n * 100L
                    val wait = due - SystemClock.elapsedRealtime()
                    if (wait > 0) Thread.sleep(wait)
                    val into = pipe
                    if (into == null) {
                        lostMs += got / 32
                        continue
                    }
                    try {
                        into.write(piece, 0, got)
                    } catch (e: IOException) {
                        // The session stopped reading without a word: end it and start another.
                        lostMs += got / 32
                        if (pipe === into) {
                            pipe = null
                            main.post { ended("stopped reading") }
                        }
                    }
                }
            }
            fed = true
            main.post {
                // The last session hears the end of the clip, and finishes.
                pipe?.let { runCatching { it.close() } }
                pipe = null
                main.postDelayed({ finishUp() }, 10_000)
            }
        }.start()
    }

    private val main = Handler(Looper.getMainLooper())
    @Volatile private var pipe: OutputStream? = null
    @Volatile private var fed = false
    @Volatile private var lostMs = 0
    private var recognizer: SpeechRecognizer? = null
    private var sessions = 0
    private var failures = 0

    /** A new session of the recognizer, reading from a new pipe. */
    private fun listen() {
        if (done) return
        if (fed) return finishUp()
        recognizer?.destroy()
        val r = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
        recognizer = r
        val (read, write) = ParcelFileDescriptor.createPipe()
        val session = ++sessions
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onPartialResults(partialResults: Bundle?) {
                if (session == sessions) event("heard", first(partialResults))
            }
            override fun onResults(results: Bundle?) {
                if (session != sessions) return
                failures = 0
                event("settled", first(results))
                ended("results")
            }
            override fun onError(error: Int) {
                if (session != sessions) return
                event("error", "error $error")
                // No speech in a session (a pause) is no failure; anything else, a few times over, is.
                if (error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT && ++failures >= 5) return finishUp()
                ended("error $error")
            }
        })
        event("session", "$session")
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, read)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, 16000)
        })
        pipe = ParcelFileDescriptor.AutoCloseOutputStream(write)
    }

    /** A session is over: the next one starts at once, unless the clip is. */
    private fun ended(why: String) {
        event("ended", why)
        pipe?.let { runCatching { it.close() } }
        pipe = null
        main.post { listen() }
    }

    private fun finishUp() {
        if (done) return
        event("lost", "$lostMs")
        event("done")
        recognizer?.destroy()
        recognizer = null
        status.text = "Done"
    }

    // Sent to the background anyway (another app, the power button): say so, rather than go quiet.
    override fun onStop() {
        super.onStop()
        event("error", "the app left the screen")
        event("done")
    }
}
