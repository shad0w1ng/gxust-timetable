package com.gxust.timetable

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * 内置浏览器：用户自己登录教务系统，登录态只存在于这个 WebView 里。
 * App 不接触密码，也不上传任何凭据。
 */
class SyncActivity : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(28, 28, 20, 20)
            setBackgroundColor(Color.parseColor("#F2F4F7"))
        }

        val tip = TextView(this).apply {
            text = "登录教务系统后停在课表页，点右下角「同步课表」"
            textSize = 12.5f
            setTextColor(Color.parseColor("#12151A"))
        }
        bar.addView(
            tip,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )

        val backBtn = Button(this).apply {
            text = "返回课表"
            textSize = 13f
            setOnClickListener { finish() }
        }
        bar.addView(backBtn)

        root.addView(
            bar,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )

        web = WebView(this)
        root.addView(
            web,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        setContentView(root)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = true
            displayZoomControls = false
            // 教务系统内部有 http 资源，放行混合内容
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        web.addJavascriptInterface(Bridge(), "GxustNative")

        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                if (view != null) inject(view)
            }
        }

        web.loadUrl("https://jwxt.gxust.edu.cn/xtgl/login_slogin.html")
    }

    private fun inject(view: WebView) {
        try {
            val js = assets.open("sync-inject.js").bufferedReader().use { it.readText() }
            view.evaluateJavascript(js, null)
        } catch (e: Exception) {
            // 注入失败不阻断，用户仍可手动操作
        }
    }

    inner class Bridge {
        @JavascriptInterface
        fun onResult(payload: String) {
            runOnUiThread {
                SyncBus.put(payload)
                Toast.makeText(this@SyncActivity, "抓取成功，正在导入…", Toast.LENGTH_SHORT).show()
                finish()
            }
        }

        @JavascriptInterface
        fun onError(message: String) {
            runOnUiThread {
                Toast.makeText(this@SyncActivity, message, Toast.LENGTH_LONG).show()
            }
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) {
            web.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
