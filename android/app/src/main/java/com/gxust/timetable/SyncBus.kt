package com.gxust.timetable

/**
 * 同步结果在两个 Activity 之间传递。
 * 只存最后一次结果，取走即清空，不做持久化。
 */
object SyncBus {
    @Volatile
    private var payload: String? = null

    fun put(value: String) {
        payload = value
    }

    fun take(): String? {
        val v = payload
        payload = null
        return v
    }
}
