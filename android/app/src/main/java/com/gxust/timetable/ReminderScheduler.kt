package com.gxust.timetable

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray

/**
 * 把网页算好的提醒时间点，排成系统闹钟。
 * 数据同时存一份到 SharedPreferences，开机后能重新排。
 */
object ReminderScheduler {

    private const val PREFS = "gxust_prefs"
    private const val KEY = "reminders"
    private const val MAX_ALARMS = 200
    private const val ACTION = "com.gxust.timetable.REMIND"

    fun saveAndSchedule(ctx: Context, json: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, json).apply()
        schedule(ctx, json)
    }

    fun rescheduleFromCache(ctx: Context) {
        val json = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, "[]") ?: "[]"
        schedule(ctx, json)
    }

    private fun alarmIntent(ctx: Context): Intent =
        Intent(ctx, ReminderReceiver::class.java).apply { action = ACTION }

    private fun pending(ctx: Context, id: Int, title: String, body: String): PendingIntent {
        val i = alarmIntent(ctx).apply {
            putExtra("title", title)
            putExtra("body", body)
        }
        return PendingIntent.getBroadcast(
            ctx, id, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun cancelAll(ctx: Context, am: AlarmManager) {
        for (id in 0 until MAX_ALARMS) {
            val pi = PendingIntent.getBroadcast(
                ctx, id, alarmIntent(ctx),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pi != null) {
                am.cancel(pi)
                pi.cancel()
            }
        }
    }

    private fun schedule(ctx: Context, json: String) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        cancelAll(ctx, am)

        val arr = try {
            JSONArray(json)
        } catch (e: Exception) {
            return
        }

        val now = System.currentTimeMillis()
        var slot = 0

        for (i in 0 until arr.length()) {
            if (slot >= MAX_ALARMS) break
            val o = arr.optJSONObject(i) ?: continue
            val at = o.optLong("at", 0L)
            if (at <= now + 2000) continue

            val title = o.optString("title", "上课提醒")
            val body = o.optString("body", "")
            val pi = pending(ctx, slot, title, body)

            try {
                val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
                if (exact) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                }
            } catch (e: SecurityException) {
                try {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                } catch (e2: Exception) {
                    // 放弃这一条
                }
            }
            slot++
        }
    }
}
