package com.orbitsales.callsync;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/** Simple persistent settings + offline queue storage. */
public final class Prefs {
    private static final String FILE = "orbitsales_callsync";

    public static final String[] SALES_TEAM = {"Jinendra", "Vishal", "Rahul", "Archana"};
    public static final String DEFAULT_SERVER = "http://192.168.1.8:3000";

    private Prefs() {}

    private static SharedPreferences sp(Context c) {
        return c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public static String serverUrl(Context c) {
        String s = sp(c).getString("server_url", DEFAULT_SERVER);
        s = s == null ? DEFAULT_SERVER : s.trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        return s;
    }

    public static void setServerUrl(Context c, String v) { sp(c).edit().putString("server_url", v).apply(); }

    public static String salesName(Context c) { return sp(c).getString("sales_name", ""); }
    public static void setSalesName(Context c, String v) { sp(c).edit().putString("sales_name", v).apply(); }

    public static boolean isConfigured(Context c) { return !salesName(c).isEmpty(); }

    /** Time when the salesperson finished setup. Nothing older than this is ever uploaded. */
    public static long installedAt(Context c) { return sp(c).getLong("installed_at", 0L); }
    public static void setInstalledAt(Context c, long v) { sp(c).edit().putLong("installed_at", v).apply(); }

    public static long lastCallLogId(Context c) { return sp(c).getLong("last_calllog_id", -1L); }
    public static void setLastCallLogId(Context c, long v) { sp(c).edit().putLong("last_calllog_id", v).apply(); }

    public static String lastStatus(Context c) { return sp(c).getString("last_status", "Not started yet"); }
    public static void setLastStatus(Context c, String v) { sp(c).edit().putString("last_status", v).apply(); }

    public static int syncedCalls(Context c) { return sp(c).getInt("synced_calls", 0); }
    public static int syncedRecordings(Context c) { return sp(c).getInt("synced_recs", 0); }
    public static void incSyncedCalls(Context c) { sp(c).edit().putInt("synced_calls", syncedCalls(c) + 1).apply(); }
    public static void incSyncedRecordings(Context c) { sp(c).edit().putInt("synced_recs", syncedRecordings(c) + 1).apply(); }

    // ---- JSON helpers ----
    public static JSONArray getArray(Context c, String key) {
        try { return new JSONArray(sp(c).getString(key, "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    public static void putArray(Context c, String key, JSONArray arr) {
        sp(c).edit().putString(key, arr.toString()).apply();
    }

    public static JSONObject getObject(Context c, String key) {
        try { return new JSONObject(sp(c).getString(key, "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    public static void putObject(Context c, String key, JSONObject obj) {
        sp(c).edit().putString(key, obj.toString()).apply();
    }
}
