function initCookieConsent() {
  if (localStorage.getItem("mitex_cookie_consent")) return;
  const banner = document.createElement("div");
  banner.id = "cookieConsent";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Cookie consent");
  banner.innerHTML = `
    <div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#111827;border-top:1px solid #1f2937;padding:16px 20px;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;font-family:Inter,sans-serif;">
      <p style="color:#d1d5db;font-size:0.85rem;margin:0;max-width:600px;">We use a session cookie to keep you signed in. No advertising or tracking cookies are used. By continuing to use MITEX, you agree to our <a href="/privacy.html" style="color:#fbbf24;">Privacy Policy</a>.</p>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button type="button" id="cookieAccept" style="background:#fbbf24;color:#070b14;border:none;border-radius:8px;padding:8px 18px;font-weight:600;font-size:0.85rem;cursor:pointer;">Accept</button>
        <button type="button" id="cookieDismiss" style="background:transparent;color:#9ca3af;border:1px solid #374151;border-radius:8px;padding:8px 14px;font-size:0.85rem;cursor:pointer;">Dismiss</button>
      </div>
    </div>`;
  document.body.appendChild(banner);

  function dismiss() {
    localStorage.setItem("mitex_cookie_consent", "true");
    banner.remove();
  }
  document.getElementById("cookieAccept").addEventListener("click", dismiss);
  document.getElementById("cookieDismiss").addEventListener("click", dismiss);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCookieConsent);
} else {
  initCookieConsent();
}
