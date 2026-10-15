package com.workoutapp.phone;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

final class ReleaseMetadataHttp {
    private static final ExecutorService HTTP = Executors.newSingleThreadExecutor();
    private static final int LIMIT = 65536;
    interface ConnectionFactory { HttpURLConnection open(URL url) throws Exception; }

    static String fetch(String url) throws Exception {
        return fetch(url, 10000, target -> (HttpURLConnection) target.openConnection());
    }

    static String fetch(String url, int timeoutMs, ConnectionFactory connections) throws Exception {
        AtomicReference<HttpURLConnection> active = new AtomicReference<>();
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        Future<String> future = HTTP.submit(() -> read(url, deadline, active, connections));
        try { return future.get(timeoutMs, TimeUnit.MILLISECONDS); }
        finally {
            future.cancel(true);
            HttpURLConnection connection = active.getAndSet(null);
            if (connection != null) connection.disconnect();
        }
    }

    private static String read(String initial, long deadline, AtomicReference<HttpURLConnection> active, ConnectionFactory connections) throws Exception {
        URL url = new URL(initial);
        for (int redirect = 0; redirect <= 3; redirect++) {
            if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443) || !("github.com".equals(url.getHost()) ||
                    "release-assets.githubusercontent.com".equals(url.getHost()) || "objects.githubusercontent.com".equals(url.getHost())))
                throw new java.io.IOException("untrusted_redirect");
            int remaining = (int) TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
            if (remaining <= 0 || Thread.currentThread().isInterrupted()) throw new TimeoutException();
            HttpURLConnection connection = connections.open(url);
            active.set(connection);
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(remaining);
            connection.setReadTimeout(remaining);
            connection.setRequestProperty("Accept", "application/json");
            try {
                int code = connection.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new java.io.IOException("missing_redirect");
                    url = new URL(url, location);
                    continue;
                }
                if (code != 200 || connection.getContentLengthLong() > LIMIT) throw new java.io.IOException("invalid_response");
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (System.nanoTime() > deadline || Thread.currentThread().isInterrupted()) throw new TimeoutException();
                        if (output.size() + count > LIMIT) throw new java.io.IOException("response_too_large");
                        output.write(buffer, 0, count);
                    }
                    return output.toString(StandardCharsets.UTF_8.name());
                }
            } finally { connection.disconnect(); active.compareAndSet(connection, null); }
        }
        throw new java.io.IOException("too_many_redirects");
    }
}
