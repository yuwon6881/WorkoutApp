package com.workoutapp.phone;

import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class ReleaseMetadataHttpTest {
    private static class Connection extends HttpURLConnection {
        byte[] body = "{}".getBytes();
        int response = 200;
        String redirect;
        boolean disconnected;
        boolean block;
        Connection(URL url) { super(url); }
        @Override public void connect() { }
        @Override public boolean usingProxy() { return false; }
        @Override public void disconnect() { disconnected = true; }
        @Override public long getContentLengthLong() { return -1; }
        @Override public int getResponseCode() throws IOException {
            if (block) try { Thread.sleep(30000); } catch (InterruptedException failure) { throw new IOException("cancelled"); }
            return response;
        }
        @Override public String getHeaderField(String name) { return redirect; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(body); }
    }
    @Test public void rejectsOversizedBodiesEvenWithoutAContentLength() throws Exception {
        Connection connection = new Connection(new URL("https://github.com/test"));
        connection.body = new byte[65537];
        assertThrows(Exception.class, () -> ReleaseMetadataHttp.fetch(connection.getURL().toString(), 2000, url -> connection));
        assertTrue(connection.disconnected);
    }
    @Test public void redirectsStayOnHttpsGitHubAssetHostsAndAreBounded() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        assertThrows(Exception.class, () -> ReleaseMetadataHttp.fetch("https://github.com/test", 2000, url -> {
            calls.incrementAndGet();
            Connection connection = new Connection(url);
            connection.response = 302;
            connection.redirect = "https://evil.example/manifest";
            return connection;
        }));
        assertEquals(1, calls.get());
        calls.set(0);
        assertThrows(Exception.class, () -> ReleaseMetadataHttp.fetch("https://github.com/test", 2000, url -> {
            calls.incrementAndGet();
            Connection connection = new Connection(url);
            connection.response = 302;
            connection.redirect = "https://github.com/loop";
            return connection;
        }));
        assertEquals(4, calls.get());
    }
    @Test public void totalDeadlineCancelsAndDisconnectsAStalledRequest() throws Exception {
        Connection connection = new Connection(new URL("https://github.com/test"));
        connection.block = true;
        long start = System.nanoTime();
        assertThrows(Exception.class, () -> ReleaseMetadataHttp.fetch(connection.getURL().toString(), 50, url -> connection));
        assertTrue((System.nanoTime() - start) / 1000000 < 2000);
        assertTrue(connection.disconnected);
    }
}
