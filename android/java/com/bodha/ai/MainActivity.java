package com.bodha.ai;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * BODHA for Android.
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

    private WebView web;
    private View progressBar;
    private FrameLayout root;
    private final Handler main = new Handler(Looper.getMainLooper());

    /** Set while the page is waiting on a runtime permission decision. */
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> pendingFiles;
    private boolean offlineShown = false;

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
        enablePullToRefresh(web);

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

    /* ──────────────────────────── small helpers ──────────────────────────── */

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
            if (granted) pendingPermission.grant(pendingPermission.getResources());
            else pendingPermission.deny();
            pendingPermission = null;
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
