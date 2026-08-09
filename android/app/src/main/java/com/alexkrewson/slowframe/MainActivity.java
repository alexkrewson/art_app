package com.alexkrewson.slowframe;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * SlowFrame runs as an ambient picture frame, so the artwork gets the whole
 * panel: no status bar, no navigation bar. Alex asked for this after seeing the
 * clock and battery sitting above the image on his phone.
 *
 * Immersive *sticky* rather than plain fullscreen, so the bars can still be
 * summoned by a swipe from the edge (you need them to leave the app) and then
 * disappear again on their own, instead of permanently re-appearing the first
 * time anything touches the screen edge.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enterImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Android restores the system bars whenever focus is lost and regained
        // — a notification shade pull, a permission dialog, or switching apps
        // and coming back. Without this the frame quietly stops being
        // fullscreen after the first interruption and never recovers.
        if (hasFocus) {
            enterImmersiveMode();
        }
    }

    private void enterImmersiveMode() {
        // Draw behind the bars as well as hiding them, so the image genuinely
        // fills the panel rather than leaving a black reserved strip.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
