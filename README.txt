ARTIFACT GUARDIAN — Auto-Start Setup (Cloudflare Version)
==========================================================

FILES:
  1_SETUP_SERVICES.bat   → Run ONCE as administrator to install auto-start
  2_GET_URL.bat          → Run to get your current mobile camera URL
  3_STOP_SERVICES.bat    → Stop Flask and Cloudflare
  4_START_SERVICES.bat   → Start Flask and Cloudflare manually
  5_UNINSTALL_SERVICES.bat → Remove auto-start completely

HOW TO USE:
  1. Run 1_SETUP_SERVICES.bat as administrator (first time only)
  2. Wait 10 seconds
  3. Run 2_GET_URL.bat to get your URL
  4. Open https://xxxx.trycloudflare.com/mobile-camera on phone

NOTE: Cloudflare URL changes every restart. Always run
      2_GET_URL.bat after restarting to get the new URL.

LOGS: Check the logs\ folder for troubleshooting.
