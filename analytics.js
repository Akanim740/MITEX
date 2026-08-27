const GA_ID = "G-XXXXXXXXXX";
if (GA_ID && GA_ID !== "G-XXXXXXXXXX") {
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  gtag("js", new Date());
  gtag("config", GA_ID, { anonymize_ip: true });
}
