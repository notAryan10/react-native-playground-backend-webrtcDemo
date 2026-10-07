package expo.modules.rnptouch

import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.InputDevice
import android.view.MotionEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Turns a browser click on the streamed preview into a real touch in this
// app's own window. Dispatching to our own decor view needs no permission
// (unlike INJECT_EVENTS or an accessibility service), and it reaches the user's
// playground code exactly like a finger would. It cannot reach system UI.
class RnpTouchModule : Module() {
  private var downTime = 0L

  override fun definition() = ModuleDefinition {
    Name("RnpTouch")

    // xRatio/yRatio are fractions of the whole display, which is what
    // MediaProjection captures (getRealMetrics). Subtracting the decor view's
    // on-screen position maps them into window coordinates whether or not the
    // window is inset below the status bar.
    Function("touch") { action: String, xRatio: Double, yRatio: Double ->
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread {
        val decor = activity.window.decorView
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        activity.windowManager.defaultDisplay.getRealMetrics(metrics)
        val origin = IntArray(2)
        decor.getLocationOnScreen(origin)
        val x = (xRatio.coerceIn(0.0, 1.0) * metrics.widthPixels - origin[0]).toFloat()
        val y = (yRatio.coerceIn(0.0, 1.0) * metrics.heightPixels - origin[1]).toFloat()

        val now = SystemClock.uptimeMillis()
        val motionAction = when (action) {
          "down" -> { downTime = now; MotionEvent.ACTION_DOWN }
          "move" -> MotionEvent.ACTION_MOVE
          "up" -> MotionEvent.ACTION_UP
          else -> MotionEvent.ACTION_CANCEL
        }
        val event = MotionEvent.obtain(downTime, now, motionAction, x, y, 0)
        event.source = InputDevice.SOURCE_TOUCHSCREEN
        decor.dispatchTouchEvent(event)
        event.recycle()
      }
      true
    }
  }
}
