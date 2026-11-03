package com.gxust.timetable

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject

class MainActivity : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this)
        setContentView(web)

        // 登录一次后 cookie 会持久保存，下次免登录
        android.webkit.CookieManager.getInstance().setAcceptCookie(true)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = false
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        // 用 https://appassets.androidplatform.net/ 提供本地资源，
        // 这样 localStorage / 剪贴板等 API 才有安全上下文
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                val ver = try {
                    packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
                } catch (e: Exception) {
                    "?"
                }
                view?.evaluateJavascript(
                    "(function(){var e=document.getElementById('appVer');" +
                        "if(e){e.textContent='v$ver \u00b7 App';}})()",
                    null
                )
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(
                view: WebView?, url: String?, message: String?, result: JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton("好") { _, _ -> result?.confirm() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }

            override fun onJsConfirm(
                view: WebView?, url: String?, message: String?, result: JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton("确定") { _, _ -> result?.confirm() }
                    .setNegativeButton("取消") { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }
        }

        NotificationHelper.ensureChannel(this)

        web.addJavascriptInterface(Bridge(), "AndroidBridge")
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    inner class Bridge {
        @JavascriptInterface
        fun isNative(): Boolean = true

        @JavascriptInterface
        fun openLogin() {
            runOnUiThread { smartSync() }
        }

        @JavascriptInterface
        fun saveFile(fileName: String, content: String, mime: String) {
            runOnUiThread { writeToDownloads(fileName, content, mime) }
        }

        /** 网页算好的提醒计划，交给系统闹钟排程 */
        @JavascriptInterface
        fun scheduleReminders(json: String) {
            runOnUiThread {
                try {
                    ReminderScheduler.saveAndSchedule(this@MainActivity, json)
                } catch (e: Exception) {
                    // 排程失败不影响主流程
                }
            }
        }

        /** 立即弹一条通知（测试用 / 前台提醒） */
        @JavascriptInterface
        fun notifyNow(title: String, body: String) {
            runOnUiThread {
                NotificationHelper.show(
                    this@MainActivity,
                    System.currentTimeMillis().toInt(),
                    title, body
                )
            }
        }

        @JavascriptInterface
        fun requestNotificationPermission() {
            runOnUiThread { askNotificationPermission() }
        }
    }

    private var syncing = false

    /**
     * 先拿 WebView 里现成的 cookie 直接拉课表：
     * 会话还有效就秒出结果，完全不用看登录页；
     * 失效了才打开内置浏览器让用户重新登录。
     */
    private fun smartSync() {
        if (syncing) {
            toast("正在同步，请稍候")
            return
        }
        val cookie = JwxtClient.currentCookie()
        if (cookie == null) {
            // 从没登录过，直接去登录
            startActivity(Intent(this, SyncActivity::class.java))
            return
        }

        syncing = true
        toast("正在同步…")

        Thread {
            val payload = JwxtClient.fetchTimetable(this@MainActivity, cookie)
            runOnUiThread {
                syncing = false
                if (payload != null) {
                    val js = "window.__onSyncPayload(" + JSONObject.quote(payload) + ");"
                    web.evaluateJavascript(js, null)
                } else {
                    // 会话过期或接口变化，退回登录流程
                    startActivity(Intent(this, SyncActivity::class.java))
                }
            }
        }.start()
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            val granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
                return
            }
        }
        toast("通知权限已开启")
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1001) {
            val ok = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            toast(if (ok) "提醒已开启" else "没有通知权限，无法提醒")
        }
    }

    private fun writeToDownloads(fileName: String, content: String, mime: String) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, mime)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri = contentResolver.insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, values
                )
                if (uri != null) {
                    contentResolver.openOutputStream(uri)?.use { os ->
                        os.write(content.toByteArray(Charsets.UTF_8))
                    }
                    toast("已保存到「下载」文件夹：$fileName")
                    return
                }
            }
            val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir
            val file = java.io.File(dir, fileName)
            file.writeText(content, Charsets.UTF_8)
            toast("已保存：${file.absolutePath}")
        } catch (e: Exception) {
            toast("保存失败：${e.message}")
        }
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
    }

    override fun onPause() {
        super.onPause()
        try { android.webkit.CookieManager.getInstance().flush() } catch (e: Exception) {}
    }

    override fun onResume() {
        super.onResume()
        val payload = SyncBus.take() ?: return
        if (!::web.isInitialized) return
        val js = "window.__onSyncPayload(" + JSONObject.quote(payload) + ");"
        web.evaluateJavascript(js, null)
    }
}
