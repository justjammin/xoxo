const root = document.documentElement;
const toggle = document.querySelector(".theme-toggle");
const label = document.querySelector(".theme-label");
const themeMeta = document.querySelector('meta[name="theme-color"]');
const storedTheme = localStorage.getItem("xoxo-site-theme");

if (storedTheme === "dark") root.dataset.theme = "dark";

function syncThemeControl() {
  const dark = root.dataset.theme === "dark";
  toggle?.setAttribute("aria-pressed", String(dark));
  toggle?.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} theme`);
  if (label) label.textContent = dark ? "Day issue" : "Night issue";
  themeMeta?.setAttribute("content", dark ? "#0D0C00" : "#D9B991");
}

toggle?.addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("xoxo-site-theme", root.dataset.theme);
  syncThemeControl();
});

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget ?? "");
    if (!target) return;
    await navigator.clipboard.writeText(target.textContent ?? "");
    const prior = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = prior; }, 1400);
  });
}

syncThemeControl();
