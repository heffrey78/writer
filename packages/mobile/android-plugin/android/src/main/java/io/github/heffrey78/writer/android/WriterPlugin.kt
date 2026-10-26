package io.github.heffrey78.writer.android

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewFeature
import app.tauri.annotation.Command
import app.tauri.PermissionState
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class UrlArgs {
    lateinit var url: String
}

@InvokeArg
class MicrophoneArgs {
    /** Ask for it, with Android's prompt, if it isn't allowed yet. */
    var ask: Boolean = false
}

@InvokeArg
class BytesArgs {
    /** Base64. */
    lateinit var data: String
}

/**
 * Writer's Android plugin (#52): the GitHub token sealed by an AES key kept in Android's keystore,
 * other sites opened in the phone's browser, the page kept clear of the system's bars, the page's
 * service worker given the app's own files, and the microphone asked for, for dictation (#86).
 */
@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")])
class WriterPlugin(private val activity: Activity) : Plugin(activity) {
    private var webView: WebView? = null

    override fun load(webView: WebView) {
        this.webView = webView
        keepClearOfBars(webView)
        serveTheWorker(webView)
    }

    /**
     * The app went to the background: the page is told, with a `writer-background` event. Its
     * document stays "visible" (the webview's own onPause, which wry calls, doesn't hide it), and
     * the page saves the text it holds, and stops dictating, as it does when a browser hides it (#86).
     */
    override fun onPause() {
        webView?.evaluateJavascript("dispatchEvent(new Event('writer-background'))", null)
    }

    /**
     * The app draws edge to edge: the page is kept clear of the status and navigation bars, a
     * camera's cutout and the keyboard, which would otherwise cover the top bar and the line being
     * written.
     */
    private fun keepClearOfBars(webView: WebView) {
        val frame = webView.parent as? View ?: webView
        ViewCompat.setOnApplyWindowInsetsListener(frame) { view, insets ->
            val clear = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            view.setPadding(clear.left, clear.top, clear.right, clear.bottom)
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(frame)
    }

    private fun serveTheWorker(webView: WebView) {
        // The engine's service worker (engine-sw.js) is fetched, and the requests it lets through
        // are made, outside the webview's own client: Android asks a service worker client, which
        // Tauri doesn't set, so they'd go to the network for a host that isn't there. Given the
        // webview's client, they're answered as the page's are.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) return
        val client = webView.webViewClient
        ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
            override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                client.shouldInterceptRequest(webView, request)
        })
    }

    /** Another site, in the phone's browser (or whichever app the writer opens such links with). */
    @Command
    fun view(invoke: Invoke) {
        try {
            val url = Uri.parse(invoke.parseArgs(UrlArgs::class.java).url)
            if (url.scheme != "https" && url.scheme != "http") throw IllegalArgumentException("Only web addresses open elsewhere.")
            activity.startActivity(Intent(Intent.ACTION_VIEW, url))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.javaClass.simpleName)
        }
    }

    /**
     * Whether dictation may use the microphone: "granted", "prompt" (not asked yet, or Android
     * would ask again) or "denied" (refused for good: only Android's settings can allow it now).
     * With `ask`, Android's prompt first, where it would show one.
     */
    @Command
    fun microphone(invoke: Invoke) {
        val state = getPermissionState("microphone")
        if (state == PermissionState.GRANTED || state == PermissionState.DENIED || !invoke.parseArgs(MicrophoneArgs::class.java).ask) return microphoneAnswered(invoke)
        requestPermissionForAlias("microphone", invoke, "microphoneAnswered")
    }

    @PermissionCallback
    private fun microphoneAnswered(invoke: Invoke) {
        val state = when (getPermissionState("microphone")) {
            PermissionState.GRANTED -> "granted"
            PermissionState.DENIED -> "denied"
            else -> "prompt"
        }
        invoke.resolve(JSObject().put("state", state))
    }

    @Command
    fun seal(invoke: Invoke) = answer(invoke) { plain ->
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.iv + cipher.doFinal(plain)
    }

    @Command
    fun open(invoke: Invoke) = answer(invoke) { sealed ->
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, sealed, 0, NONCE))
        cipher.doFinal(sealed, NONCE, sealed.size - NONCE)
    }

    private fun answer(invoke: Invoke, work: (ByteArray) -> ByteArray) {
        try {
            val bytes = Base64.decode(invoke.parseArgs(BytesArgs::class.java).data, Base64.NO_WRAP)
            invoke.resolve(JSObject().put("data", Base64.encodeToString(work(bytes), Base64.NO_WRAP)))
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.javaClass.simpleName)
        }
    }

    /** The app's key: made in the keystore the first time, and never leaving it. */
    private fun key(create: Boolean = true): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(ALIAS, null) as SecretKey?)?.let { return it }
        if (!create) throw IllegalStateException("The key that sealed this is gone.")
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "writer-secrets"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val NONCE = 12
    }
}
