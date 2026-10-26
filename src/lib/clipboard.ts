export async function copyText(text: string): Promise<void> {
  if (!text.trim()) throw new Error("There is no text to copy.");

  const secureContext = window.isSecureContext;
  if (typeof navigator !== "undefined" && secureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.style.pointerEvents = "none";
  document.body.appendChild(field);
  try {
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
    if (!document.execCommand("copy")) {
      if (!secureContext) {
        throw new Error("Clipboard access requires HTTPS or localhost. This page is using an insecure HTTP address; open it at http://localhost:3000 on this device or serve it over HTTPS.");
      }
      throw new Error("The browser rejected the copy command.");
    }
  } finally {
    field.remove();
  }
}
