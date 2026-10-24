package com.starwish.music;

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;

/**
 * 规格书 v2.8 · 1.12 播放缓存（移动端原生实现）。
 *
 * 在线歌曲播放时把音频流落盘到 cacheDir/swaudio，再次播放直接本地读取（不再请求远端）；
 * 上限 50 首 / 500MB，超出按最旧访问时间清理；「清除缓存」只清这里，不动已下载文件。
 */
final class SwAudioCache {
    private static final int MAX_FILES = 50;
    private static final long MAX_BYTES = 500L * 1024 * 1024;
    private static final long MAX_ONE = 60L * 1024 * 1024;

    private SwAudioCache() {}

    static File dir(Context ctx) {
        File d = new File(ctx.getCacheDir(), "swaudio");
        if (!d.exists()) {
            //noinspection ResultOfMethodCallIgnored
            d.mkdirs();
        }
        return d;
    }

    static String keyOf(String url) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] out = md.digest(url.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : out) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(url.hashCode());
        }
    }

    static boolean isAudioMime(String mime) {
        return mime != null && mime.toLowerCase().startsWith("audio/");
    }

    /** 命中缓存则返回文件（并刷新访问时间，作为 LRU 依据） */
    static File hit(Context ctx, String url) {
        try {
            File[] list = dir(ctx).listFiles();
            if (list == null) return null;
            String key = keyOf(url);
            for (File f : list) {
                if (f.isFile() && f.getName().startsWith(key) && !f.getName().endsWith(".part")) {
                    //noinspection ResultOfMethodCallIgnored
                    f.setLastModified(System.currentTimeMillis());
                    return f;
                }
            }
        } catch (Exception ignore) {
        }
        return null;
    }

    /**
     * 把远端流包一层「边播边写」：读完后落盘。任何异常都只影响缓存，不影响播放。
     */
    static InputStream tee(Context ctx, String url, InputStream raw) {
        try {
            File dir = dir(ctx);
            String key = keyOf(url);
            File part = new File(dir, key + ".part");
            File done = new File(dir, key + ".audio");
            return new TeeStream(raw, part, done, ctx);
        } catch (Exception e) {
            return raw;
        }
    }

    private static final class TeeStream extends FilterInputStream {
        private final File part;
        private final File done;
        private final Context ctx;
        private FileOutputStream out;
        private long written = 0;
        private boolean closed = false;

        TeeStream(InputStream in, File part, File done, Context ctx) throws IOException {
            super(in);
            this.part = part;
            this.done = done;
            this.ctx = ctx;
            this.out = new FileOutputStream(part, false);
        }

        @Override
        public int read() throws IOException {
            int b = super.read();
            if (b >= 0) write(new byte[]{(byte) b}, 0, 1);
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            int n = super.read(buf, off, len);
            if (n > 0) write(buf, off, n);
            return n;
        }

        private void write(byte[] buf, int off, int len) {
            if (out == null) return;
            if (written + len > MAX_ONE) { // 单曲过大不缓存，避免把内存/磁盘撑爆
                closeQuietly();
                return;
            }
            try {
                out.write(buf, off, len);
                written += len;
            } catch (Exception e) {
                closeQuietly();
            }
        }

        private void closeQuietly() {
            try {
                if (out != null) out.close();
            } catch (Exception ignore) {
            }
            out = null;
            //noinspection ResultOfMethodCallIgnored
            part.delete();
        }

        @Override
        public void close() throws IOException {
            if (!closed) {
                closed = true;
                try {
                    super.close();
                } finally {
                    try {
                        if (out != null) out.flush();
                        if (out != null) out.close();
                        if (written > 0) {
                            //noinspection ResultOfMethodCallIgnored
                            done.delete();
                            //noinspection ResultOfMethodCallIgnored
                            part.renameTo(done);
                            prune(ctx);
                        } else {
                            //noinspection ResultOfMethodCallIgnored
                            part.delete();
                        }
                    } catch (Exception ignore) {
                    }
                }
            }
        }
    }

    static void prune(Context ctx) {
        try {
            File[] list = dir(ctx).listFiles();
            if (list == null) return;
            Arrays.sort(list, Comparator.comparingLong(File::lastModified));
            long bytes = 0;
            for (File f : list) if (f.isFile()) bytes += f.length();
            int count = list.length;
            for (File f : list) {
                if (count <= MAX_FILES && bytes <= MAX_BYTES) break;
                if (!f.isFile()) continue;
                long len = f.length();
                //noinspection ResultOfMethodCallIgnored
                if (f.delete()) {
                    bytes -= len;
                    count--;
                }
            }
        } catch (Exception ignore) {
        }
    }

    /** 返回 {文件数, 字节数} */
    static long[] info(Context ctx) {
        long files = 0;
        long bytes = 0;
        try {
            File[] list = dir(ctx).listFiles();
            if (list != null) {
                for (File f : list) {
                    if (f.isFile()) {
                        files++;
                        bytes += f.length();
                    }
                }
            }
        } catch (Exception ignore) {
        }
        return new long[]{files, bytes};
    }

    static void clear(Context ctx) {
        try {
            File[] list = dir(ctx).listFiles();
            if (list == null) return;
            for (File f : list) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        } catch (Exception ignore) {
        }
    }

    /** 本地缓存文件读取（支持 Range） */
    static InputStream open(File f, String range, long[] meta) throws IOException {
        long size = f.length();
        long start = 0;
        long end = size - 1;
        if (range != null && range.startsWith("bytes=")) {
            String spec = range.substring(6);
            String[] parts = spec.split("-", -1);
            try {
                if (!parts[0].isEmpty()) start = Long.parseLong(parts[0]);
                if (parts.length > 1 && !parts[1].isEmpty()) end = Math.min(Long.parseLong(parts[1]), size - 1);
            } catch (Exception ignore) {
            }
        }
        if (start < 0) start = 0;
        if (end >= size) end = size - 1;
        long len = Math.max(0, end - start + 1);
        FileInputStream in = new FileInputStream(f);
        long skipped = 0;
        while (skipped < start) {
            long s = in.skip(start - skipped);
            if (s <= 0) break;
            skipped += s;
        }
        meta[0] = start;
        meta[1] = len;
        meta[2] = size;
        return new BoundedStream(in, len);
    }

    private static final class BoundedStream extends FilterInputStream {
        private long left;

        BoundedStream(InputStream in, long limit) {
            super(in);
            this.left = limit;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(buf, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
    }
}
