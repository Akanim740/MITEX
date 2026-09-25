const params = new URLSearchParams(location.search);
const token = params.get("token");

const dobInput = document.getElementById("apDob");
if (dobInput) dobInput.max = new Date().toISOString().split("T")[0];

function show(mode) {
  ["applyMode", "receivedMode", "statusMode"].forEach((id) =>
    document.getElementById(id).classList.toggle("hidden", id !== mode)
  );
}

function fail(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.remove("hidden");
}

if (token) {
  show("statusMode");
  fetch(`/api/applications/status/${encodeURIComponent(token)}`)
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Application not found");
      document.getElementById("stName").textContent = data.name;
      document.getElementById("stEmail").textContent = data.email;
      const chip = document.getElementById("stChip");
      chip.className = `status-chip status-${data.status}`;
      chip.textContent = data.status.replace("_", " ");
      const note = document.getElementById("stStatusNote");
      if (data.status === "new") note.textContent = "We are reviewing your application. You will hear from us soon.";
      else if (data.status === "test_sent") note.textContent = "You have a test waiting. Read the brief below.";
      else if (data.status === "submitted") {
        note.textContent = "";
        document.getElementById("alreadySubmitted").classList.remove("hidden");
      } else if (data.status === "passed") note.textContent = "Congratulations - check your email for your welcome link!";
      if (data.status === "submitted") document.getElementById("payBox").classList.remove("hidden");
      if ((data.status === "test_sent" || data.status === "submitted") && data.test_instructions) {
        document.getElementById("briefBox").classList.remove("hidden");
        document.getElementById("briefText").textContent = data.test_instructions;
        if (data.submit_url) document.getElementById("subUrl").value = data.submit_url;
        if (data.status === "submitted") {
          document.getElementById("submitTestForm").classList.add("hidden");
          document.getElementById("submitBtn").disabled = true;
        }
      }
    })
    .catch((err) => {
      show("applyMode");
      fail("applyError", err.message);
      document.getElementById("applyForm").classList.add("hidden");
    });
}

document.getElementById("applyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("applyBtn");
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("apName").value,
        email: document.getElementById("apEmail").value,
        phone: document.getElementById("apPhone").value,
        portfolio: document.getElementById("apPortfolio").value,
        message: document.getElementById("apMessage").value,
        dob: document.getElementById("apDob").value,
        ninBvn: document.getElementById("apNin").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not send application");
    localStorage.setItem("mitex_audience", "worker");
    show("receivedMode");
  } catch (err) {
    fail("applyError", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Application";
  }
});

document.getElementById("submitTestForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  btn.textContent = "Submitting...";
  try {
    const res = await fetch("/api/applications/submit-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        url: document.getElementById("subUrl").value,
        notes: document.getElementById("subNotes").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Submission failed");
    location.reload();
  } catch (err) {
    fail("submitMsg", err.message);
    btn.disabled = false;
    btn.textContent = "Submit My Test";
  }
});
document.getElementById("bankForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("bankBtn");
  const number = document.getElementById("bkNumber").value.trim();
  if (!/^\d{6,17}$/.test(number)) {
    fail("bankMsg", "Account number must be digits only (10 digits for Nigerian banks).");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    const res = await fetch("/api/applications/bank-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        accountName: document.getElementById("bkName").value,
        bankName: document.getElementById("bkBank").value,
        accountNumber: number,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save payment details");
    document.getElementById("bankForm").classList.add("hidden");
    document.getElementById("bankSavedNote").classList.remove("hidden");
  } catch (err) {
    fail("bankMsg", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Payment Details";
  }
});