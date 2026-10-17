package com.alsabiha.manpower;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/**
 * Thin, hardened WebView shell around the AL SABIHA web app.
 * - Loads only the configured HTTPS server; any other link opens in the external browser.
 * - No JavaScript bridge (addJavascriptInterface is never used).
 * - File/content access disabled, mixed content blocked, backups disabled.
 * - Camera/location are granted to the web page ONLY for the configured origin.
 * - No credentials are stored in the app; login happens on the server's own pages.
 */
public class MainActivity extends Activity {
    private static final int REQ_PERMS = 41;

    private WebView web;
    private ProgressBar bar;
    private LinearLayout errorBox;
    private TextView errorText;
    private final String baseUrl = BuildConfig.BASE_URL;
    private final String baseHost = Uri.parse(BuildConfig.BASE_URL).getHost();

    private PermissionRequest pendingWebPermission;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0B1F3A"));

        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(bar, new FrameLayout.LayoutParams(-1, 8, Gravity.TOP));

        errorBox = new LinearLayout(this);
        errorBox.setOrientation(LinearLayout.VERTICAL);
        errorBox.setGravity(Gravity.CENTER);
        errorBox.setBackgroundColor(Color.WHITE);
        errorBox.setPadding(48, 48, 48, 48);
        errorText = new TextView(this);
        errorText.setTextSize(16);
        errorText.setTextColor(Color.parseColor("#17263A"));
        errorText.setGravity(Gravity.CENTER);
        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setOnClickListener(v -> loadStart());
        errorBox.addView(errorText, new LinearLayout.LayoutParams(-2, -2));
        errorBox.addView(retry, new LinearLayout.LayoutParams(-2, -2));
        errorBox.setVisibility(View.GONE);
        root.addView(errorBox, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setGeolocationEnabled(true);
        s.setSaveFormData(false);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("https".equals(u.getScheme()) && u.getHost() != null && u.getHost().equals(baseHost)) return false;
                if ("http".equals(u.getScheme()) && BuildConfig.DEBUG && "10.0.2.2".equals(u.getHost())) return false;
                if ("https".equals(u.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                }
                return true; // never navigate the shell to foreign/unsafe URLs
            }
            @Override public void onPageFinished(WebView v, String url) { bar.setVisibility(View.GONE); }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) showError(online()
                        ? "The server could not be reached. Please try again in a moment."
                        : "No internet connection. Check your network and try again.");
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) {
                bar.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
                bar.setProgress(p);
            }
            @Override public void onPermissionRequest(PermissionRequest req) {
                Uri o = req.getOrigin();
                boolean trusted = o != null && baseHost != null && baseHost.equals(o.getHost());
                boolean wantsCamera = false;
                for (String r : req.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
                if (!trusted || !wantsCamera) { req.deny(); return; }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    req.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    pendingWebPermission = req;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_PERMS);
                }
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                Uri o = Uri.parse(origin);
                boolean trusted = baseHost != null && baseHost.equals(o.getHost());
                if (!trusted) { cb.invoke(origin, false, false); return; }
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    cb.invoke(origin, true, false);
                } else {
                    pendingGeoCallback = cb; pendingGeoOrigin = origin;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMS + 1);
                }
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState); else loadStart();
    }

    private void loadStart() {
        errorBox.setVisibility(View.GONE);
        if (!online()) { showError("No internet connection. Check your network and try again."); return; }
        web.loadUrl(baseUrl + BuildConfig.START_PATH);
    }

    private void showError(String m) { errorText.setText(m + "\n"); errorBox.setVisibility(View.VISIBLE); bar.setVisibility(View.GONE); }

    private boolean online() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        Network n = cm == null ? null : cm.getActiveNetwork();
        NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
        if (code == REQ_PERMS && pendingWebPermission != null) {
            if (ok) pendingWebPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); else pendingWebPermission.deny();
            pendingWebPermission = null;
        } else if (code == REQ_PERMS + 1 && pendingGeoCallback != null) {
            pendingGeoCallback.invoke(pendingGeoOrigin, ok, false);
            pendingGeoCallback = null;
        }
    }

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onDestroy() { if (web != null) { ((ViewGroup) web.getParent()).removeView(web); web.destroy(); } super.onDestroy(); }
}
