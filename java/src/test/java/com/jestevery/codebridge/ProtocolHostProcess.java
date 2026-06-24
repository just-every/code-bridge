package com.jestevery.codebridge;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import com.google.gson.Gson;

class ProtocolHostProcess implements AutoCloseable {
    private final Process process;
    private final BufferedReader reader;
    private final StringBuilder logBuf = new StringBuilder();
    private final Gson gson = new Gson();

    ProtocolHostProcess(int port, boolean autoPong, boolean sendControl, boolean dropPong) throws IOException, InterruptedException {
        File script = new File("src/test/resources/ProtocolHost.js");
        ProcessBuilder pb = new ProcessBuilder();
        Map<String, String> env = pb.environment();
        String node = resolveNodeCommand(env);
        pb.command(node, script.getAbsolutePath());
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

    private static String resolveNodeCommand(Map<String, String> env) throws IOException {
        // CODE_BRIDGE_NODE may point at a specific node binary for environments
        // where the Java test process does not inherit the expected PATH.
        String override = trimToNull(env.get("CODE_BRIDGE_NODE"));
        if (override != null) {
            if (isPathLike(override)) {
                File file = new File(override);
                if (file.isFile() && file.canExecute()) {
                    return file.getAbsolutePath();
                }
                throw new IOException("CODE_BRIDGE_NODE must point to an executable node binary: " + override);
            }

            String resolved = findExecutableOnPath(override, env.get("PATH"));
            if (resolved != null) {
                return resolved;
            }
            throw new IOException("CODE_BRIDGE_NODE was set but not found on PATH: " + override);
        }

        String resolved = findExecutableOnPath("node", env.get("PATH"));
        if (resolved != null) {
            return resolved;
        }
        throw new IOException("node executable not found on PATH; set CODE_BRIDGE_NODE to the node binary for Java protocol tests");
    }

    private static String findExecutableOnPath(String command, String path) {
        if (trimToNull(path) == null) {
            return null;
        }

        for (String dir : path.split(File.pathSeparator)) {
            if (dir.isBlank()) {
                continue;
            }
            for (String candidate : executableCandidates(command)) {
                File file = new File(dir, candidate);
                if (file.isFile() && file.canExecute()) {
                    return file.getAbsolutePath();
                }
            }
        }
        return null;
    }

    private static Set<String> executableCandidates(String command) {
        Set<String> candidates = new LinkedHashSet<>();
        candidates.add(command);

        String pathExt = System.getenv("PATHEXT");
        if (pathExt != null) {
            for (String extension : pathExt.split(File.pathSeparator)) {
                if (!extension.isBlank()
                        && !command.toLowerCase(Locale.ROOT).endsWith(extension.toLowerCase(Locale.ROOT))) {
                    candidates.add(command + extension);
                }
            }
        }
        return candidates;
    }

    private static boolean isPathLike(String command) {
        return new File(command).isAbsolute() || command.contains("/") || command.contains("\\");
    }

    private static String trimToNull(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        return value.trim();
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
