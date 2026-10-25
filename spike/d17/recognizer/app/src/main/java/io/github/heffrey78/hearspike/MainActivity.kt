package io.github.heffrey78.hearspike

import android.app.Activity
import android.content.Intent
import android.media.AudioFormat
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.TextView
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * Android's own on-device recognizer on one of the spike's clips, as if spoken: the clip is fed
 * through a pipe at the pace it was spoken, and each partial and segment result is written with
 * its time, for the bench to score as it scores the engines (bench --events).
 *
 *   adb shell am start -n io.github.heffrey78.hearspike/.MainActivity --es clip librispeech-test-clean
 *
 * The clip is read from, and the events written to, the app's files folder on the shared storage.
 */
class MainActivity : Activity() {
    private lateinit var out: FileOutputStream
    private var t0 = 0L

    private fun event(kind: String, text: String = "") {
        val line = JSONObject().put("t", (SystemClock.elapsedRealtime() - t0) / 1000.0).put("kind", kind).put("text", text)
        out.write("$line\n".toByteArray())
        out.flush()
    }

    private fun first(results: Bundle?): String = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val status = TextView(this)
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

        val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
        val (read, write) = ParcelFileDescriptor.createPipe()
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onPartialResults(partialResults: Bundle?) = event("heard", first(partialResults))
            override fun onSegmentResults(segmentResults: Bundle) = event("settled", first(segmentResults))
            override fun onResults(results: Bundle?) {
                event("settled", first(results))
                event("done")
                status.text = "Done: $clip"
            }
            override fun onEndOfSegmentedSession() {
                event("done")
                status.text = "Done: $clip"
            }
            override fun onError(error: Int) {
                event("error", "error $error")
                event("done")
                status.text = "Error $error"
            }
        })
        val listen = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, read)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, 16000)
            // One session over the whole clip, a result for each phrase, until the pipe closes.
            putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
        }
        t0 = SystemClock.elapsedRealtime()
        recognizer.startListening(listen)

        // The clip at the pace it was spoken: 100 ms of samples every 100 ms, after the WAV header.
        Thread {
            FileInputStream(wav).use { input ->
                ParcelFileDescriptor.AutoCloseOutputStream(write).use { pipe ->
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
                        pipe.write(piece, 0, got)
                    }
                }
            }
        }.start()
    }
}
