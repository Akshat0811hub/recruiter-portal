package com.orbitsales.callsync;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Tiny HTTP helper (no external libraries). */
public final class Net {
    private Net() {}

    public static final class Result {
        public final int code;
        public final String body;
        Result(int code, String body) { this.code = code; this.body = body; }
        public boolean ok() { return code >= 200 && code < 300; }
    }

    public static String enc(String s) {
        try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (Exception e) { return ""; }
    }

    public static String form(Map<String, String> fields) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : fields.entrySet()) {
            if (sb.length() > 0) sb.append('&');
            sb.append(enc(e.getKey())).append('=').append(enc(e.getValue()));
        }
        return sb.toString();
    }

    public static Result get(String url, int timeoutMs) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(timeoutMs);
        con.setReadTimeout(timeoutMs);
        return read(con);
    }

    public static Result postForm(String url, Map<String, String> fields, int timeoutMs) throws Exception {
        byte[] body = form(fields).getBytes(StandardCharsets.UTF_8);
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(timeoutMs);
        con.setReadTimeout(timeoutMs);
        con.setRequestMethod("POST");
        con.setDoOutput(true);
        con.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
        con.setFixedLengthStreamingMode(body.length);
        try (OutputStream os = con.getOutputStream()) { os.write(body); }
        return read(con);
    }

    /** Streams a raw audio file as the request body (server reads X-Filename header). */
    public static Result postStream(String url, InputStream in, long length, String mime, String filename) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(120000);
        con.setRequestMethod("POST");
        con.setDoOutput(true);
        con.setRequestProperty("Content-Type", mime == null ? "audio/mp4" : mime);
        con.setRequestProperty("X-Filename", filename);
        if (length > 0) con.setFixedLengthStreamingMode(length);
        else con.setChunkedStreamingMode(64 * 1024);
        try (OutputStream os = con.getOutputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        } finally {
            try { in.close(); } catch (Exception ignored) {}
        }
        return read(con);
    }

    private static Result read(HttpURLConnection con) throws Exception {
        int code = con.getResponseCode();
        InputStream is = code >= 400 ? con.getErrorStream() : con.getInputStream();
        String text = "";
        if (is != null) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            is.close();
            text = bos.toString("UTF-8");
        }
        con.disconnect();
        return new Result(code, text);
    }
}
