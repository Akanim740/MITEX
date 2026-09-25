const token = new URLSearchParams(location.search).get("token");

if (!token) {
  document.getElementById("onboardMode").classList.add("hidden");
  document.getElementById("invalidMode").classList.remove("hidden");
}

function fail(msg) {
  const el = document.getElementById("obError");
  el.textContent = msg;
  el.classList.remove("hidden");
}

document.getElementById("onboardForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = document.getElementById("obPass").value;
  const pass2 = document.getElementById("obPass2").value;

  if (pass !== pass2) return fail("Passwords do not match");
  if (pass.length < 8 || !/[A-Za-z]/.test(pass) || !/[0-9]/.test(pass)) {
    return fail("Password must be at least 8 characters and include letters and numbers");
  }

  const btn = document.getElementById("obBtn");
  btn.disabled = true;
  btn.textContent = "Setting up...";
  try {
    const res = await fetch("/api/auth/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: pass }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not set up your account");
    document.getElementById("onboardMode").classList.add("hidden");
    document.getElementById("doneMode").classList.remove("hidden");
  } catch (err) {
    fail(err.message);
    btn.disabled = false;
    btn.textContent = "Create My Work Account";
  }
});