const ROUTER_ENDPOINT = "http://localhost:25128/api/oauth/gemini-web/import-token";

document.getElementById("syncBtn").addEventListener("click", async () => {
  const btn = document.getElementById("syncBtn");
  const statusBox = document.getElementById("statusBox");
  btn.disabled = true;
  btn.innerText = "Membaca cookies...";
  statusBox.className = "status";
  statusBox.style.display = "none";

  try {
    const cookiesDomain = await chrome.cookies.getAll({ domain: "google.com" });
    const cookiesUrl = await chrome.cookies.getAll({ url: "https://gemini.google.com" });

    const allCookies = [...cookiesDomain, ...cookiesUrl];
    const cookiePairs = [];
    const seen = new Set();
    let hasPsid = false;

    for (const c of allCookies) {
      if (c && c.name && c.value && !seen.has(c.name)) {
        seen.add(c.name);
        cookiePairs.push(`${c.name}=${c.value}`);
        if (c.name === "__Secure-1PSID") hasPsid = true;
      }
    }

    if (!hasPsid) {
      throw new Error(
        "Cookie __Secure-1PSID tidak ditemukan. Silakan login ke https://gemini.google.com terlebih dahulu."
      );
    }

    const fullCookieString = cookiePairs.join("; ");

    btn.innerText = "Menghubungkan ke router...";

    const res = await fetch(ROUTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookies: fullCookieString,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    statusBox.className = "status success";
    statusBox.innerHTML = `
      <strong>Berhasil Tersinkron!</strong>
      <div class="cookie-info">Akun: ${data.connection?.name || "Gemini Web"}</div>
      <div class="cookie-info">Total Akun di Router: ${data.totalConnections || 1}</div>
    `;
    btn.innerText = "✓ Berhasil Tersinkron";
  } catch (err) {
    statusBox.className = "status error";
    statusBox.innerText = `Gagal: ${err.message}`;
    btn.disabled = false;
    btn.innerText = "⚡ Coba Lagi";
  }
});
