package com.bodha.ai;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.URLUtil;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * BODHA for Android 1.1.
 *
 * The app is the same BODHA the browser gets — one codebase, one place to fix a
 * bug — hosted in a WebView that behaves like a first-class Android app rather
 * than a page in a frame. Everything the wrapper adds is here, and there is no
 * third-party library in it:
 *
 *   · the microphone, for dictation and Live Mode (runtime permission, granted
 *     to the page only while it is actually asking)
 *   · file choosing, so a book or a PDF can be uploaded from the phone
 *   · the back gesture/button walks the history instead of closing the app
 *   · links that leave BODHA open in the phone's own browser
 *   · a plain, honest offline screen with a retry, instead of Chrome's dinosaur
 *   · pull down at the top of a page to reload it
 *   · the status and navigation bars matched to BODHA's paper and ink
 */

public class MainActivity extends Activity {

    /** Where BODHA lives. One string to change if the app ever moves domain. */
    private static final String HOME = "https://bodha-ai-three.vercel.app";
    private static final String HOME_HOST = "bodha-ai-three.vercel.app";
    private static final String OFFLINE_PAGE = "file:///android_asset/offline.html";

    private static final int REQUEST_MIC = 4101;
    private static final int REQUEST_FILE = 4102;
    private static final int REQUEST_SAVE = 4103;

    private WebView web;
    private View progressBar;
    private FrameLayout root;
    private final Handler main = new Handler(Looper.getMainLooper());

    /** Set while the page is waiting on a runtime permission decision. */
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> pendingFiles;
    private boolean offlineShown = false;

    /** Set only on Android 9 and older, where writing to Downloads needs a grant. */
    private String[] pendingSave;

    /**
     * How BODHA works, split on purpose.
     *
     * The heavy work — models, retrieval, OCR, the code sandbox, building a PDF or
     * a spreadsheet — happens on the server, where it belongs. The phone keeps the
     * shell, the microphone, the file picker and the screen, and its only job in a
     * download is to move bytes into Downloads. Nothing is rendered or converted
     * here, and nothing is kept in memory after a save.
     */

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        paintSystemBars();

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFFFAF7F2); // the app's paper, so no white flash

        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // A hairline progress bar in the app's accent, drawn over the page.
        progressBar = new View(this);
        progressBar.setBackgroundColor(0xFFC1633B);
        FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(0, dp(2));
        barParams.gravity = android.view.Gravity.TOP;
        root.addView(progressBar, barParams);

        setContentView(root);
        configureWebView(web);
        // Pull-to-refresh is intentionally off: BODHA scrolls inside the page, so a
        // downward swipe anywhere (scrolling back up a chat) used to reload it.

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
            if (web.getUrl() == null) web.loadUrl(HOME);
        } else {
            web.loadUrl(HOME);
        }
    }

    /* ─────────────────────────── the system bars ──────────────────────────── */

    /**
     * BODHA is a warm paper app, so the bars take the paper colour with dark
     * icons — rather than a black band above a cream page.
     */
    private void paintSystemBars() {
        setBarColors(0xFFFAF7F2, true);
    }

    /**
     * Matches the system bars to the colour of the page underneath them.
     *
     * BODHA has its own Paper and Night theme, chosen in Settings and stored in
     * the page — not the phone's. Painting the bars cream while the page is
     * night-dark would look like a bug, so after each page loads the app asks
     * the page what colour it actually is and dresses accordingly.
     */
    private void setBarColors(int colour, boolean darkIcons) {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(colour);
        window.setNavigationBarColor(colour);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            View decor = window.getDecorView();
            int flags = decor.getSystemUiVisibility();
            flags = darkIcons
                    ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                    : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags = darkIcons
                        ? flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                        : flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
        }
    }

    /** Reads the page's own background and dresses the bars to match it. */
    private void syncBarsToPage() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.KITKAT) return;
        try {
            web.evaluateJavascript(
                    "(function(){try{var c=getComputedStyle(document.body).backgroundColor;"
                            + "return c||'';}catch(e){return '';}})()",
                    value -> {
                        int rgb = parseCssColor(value);
                        if (rgb == 0) return;
                        // Perceived luminance decides whether the icons must be dark.
                        int r = (rgb >> 16) & 0xFF, g = (rgb >> 8) & 0xFF, b = rgb & 0xFF;
                        double luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
                        setBarColors(0xFF000000 | rgb, luminance > 0.6);
                    });
        } catch (Exception ignored) {
            // The bars simply keep the paper colour.
        }
    }

    /** "rgb(43, 39, 35)" or "#2b2723" → 0x2B2723; 0 when it cannot be read. */
    private int parseCssColor(String css) {
        if (css == null) return 0;
        String value = css.trim().replace("\"", "");
        if (value.isEmpty() || value.startsWith("rgba") && value.contains(", 0)")) return 0;
        try {
            if (value.startsWith("#")) {
                String hex = value.substring(1);
                if (hex.length() == 3) {
                    hex = "" + hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1)
                            + hex.charAt(2) + hex.charAt(2);
                }
                return (int) Long.parseLong(hex, 16) & 0xFFFFFF;
            }
            if (value.startsWith("rgb")) {
                String inner = value.substring(value.indexOf('(') + 1, value.indexOf(')'));
                String[] parts = inner.split(",");
                int r = Integer.parseInt(parts[0].trim());
                int g = Integer.parseInt(parts[1].trim());
                int b = Integer.parseInt(parts[2].trim());
                return ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
            }
        } catch (Exception ignored) {
            // fall through
        }
        return 0;
    }

    /* ──────────────────────────── the WebView ────────────────────────────── */

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);      // chat drafts and the theme live here
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);                 // respect the student's system font size
        settings.setMediaPlaybackRequiresUserGesture(false); // read-aloud may start on its own
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        // The site decides its own light/dark; the browser must not second-guess it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            settings.setAlgorithmicDarkeningAllowed(false);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        view.setBackgroundColor(0xFFFAF7F2);
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);

        web.setWebViewClient(new BodhaWebViewClient());
        web.setWebChromeClient(new BodhaChromeClient());
        web.setDownloadListener(new BodhaDownloadListener());
        web.addJavascriptInterface(new Bridge(), "BodhaNative");
        // The theme is a page-level choice, so the bars are re-checked whenever
        // the WebView stops scrolling — cheap, and it keeps the chrome in step.
        web.setOnScrollChangeListener((v, x, y, oldX, oldY) -> {
            if (Math.abs(y - oldY) > 0) syncBarsToPage();
        });
    }

    private final class BodhaWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String scheme = url.getScheme() == null ? "" : url.getScheme();
            String host = url.getHost() == null ? "" : url.getHost();
            // Anything that is not a web page (the offline asset, a mailto:, an
            // intent:) never belongs in the WebView.
            if (!scheme.equals("http") && !scheme.equals("https")) {
                return false;
            }
            // BODHA's own pages stay in the app; everything else — a Project
            // Gutenberg text, an archive.org scan, a source link — opens where
            // it belongs, in the phone's browser.
            if (host.equals(HOME_HOST)) return false;
            openExternally(url);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            if (!OFFLINE_PAGE.equals(url)) offlineShown = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progressBar.setVisibility(View.GONE);
            syncBarsToPage();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            // Only the main document matters here; a single failed image must not
            // take over the screen.
            if (!request.isForMainFrame()) return;
            showOffline();
        }
    }

    private final class BodhaChromeClient extends WebChromeClient {

        @Override
        public void onProgressChanged(WebView view, int progress) {
            ViewGroup.LayoutParams params = progressBar.getLayoutParams();
            int width = (int) (root.getWidth() * (progress / 100f));
            params.width = Math.max(progress == 0 ? 0 : dp(10), width);
            progressBar.setLayoutParams(params);
            if (progress == 100) progressBar.setVisibility(View.GONE);
            else progressBar.setVisibility(View.VISIBLE);
        }

        /**
         * The microphone. BODHA asks for it when a student taps dictate or
         * opens Live Mode; Android's own dialog decides, and the page only
         * receives the stream if the answer was yes.
         */
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            main.post(() -> {
                // BODHA only ever wants the microphone. A page asking for the
                // camera as well is asking for something this app does not do,
                // so the whole request is declined rather than half-answered.
                boolean audioOnly = true;
                for (String resource : request.getResources()) {
                    if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audioOnly = false;
                }
                if (!audioOnly) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(request.getResources());
                    return;
                }
                // A second request while one is open would strand the first.
                if (pendingPermission != null) pendingPermission.deny();
                pendingPermission = request;
                requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQUEST_MIC);
            });
        }

        /** Choosing a book, a PDF or notes to upload. */
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            String[] accepted = params.getAcceptTypes();
            if (accepted != null && accepted.length > 0 && accepted[0] != null && accepted[0].contains("/")) {
                intent.setType(accepted[0]);
            }
            try {
                startActivityForResult(Intent.createChooser(intent, "Choose a file"), REQUEST_FILE);
            } catch (ActivityNotFoundException err) {
                pendingFiles = null;
                Toast.makeText(MainActivity.this, "No file manager found on this phone.", Toast.LENGTH_SHORT).show();
                return false;
            }
            return true;
        }
    }

    /**
     * Saving a file.
     *
     * The heavy work of producing a file — a sandbox result, an exported page —
     * happens on the server; the phone's only job is to put it in Downloads.
     * Android's DownloadManager does that, with the system's own progress
     * notification, so nothing is held in memory here.
     */
    private final class BodhaDownloadListener implements DownloadListener {
        @Override
        public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                    String mimeType, long contentLength) {
            // A file the page built in memory has no address to fetch, so it is
            // read back from the page and handed to the same save path.
            if (url != null && url.startsWith("blob:")) {
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                if (name == null || name.isEmpty() || "downloadfile.bin".equals(name) || !name.contains(".")) {
                    name = "bodha-" + System.currentTimeMillis() + extensionFor(mimeType);
                }
                saveBlob(url, name, mimeType);
                return;
            }
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);
                request.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setTitle(name);
                request.setDescription("Saving from BODHA");
                request.allowScanningByMediaScanner();
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                if (manager == null) throw new IllegalStateException("no download manager");
                manager.enqueue(request);
                Toast.makeText(MainActivity.this, "Saving to Downloads", Toast.LENGTH_SHORT).show();
            } catch (Exception err) {
                // No download manager, or the URL is not http(s): hand it to the browser.
                try {
                    openExternally(Uri.parse(url));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "That file could not be saved.", Toast.LENGTH_SHORT).show();
                }
            }
        }
    }

    /**
     * Reads a blob: URL back out of the page and saves it.
     *
     * The page already holds the bytes (a finished document from BODHA's computer),
     * so this costs one copy and no network at all.
     */
    private void saveBlob(String blobUrl, String name, String mime) {
        String js = "(function(){fetch(" + quote(blobUrl) + ").then(function(r){return r.arrayBuffer();})"
                + ".then(function(b){var v=new Uint8Array(b),s='',c=0x8000;"
                + "for(var i=0;i<v.length;i+=c){s+=String.fromCharCode.apply(null,v.subarray(i,i+c));}"
                + "window.BodhaNative.saveFile(" + quote(name) + "," + quote(mime == null ? "" : mime) + ",btoa(s));})"
                + ".catch(function(){window.BodhaNative.saveFailed();});})()";
        web.evaluateJavascript(js, null);
    }

    /** A JavaScript string literal for the injected snippet. */
    private static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c == '\n') out.append("\\n");
            else if (c == '\r') out.append("\\r");
            else if (c < 0x20) out.append(' ');
            else out.append(c);
        }
        return out.append('"').toString();
    }

    private static String extensionFor(String mime) {
        if (mime == null) return ".bin";
        String type = mime.toLowerCase();
        if (type.contains("pdf")) return ".pdf";
        if (type.contains("wordprocessingml") || type.contains("msword")) return ".docx";
        if (type.contains("spreadsheetml") || type.contains("ms-excel")) return ".xlsx";
        if (type.contains("presentationml") || type.contains("powerpoint")) return ".pptx";
        if (type.contains("zip")) return ".zip";
        if (type.contains("json")) return ".json";
        if (type.contains("csv")) return ".csv";
        if (type.contains("html")) return ".html";
        if (type.contains("markdown")) return ".md";
        if (type.startsWith("text/")) return ".txt";
        if (type.contains("png")) return ".png";
        if (type.contains("jpeg") || type.contains("jpg")) return ".jpg";
        return ".bin";
    }

    /** Writes bytes into the phone's Downloads, on any Android this app runs on. */
    private void writeToDownloads(String name, String mime, byte[] bytes) throws Exception {
        String type = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, type);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (target == null) throw new IllegalStateException("Downloads is not writable");
            try (OutputStream out = getContentResolver().openOutputStream(target)) {
                if (out == null) throw new IllegalStateException("Downloads is not writable");
                out.write(bytes);
            } catch (Exception err) {
                getContentResolver().delete(target, null, null);
                throw err;
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(target, values, null, null);
            return;
        }
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) throw new IllegalStateException("no Downloads folder");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Downloads is not writable");
        File file = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
    }

    /* ──────────────────────────── small helpers ──────────────────────────── */

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private void openExternally(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException err) {
            Toast.makeText(this, "Nothing on this phone can open that link.", Toast.LENGTH_SHORT).show();
        }
    }

    private void showOffline() {
        if (offlineShown) return;
        offlineShown = true;
        progressBar.setVisibility(View.GONE);
        web.loadUrl(OFFLINE_PAGE);
    }

    private int dp(int value) {
        return Math.round(getResources().getDisplayMetrics().density * value);
    }

    /** Pull down from the top of a page to reload it. */
    @SuppressLint("ClickableViewAccessibility")
    private void enablePullToRefresh(final WebView view) {
        view.setOnTouchListener(new View.OnTouchListener() {
            private float startY = 0;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        startY = event.getY();
                        break;
                    case MotionEvent.ACTION_UP:
                        float pull = event.getY() - startY;
                        if (view.getScrollY() == 0 && pull > dp(120)) {
                            offlineShown = false;
                            view.reload();
                            return true;
                        }
                        break;
                    default:
                        break;
                }
                return false;
            }
        });
    }

    /** The one hook the offline page needs. */
    private class Bridge {
        /**
         * Saves a file the page has already built. Called by BODHA's computer when
         * a document is finished — the bytes are produced on the server, so the
         * phone only has to put them in Downloads.
         */
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String base64) {
            if (base64 == null || base64.isEmpty()) return;
            byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException err) {
                toast("That file could not be read.");
                return;
            }
            final String fileName = (name == null || name.trim().isEmpty()) ? "bodha-file" : name.trim();
            main.post(() -> {
                if (Build.VERSION.SDK_INT < 29
                        && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                        != PackageManager.PERMISSION_GRANTED) {
                    // The old way of writing to Downloads needs a grant; ask, then finish.
                    pendingSave = new String[] { fileName, mime, base64 };
                    requestPermissions(
                            new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, REQUEST_SAVE);
                    return;
                }
                try {
                    writeToDownloads(fileName, mime, bytes);
                    toast("Saved to Downloads: " + fileName);
                } catch (Exception err) {
                    toast("That file could not be saved.");
                }
            });
        }

        /** The page could not read its own file back; say so instead of failing silently. */
        @JavascriptInterface
        public void saveFailed() {
            main.post(() -> toast("That file could not be saved."));
        }

        @JavascriptInterface
        public void retry() {
            main.post(() -> {
                offlineShown = false;
                web.loadUrl(HOME);
            });
        }
    }

    /* ─────────────────────────────── lifecycle ───────────────────────────── */

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE) {
            if (pendingFiles != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        result = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            result[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data.getData() != null) {
                        result = new Uri[] { data.getData() };
                    }
                }
                pendingFiles.onReceiveValue(result);
                pendingFiles = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQUEST_MIC && pendingPermission != null) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                pendingPermission.grant(pendingPermission.getResources());
            } else {
                pendingPermission.deny();
                Toast.makeText(this,
                        "BODHA needs the microphone for dictation. You can allow it in Settings › Apps › BODHA › Permissions.",
                        Toast.LENGTH_LONG).show();
            }
            pendingPermission = null;
            return;
        }
        if (requestCode == REQUEST_SAVE) {
            String[] save = pendingSave;
            pendingSave = null;
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (save == null) return;
            if (!granted) {
                toast("BODHA needs storage access to save files. You can allow it in Settings › Apps › BODHA › Permissions.");
                return;
            }
            try {
                writeToDownloads(save[0], save[1], Base64.decode(save[2], Base64.DEFAULT));
                toast("Saved to Downloads: " + save[0]);
            } catch (Exception err) {
                toast("That file could not be saved.");
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Back walks BODHA's history, and only leaves the app from the start page.
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }
}
