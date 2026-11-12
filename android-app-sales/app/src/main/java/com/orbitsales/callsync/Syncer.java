package com.orbitsales.callsync;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.CallLog;
import android.provider.MediaStore;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Core zero-touch sync engine:
 *  1. Reads every new entry of the phone's Call Log (incoming / outgoing / missed / not picked)
 *     and sends it to the CRM with exact start time, end time and duration.
 *  2. Finds the call-recording file created by the phone's built-in recorder, matches it to
 *     the right call, and uploads it automatically.
 *  3. Keeps an offline queue so nothing is lost when Wi-Fi / internet is down.
 */
public final class Syncer {
    private static final String TAG = "OrbitCallSync";
    private static final Object LOCK = new Object();
    private static final Pattern PHONE_IN_NAME = Pattern.compile("(?:\\+?91)?([6-9]\\d{9})");

    private static final String Q_CALLS = "call_queue";
    private static final String RECENT_CALLS = "recent_calls";
    private static final String UPLOADED = "uploaded_recs";
    private static final String SIZE_SEEN = "rec_size_seen";

    private static final String[] RECORDING_DIRS = {
            "Recordings", "Recordings/Call", "Recordings/Call recordings", "Call", "Record", "Recorder",
            "MIUI/sound_recorder", "MIUI/sound_recorder/call_rec", "Sounds/CallRecord", "Music/Recordings",
            "Music/Call Recordings", "PhoneRecord", "CallRecordings", "Call Recordings", "CallRecord",
            "Sounds", "Voice Recorder", "Android/media/com.samsung.android.app.memo"
    };

    private Syncer() {}

    // ------------------------------------------------------------------ setup

    /** Called once when the salesperson taps "Save & Start". Old calls before this are ignored. */
    public static void initBaseline(Context c) {
        if (Prefs.installedAt(c) == 0L) Prefs.setInstalledAt(c, System.currentTimeMillis());
        if (Prefs.lastCallLogId(c) < 0) Prefs.setLastCallLogId(c, maxCallLogId(c));
    }

    private static long maxCallLogId(Context c) {
        try (Cursor cur = c.getContentResolver().query(CallLog.Calls.CONTENT_URI,
                new String[]{CallLog.Calls._ID}, null, null, CallLog.Calls._ID + " DESC")) {
            if (cur != null && cur.moveToFirst()) return cur.getLong(0);
        } catch (SecurityException se) {
            Log.w(TAG, "No call log permission yet");
        } catch (Exception e) {
            Log.w(TAG, "maxCallLogId", e);
        }
        return 0L;
    }

    // ------------------------------------------------------------- full pass

    public static void runFullSync(Context c) {
        if (!Prefs.isConfigured(c)) return;
        synchronized (LOCK) {
            try { collectNewCalls(c); } catch (Exception e) { Log.w(TAG, "collectNewCalls", e); }
            try { flushCallQueue(c); } catch (Exception e) { Log.w(TAG, "flushCallQueue", e); }
            try { syncRecordings(c); } catch (Exception e) { Log.w(TAG, "syncRecordings", e); }
        }
    }

    // ------------------------------------------------------------ call log

    private static String fmt(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date(ms));
    }

    private static void collectNewCalls(Context c) {
        initBaseline(c);
        long lastId = Prefs.lastCallLogId(c);
        String[] proj = {CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE,
                CallLog.Calls.DURATION, CallLog.Calls.CACHED_NAME};
        JSONArray queue = Prefs.getArray(c, Q_CALLS);
        long maxSeen = lastId;
        String me = Prefs.salesName(c);

        try (Cursor cur = c.getContentResolver().query(CallLog.Calls.CONTENT_URI, proj,
                CallLog.Calls._ID + " > ?", new String[]{String.valueOf(lastId)}, CallLog.Calls._ID + " ASC")) {
            if (cur == null) return;
            while (cur.moveToNext()) {
                long id = cur.getLong(0);
                String number = cur.getString(1);
                int type = cur.getInt(2);
                long start = cur.getLong(3);
                long dur = cur.getLong(4);
                String name = cur.getString(5);
                maxSeen = Math.max(maxSeen, id);
                if (number == null || number.replaceAll("[^0-9]", "").length() < 7) continue;
                if (start < Prefs.installedAt(c) - 60000L) continue;

                String direction;
                switch (type) {
                    case CallLog.Calls.INCOMING_TYPE: direction = dur > 0 ? "incoming" : "missed"; break;
                    case CallLog.Calls.OUTGOING_TYPE: direction = dur > 0 ? "outgoing" : "unanswered"; break;
                    case CallLog.Calls.MISSED_TYPE: direction = "missed"; break;
                    case 5 /* REJECTED_TYPE */: direction = "missed"; break;
                    default: continue; // voicemail, blocked, etc.
                }
                long end = start + dur * 1000L;
                String key = me + "-" + id + "-" + start;

                JSONObject item = new JSONObject();
                JSONObject f = new JSONObject();
                f.put("sales_person", me);
                f.put("client_phone", number);
                f.put("client_name", name == null ? "" : name);
                f.put("call_direction", direction);
                f.put("call_duration_seconds", String.valueOf(dur));
                f.put("call_start_time", fmt(start));
                f.put("call_end_time", fmt(end));
                f.put("device_call_key", key);
                f.put("source_app", "android-callsync");
                if (direction.equals("missed")) f.put("notes", "Missed call — callback needed");
                if (direction.equals("unanswered")) f.put("notes", "Call kari thi par client ne phone nahi uthaya");
                item.put("key", key);
                item.put("fields", f);
                item.put("phone", number);
                item.put("start", start);
                item.put("end", end);
                item.put("dur", dur);
                queue.put(item);
            }
        } catch (SecurityException se) {
            Prefs.setLastStatus(c, "Call log permission missing — open app and allow permissions");
            return;
        } catch (Exception e) {
            Log.w(TAG, "collect", e);
        }
        Prefs.putArray(c, Q_CALLS, queue);
        Prefs.setLastCallLogId(c, maxSeen);
    }

    private static void flushCallQueue(Context c) throws Exception {
        JSONArray queue = Prefs.getArray(c, Q_CALLS);
        if (queue.length() == 0) return;
        JSONArray remaining = new JSONArray();
        JSONArray recent = Prefs.getArray(c, RECENT_CALLS);
        boolean failed = false;

        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.getJSONObject(i);
            if (failed) { remaining.put(item); continue; }
            try {
                Map<String, String> fields = new LinkedHashMap<>();
                JSONObject f = item.getJSONObject("fields");
                Iterator<String> it = f.keys();
                while (it.hasNext()) { String k = it.next(); fields.put(k, f.optString(k)); }
                Net.Result r = Net.postForm(Prefs.serverUrl(c) + "/api/calls/log", fields, 10000);
                if (r.ok()) {
                    String callId = "";
                    try { callId = new JSONObject(r.body).getJSONObject("callLog").optString("id"); } catch (Exception ignored) {}
                    item.put("callId", callId);
                    recent.put(item);
                    Prefs.incSyncedCalls(c);
                    Prefs.setLastStatus(c, "✅ Call synced " + fmt(System.currentTimeMillis()) + " (" + f.optString("call_direction") + " " + f.optString("client_phone") + ")");
                } else if (r.code >= 400 && r.code < 500) {
                    Log.w(TAG, "Server rejected call: " + r.body); // drop bad record
                } else {
                    failed = true; remaining.put(item);
                }
            } catch (Exception e) {
                failed = true; remaining.put(item);
                Prefs.setLastStatus(c, "⏳ CRM server not reachable — " + queue.length() + " call(s) waiting, will auto-retry");
            }
        }
        // keep only last 80 calls for recording matching
        JSONArray trimmed = new JSONArray();
        for (int i = Math.max(0, recent.length() - 80); i < recent.length(); i++) trimmed.put(recent.get(i));
        Prefs.putArray(c, RECENT_CALLS, trimmed);
        Prefs.putArray(c, Q_CALLS, remaining);
    }

    // ---------------------------------------------------------- recordings

    private static final class Candidate {
        String key, name, pathHint, mime;
        long modifiedMs, addedMs, size;
        Uri uri;
        File file;

        InputStream open(ContentResolver cr) throws Exception {
            if (uri != null) return cr.openInputStream(uri);
            return new FileInputStream(file);
        }
    }

    private static boolean looksLikeCallRecording(String pathHint, String name) {
        String p = (pathHint + "/" + name).toLowerCase(Locale.US);
        if (p.contains("call")) return true;
        if (p.contains("whatsapp")) return false;
        String n = name.toLowerCase(Locale.US);
        return PHONE_IN_NAME.matcher(n.replaceAll("[\\s-]", "")).find() && (p.contains("rec") || p.contains("sound"));
    }

    private static List<Candidate> findCandidates(Context c) {
        List<Candidate> out = new ArrayList<>();
        Map<String, Boolean> seen = new LinkedHashMap<>();
        long since = Prefs.installedAt(c) - 120000L;

        // A) MediaStore (works with normal "Music and audio" permission)
        try {
            Uri base = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            List<String> proj = new ArrayList<>();
            proj.add(MediaStore.Audio.Media._ID);
            proj.add(MediaStore.Audio.Media.DISPLAY_NAME);
            proj.add(MediaStore.Audio.Media.SIZE);
            proj.add(MediaStore.Audio.Media.DATE_ADDED);
            proj.add(MediaStore.Audio.Media.DATE_MODIFIED);
            proj.add(MediaStore.Audio.Media.MIME_TYPE);
            proj.add(MediaStore.Audio.Media.DATA);
            if (Build.VERSION.SDK_INT >= 29) proj.add(MediaStore.Audio.Media.RELATIVE_PATH);
            try (Cursor cur = c.getContentResolver().query(base, proj.toArray(new String[0]),
                    MediaStore.Audio.Media.DATE_ADDED + " >= ?", new String[]{String.valueOf(since / 1000L)},
                    MediaStore.Audio.Media.DATE_ADDED + " DESC")) {
                if (cur != null) {
                    while (cur.moveToNext()) {
                        Candidate cd = new Candidate();
                        long id = cur.getLong(0);
                        cd.name = cur.getString(1) == null ? "recording.m4a" : cur.getString(1);
                        cd.size = cur.getLong(2);
                        cd.addedMs = cur.getLong(3) * 1000L;
                        cd.modifiedMs = cur.getLong(4) * 1000L;
                        cd.mime = cur.getString(5);
                        String data = cur.getString(6);
                        String rel = Build.VERSION.SDK_INT >= 29 ? cur.getString(7) : "";
                        cd.pathHint = (data != null ? data : "") + "/" + (rel != null ? rel : "");
                        cd.uri = ContentUris.withAppendedId(base, id);
                        cd.key = cd.name.toLowerCase(Locale.US) + "|" + cd.size;
                        if (!looksLikeCallRecording(cd.pathHint, cd.name)) continue;
                        if (seen.containsKey(cd.key)) continue;
                        seen.put(cd.key, true);
                        out.add(cd);
                    }
                }
            }
        } catch (SecurityException se) {
            Log.w(TAG, "No audio permission");
        } catch (Exception e) {
            Log.w(TAG, "mediastore", e);
        }

        // B) Direct folder scan (needs "All files access"; catches recorders not indexed by MediaStore)
        boolean canScan = Build.VERSION.SDK_INT >= 30 ? Environment.isExternalStorageManager() : true;
        if (canScan) {
            File root = Environment.getExternalStorageDirectory();
            for (String rel : RECORDING_DIRS) {
                scanDir(new File(root, rel), 0, since, out, seen);
            }
        }
        return out;
    }

    private static void scanDir(File dir, int depth, long since, List<Candidate> out, Map<String, Boolean> seen) {
        if (dir == null || depth > 4 || !dir.isDirectory()) return;
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isDirectory()) { scanDir(f, depth + 1, since, out, seen); continue; }
            String n = f.getName().toLowerCase(Locale.US);
            if (!(n.endsWith(".m4a") || n.endsWith(".mp3") || n.endsWith(".amr") || n.endsWith(".aac")
                    || n.endsWith(".wav") || n.endsWith(".ogg") || n.endsWith(".3gp") || n.endsWith(".opus"))) continue;
            if (f.lastModified() < since) continue;
            if (!looksLikeCallRecording(f.getParent(), f.getName())) continue;
            Candidate cd = new Candidate();
            cd.file = f;
            cd.name = f.getName();
            cd.size = f.length();
            cd.modifiedMs = f.lastModified();
            cd.addedMs = f.lastModified();
            cd.pathHint = f.getParent();
            cd.key = n + "|" + cd.size;
            if (seen.containsKey(cd.key)) continue;
            seen.put(cd.key, true);
            out.add(cd);
        }
    }

    private static String mimeFor(String name, String fallback) {
        String n = name.toLowerCase(Locale.US);
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".amr")) return "audio/amr";
        if (n.endsWith(".aac")) return "audio/aac";
        if (n.endsWith(".wav")) return "audio/wav";
        if (n.endsWith(".ogg") || n.endsWith(".opus")) return "audio/ogg";
        if (n.endsWith(".3gp")) return "audio/3gpp";
        return fallback != null && fallback.startsWith("audio/") ? fallback : "audio/mp4";
    }

    private static String phoneFromName(String name) {
        Matcher m = PHONE_IN_NAME.matcher(name.replaceAll("[\\s()-]", ""));
        return m.find() ? m.group(1) : "";
    }

    private static String last10(String p) {
        String d = p == null ? "" : p.replaceAll("[^0-9]", "");
        return d.length() >= 10 ? d.substring(d.length() - 10) : d;
    }

    private static void syncRecordings(Context c) throws Exception {
        List<Candidate> cands = findCandidates(c);
        if (cands.isEmpty()) return;
        JSONObject uploaded = Prefs.getObject(c, UPLOADED);
        JSONObject sizeSeen = Prefs.getObject(c, SIZE_SEEN);
        JSONArray recent = Prefs.getArray(c, RECENT_CALLS);
        long now = System.currentTimeMillis();

        for (Candidate cd : cands) {
            if (uploaded.has(cd.key)) continue;

            // Wait until the recorder has finished writing (size stable between two passes, and > 5s old)
            long prevSize = sizeSeen.optLong(cd.name, -1);
            sizeSeen.put(cd.name, cd.size);
            if (prevSize != cd.size || now - cd.modifiedMs < 5000 || cd.size < 1000) continue;

            // Match recording -> call
            String filePhone = phoneFromName(cd.name);
            JSONObject best = null;
            long bestScore = Long.MAX_VALUE;
            for (int i = recent.length() - 1; i >= 0; i--) {
                JSONObject call = recent.getJSONObject(i);
                if (call.optLong("dur") <= 0) continue;
                if (call.optBoolean("hasRecording")) continue;
                long start = call.optLong("start"), end = call.optLong("end");
                boolean phoneMatch = !filePhone.isEmpty() && last10(call.optString("phone")).equals(last10(filePhone));
                long diff = Math.min(Math.abs(cd.modifiedMs - end), Math.abs(cd.addedMs - start));
                if (diff > 10 * 60 * 1000L && !phoneMatch) continue;
                long score = phoneMatch ? diff / 10 : diff;
                if (score < bestScore) { bestScore = score; best = call; }
            }

            // No call matched yet: maybe call log not synced. Wait up to 3 minutes before uploading unmatched.
            if (best == null && now - cd.modifiedMs < 3 * 60 * 1000L) continue;

            String phone = best != null ? best.optString("phone") : filePhone;
            StringBuilder url = new StringBuilder(Prefs.serverUrl(c)).append("/api/calls/recording?sales_person=")
                    .append(Net.enc(Prefs.salesName(c))).append("&phone=").append(Net.enc(phone));
            if (best != null) {
                url.append("&call_id=").append(Net.enc(best.optString("callId")))
                        .append("&device_call_key=").append(Net.enc(best.optString("key")));
            }
            try {
                Net.Result r = Net.postStream(url.toString(), cd.open(c.getContentResolver()), cd.size,
                        mimeFor(cd.name, cd.mime), cd.name);
                if (r.ok()) {
                    uploaded.put(cd.key, now);
                    if (best != null) best.put("hasRecording", true);
                    Prefs.incSyncedRecordings(c);
                    Prefs.setLastStatus(c, "🎙️ Recording uploaded " + fmt(now) + " (" + cd.name + ")");
                } else {
                    Log.w(TAG, "Upload failed " + r.code + " " + r.body);
                }
            } catch (Exception e) {
                Prefs.setLastStatus(c, "⏳ Recording waiting for CRM server — will auto-retry");
                break; // network down: try again next pass
            }
        }
        // trim the uploaded map (keep newest 500)
        if (uploaded.length() > 500) {
            JSONObject t = new JSONObject();
            Iterator<String> it = uploaded.keys();
            int skip = uploaded.length() - 500;
            while (it.hasNext()) { String k = it.next(); if (skip-- > 0) continue; t.put(k, uploaded.get(k)); }
            uploaded = t;
        }
        if (sizeSeen.length() > 300) sizeSeen = new JSONObject();
        Prefs.putObject(c, UPLOADED, uploaded);
        Prefs.putObject(c, SIZE_SEEN, sizeSeen);
        Prefs.putArray(c, RECENT_CALLS, recent);
    }

    // ------------------------------------------------------- live banner

    public static void sendLiveEvent(Context c, String event, String direction, String phone) {
        if (!Prefs.isConfigured(c)) return;
        try {
            Map<String, String> f = new LinkedHashMap<>();
            f.put("event", event);
            f.put("sales_person", Prefs.salesName(c));
            if (direction != null) f.put("direction", direction);
            if (phone != null) f.put("phone", phone);
            if ("ended".equals(event)) f.put("skip_log", "1");
            Net.postForm(Prefs.serverUrl(c) + "/api/calls/live", f, 4000);
        } catch (Exception ignored) {}
    }

    public static String testConnection(Context c) {
        try {
            Net.Result r = Net.get(Prefs.serverUrl(c) + "/api/ping", 5000);
            if (r.ok() && r.body.contains("Sales-CRM")) return "✅ Connected to CRM server";
            return "⚠️ Server replied but not the CRM (" + r.code + ")";
        } catch (Exception e) {
            return "❌ Cannot reach " + Prefs.serverUrl(c) + " — same Wi-Fi par ho? (" + e.getClass().getSimpleName() + ")";
        }
    }
}
