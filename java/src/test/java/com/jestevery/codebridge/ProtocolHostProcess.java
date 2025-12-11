package com.jestevery.codebridge;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import com.google.gson.Gson;

class ProtocolHostProcess implements AutoCloseable {
    private final Process process;
    private final BufferedReader reader;
    private final StringBuilder logBuf = new StringBuilder();
    private final Gson gson = new Gson();

    ProtocolHostProcess(int port, boolean autoPong, boolean sendControl, boolean dropPong) throws IOException, InterruptedException {
        File script = new File("src/test/resources/ProtocolHost.js");
        String node = "/usr/local/bin/node";
        ProcessBuilder pb = new ProcessBuilder(node, script.getAbsolutePath());
        Map<String, String> env = pb.environment();
        env.put("PATH", System.getenv("PATH"));
        env.put("PORT", Integer.toString(port));
        env.put("SECRET", "dev-secret");
        env.put("AUTO_PONG", autoPong ? "true" : "false");
        env.put("SEND_CONTROL", sendControl ? "true" : "false");
        env.put("DROP_PONG", dropPong ? "true" : "false");
        pb.redirectErrorStream(true);
        this.process = pb.start();
        this.reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
        // wait for listening line or fail, while capturing logs
        long start = System.currentTimeMillis();
        String line = null;
        while (System.currentTimeMillis() - start < 3000) {
            while (reader.ready()) {
                String ln = reader.readLine();
                logBuf.append(ln).append("\n");
                if (ln.contains("listening")) {
                    line = ln;
                }
            }
            if (line != null) break;
            Thread.sleep(50);
        }
        if (line == null) {
            throw new IOException("Protocol host failed to start; logs:\n" + logBuf);
        }
    }

    List<Map<String, Object>> readEvents(long timeoutMs) throws IOException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        List<Map<String, Object>> events = new ArrayList<>();
        while (System.currentTimeMillis() < deadline) {
            while (reader.ready()) {
                String line = reader.readLine();
                logBuf.append(line).append("\n");
                if (line == null) return events;
                Map<String, Object> obj = gson.fromJson(line, Map.class);
                events.add(obj);
            }
            try { Thread.sleep(50); } catch (InterruptedException ignored) {}
        }
        return events;
    }

    @Override
    public void close() {
        if (process != null) {
            process.destroy();
            try { process.waitFor(1, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
            process.destroyForcibly();
        }
    }

    String logs() {
        return logBuf.toString();
    }
}
