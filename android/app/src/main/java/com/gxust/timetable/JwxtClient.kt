package com.gxust.timetable

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
    fun fetchTimetable(cookie: String): String? {
        val (xnm, xqm) = guessTerm()
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

            val text = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(text)
            val arr = json.optJSONArray("kbList") ?: return null
            if (arr.length() == 0) return null

            val slim = JSONArray()
            for (i in 0 until arr.length()) {
                val k = arr.getJSONObject(i)
                slim.put(JSONObject().apply {
                    put("kcmc", k.optString("kcmc"))
                    put("xm", k.optString("xm"))
                    put("cdmc", k.optString("cdmc"))
                    put("xqj", k.optString("xqj"))
                    put("jcs", k.optString("jcs"))
                    put("zcd", k.optString("zcd"))
                })
            }

            "GXUST-TT-1|" + JSONObject().put("kbList", slim).toString()
        } catch (e: Exception) {
            null
        } finally {
            try { conn?.disconnect() } catch (e: Exception) {}
        }
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
