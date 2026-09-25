(async function () {
  const status = document.getElementById("status");
  const list = document.getElementById("list");
  try {
    const token = localStorage.getItem("mitex_token");
    if (!token) { status.textContent = "Not logged in"; renderEmpty("Log in to the admin dashboard first."); return; }
    const res = await fetch("/api/admin/mailbox", { headers: { Authorization: "Bearer " + token } });
    if (res.status === 401 || res.status === 403) {
      status.textContent = res.status === 403 ? "Admins only" : "Session expired";
      renderEmpty("This page is for the admin. Log in as admin@" + "mitex.store");
      return;
    }
    if (!res.ok) { status.textContent = "HTTP " + res.status; renderEmpty("Could not load the mailbox."); return; }
    const data = await res.json();
    status.textContent = data.configured ? "SMTP configured — emails now go out for real" : "SMTP off — " + data.count + " recorded";
    if (!data.mails || !data.mails.length) { renderEmpty("Nothing here yet. Emails appear here when the site generates them (signups, purchases, hires)."); return; }
    list.innerHTML = data.mails.map(m => {
      const badge = m.sent ? '<span class="badge sent">Sent</span>' : m.dev ? '<span class="badge dev">Waiting for SMTP</span>' : '<span class="badge fail">Send failed</span>';
      const links = (m.text.match(/https?:\/\/[^\s]+/g) || []);
      return `<div class="mail">
        <div class="row1">${badge}<span class="subj">${esc(m.subject)}</span></div>
        <div class="meta">${esc(m.ts || "")} · To: ${esc(m.to || "")}</div>
        <pre>${esc(m.text || "")}</pre>
        ${links.length ? `<div style="margin-top:8px;">${links.map(l => `<button class="copy" data-link="${esc(l)}">Copy link</button>`).join(" ")}</div>` : ""}
      </div>`;
    }).join("");
    list.querySelectorAll(".copy").forEach(btn => btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.link).then(() => { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy link"; }, 1500); });
    }));
  } catch (e) { status.textContent = "Error"; renderEmpty("Request failed: " + e.message); }
  function renderEmpty(msg) { list.innerHTML = `<div class="empty">${esc(msg)}</div>`; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
})();