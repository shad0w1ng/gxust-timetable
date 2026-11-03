package com.gxust.timetable

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar

/**
 * 用 WebView 里已有的 cookie 直接在原生侧拉课表。
 * 有有效会话时，点一下同步就能秒出结果，连登录页都不用看。
 */
object JwxtClient {

    private const val BASE = "https://jwxt.gxust.edu.cn"
    private const val PREFS = "gxust_prefs"
    private const val KEY_XNM = "last_xnm"
    private const val KEY_XQM = "last_xqm"

    /** 当前 WebView 保存的教务系统 cookie，没有则返回 null */
    fun currentCookie(): String? {
        val c = try {
            android.webkit.CookieManager.getInstance().getCookie(BASE)
        } catch (e: Exception) {
            null
        }
        return if (c.isNullOrBlank()) null else c
    }

    fun hasSession(): Boolean = currentCookie() != null

    /**
     * 拉课表。成功返回 GXUST-TT-1|{...} 数据包，失败返回 null。
     * 必须在后台线程调用。
     */
    fun fetchTimetable(ctx: Context?, cookie: String): String? {
        // 依次尝试候选学期，第一个「有课」的胜出（空学期会触发下一次）
        for ((xnm, xqm) in candidates(ctx)) {
            val text = post(cookie, xnm, xqm) ?: continue
            val json = try {
                JSONObject(text)
            } catch (e: Exception) {
                continue
            }
            val kb = json.optJSONArray("kbList") ?: continue
            if (kb.length() == 0) continue

            val slim = JSONArray()
            for (i in 0 until kb.length()) {
                val k = kb.optJSONObject(i) ?: continue
                slim.put(slimOf(k))
            }

            // 实践课只在有明确星期和节次时才带上，否则会造出假课
            val sjk = JSONArray()
            val sjkRaw = json.optJSONArray("sjkList")
            if (sjkRaw != null) {
                for (i in 0 until sjkRaw.length()) {
                    val k = sjkRaw.optJSONObject(i) ?: continue
                    if (k.optString("xqj").isEmpty() || k.optString("jcs").isEmpty()) continue
                    sjk.put(slimOf(k))
                }
            }

            // 记下这次成功的学期，下次优先用它
            try {
                ctx?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    ?.edit()
                    ?.putString(KEY_XNM, xnm)
                    ?.putString(KEY_XQM, xqm)
                    ?.apply()
            } catch (e: Exception) {
                // 记不住不影响本次结果
            }

            val payload = JSONObject().apply {
                put("kbList", slim)
                put("sjkList", sjk)
                put("xnm", xnm)
                put("xqm", xqm)
            }
            return "GXUST-TT-1|" + payload.toString()
        }
        return null
    }

    private fun slimOf(k: JSONObject): JSONObject = JSONObject().apply {
        put("kcmc", k.optString("kcmc"))
        put("xm", k.optString("xm"))
        put("cdmc", k.optString("cdmc"))
        put("xqj", k.optString("xqj"))
        put("jcs", k.optString("jcs"))
        put("zcd", k.optString("zcd"))
    }

    /** 单次请求，返回响应正文；失败返回 null */
    private fun post(cookie: String, xnm: String, xqm: String): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$BASE/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151").openConnection() as HttpURLConnection)
            conn.requestMethod = "POST"
            conn.connectTimeout = 12000
            conn.readTimeout = 18000
            conn.doOutput = true
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
            conn.setRequestProperty("Cookie", cookie)
            conn.setRequestProperty("X-Requested-With", "XMLHttpRequest")
            conn.setRequestProperty("Referer", "$BASE/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151")
            conn.setRequestProperty(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"
            )

            conn.outputStream.use { os ->
                os.write("xnm=$xnm&xqm=$xqm".toByteArray(Charsets.UTF_8))
            }

            if (conn.responseCode != 200) return null
            conn.inputStream.bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            null
        } finally {
            try { conn?.disconnect() } catch (e: Exception) {}
        }
    }

    /** 候选学期：上次成功的 → 按日期推算 → 同年前两个学期 → 上一学年 */
    private fun candidates(ctx: Context?): List<Pair<String, String>> {
        val out = ArrayList<Pair<String, String>>()

        fun add(a: String?, b: String?) {
            if (a.isNullOrBlank() || b.isNullOrBlank()) return
            for (p in out) if (p.first == a && p.second == b) return
            out.add(Pair(a, b))
        }

        val prefs = try {
            ctx?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        } catch (e: Exception) {
            null
        }
        add(prefs?.getString(KEY_XNM, null), prefs?.getString(KEY_XQM, null))

        val g = guessTerm()
        add(g.first, g.second)
        add(g.first, "3")
        add(g.first, "12")
        add(g.first, "16")

        val prev = (g.first.toIntOrNull() ?: 0) - 1
        if (prev > 2000) {
            add(prev.toString(), "12")
            add(prev.toString(), "3")
        }
        return out
    }

    private fun guessTerm(): Pair<String, String> {
        val cal = Calendar.getInstance()
        val m = cal.get(Calendar.MONTH) + 1
        val y = cal.get(Calendar.YEAR)
        return when {
            m >= 8 -> Pair("$y", "3")
            m == 1 -> Pair("${y - 1}", "3")
            else -> Pair("$y", "12")
        }
    }
}
