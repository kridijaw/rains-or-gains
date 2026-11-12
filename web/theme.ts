export type ThemeChoice = "auto" | "light" | "dark";

const KEY = "theme";
const ORDER: ThemeChoice[] = ["auto", "light", "dark"];
const systemDark = matchMedia("(prefers-color-scheme: dark)");

// Keep in sync with the inline script in index.html, which applies the stored choice before first paint.
function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

function save(choice: ThemeChoice): void {
  try {
    if (choice === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage can be blocked; the choice then lasts until reload.
  }
}

function apply(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = choice === "auto" ? (systemDark.matches ? "dark" : "light") : choice;
}

/** Wires the header button that cycles auto, light and dark. `onChange` runs after the palette switched. */
export function themeToggle(button: HTMLButtonElement, onChange: () => void): void {
  let choice = stored();
  const show = () => {
    button.dataset.choice = choice;
    const label = `Theme: ${choice}`;
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  apply(choice);
  show();
  button.addEventListener("click", () => {
    choice = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
    save(choice);
    apply(choice);
    show();
    onChange();
  });
  systemDark.addEventListener("change", () => {
    if (choice !== "auto") return;
    apply(choice);
    onChange();
  });
}
