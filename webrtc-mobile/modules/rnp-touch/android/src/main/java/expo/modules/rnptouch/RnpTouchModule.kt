package expo.modules.rnptouch

import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
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

    // Tap-to-source for release builds, which lack the React DevTools hook the
    // JS inspector needs. The bundler stamps each JSX element's nativeID with
    // "rnp:<file:line:col>"; find the topmost view under the point carrying one.
    // Returns null when nothing tagged is there.
    AsyncFunction("hitTest") { xRatio: Double, yRatio: Double ->
      val activity = appContext.currentActivity ?: return@AsyncFunction null
      val result = java.util.concurrent.FutureTask<Map<String, Any>?> {
        val decor = activity.window.decorView
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        activity.windowManager.defaultDisplay.getRealMetrics(metrics)
        val sx = (xRatio.coerceIn(0.0, 1.0) * metrics.widthPixels).toInt()
        val sy = (yRatio.coerceIn(0.0, 1.0) * metrics.heightPixels).toInt()
        val hit = findTagged(decor, sx, sy) ?: return@FutureTask null
        val (view, nativeId) = hit
        val loc = IntArray(2)
        view.getLocationOnScreen(loc)
        val origin = IntArray(2)
        decor.getLocationOnScreen(origin)
        val d = metrics.density
        mapOf(
          "nativeID" to nativeId,
          "viewClass" to view.javaClass.simpleName,
          "frame" to mapOf(
            "left" to (loc[0] - origin[0]) / d,
            "top" to (loc[1] - origin[1]) / d,
            "width" to view.width / d,
            "height" to view.height / d,
          ),
        )
      }
      activity.runOnUiThread(result)
      result.get(2, java.util.concurrent.TimeUnit.SECONDS)
    }
  }

  // Depth-first, children in reverse draw order (topmost first). A tagged
  // descendant beats a tagged ancestor, so the deepest element wins.
  private fun findTagged(view: View, sx: Int, sy: Int): Pair<View, String>? {
    if (view.visibility != View.VISIBLE) return null
    val loc = IntArray(2)
    view.getLocationOnScreen(loc)
    if (sx < loc[0] || sy < loc[1] || sx >= loc[0] + view.width || sy >= loc[1] + view.height) return null
    if (view is ViewGroup) {
      for (i in view.childCount - 1 downTo 0) {
        findTagged(view.getChildAt(i), sx, sy)?.let { return it }
      }
    }
    // Same tag RN's ReactFindViewUtil.getNativeId reads (private there).
    val id = view.getTag(com.facebook.react.R.id.view_tag_native_id) as? String
    return if (id != null && id.startsWith("rnp:")) view to id.removePrefix("rnp:") else null
  }
}
