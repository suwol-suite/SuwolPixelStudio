let port = null;
const endpoint = document.querySelector("#endpoint");
const generate = document.querySelector("#generate");
const crash = document.querySelector("#crash");
const status = document.querySelector("#status");
const documentInfo = document.querySelector("#document");

window.addEventListener("message", (event) => {
  if (event.data?.type !== "suwol-panel:init" || !event.ports?.[0]) return;
  port = event.ports[0];
  port.onmessage = ({ data }) => {
    if (data?.type === "document") documentInfo.textContent = `${data.document.name} · ${data.document.width}×${data.document.height}`;
    if (data?.type === "complete") status.textContent = "Inserted. Use Undo to revert.";
    if (data?.type === "error") status.textContent = data.message;
  };
  port.start();
  generate.disabled = false;
  crash.disabled = false;
  status.textContent = "Ready";
}, { once: true });

generate.addEventListener("click", () => {
  if (!port) return;
  status.textContent = "Working…";
  port.postMessage({ type: "generate", endpoint: endpoint.value });
});

crash.addEventListener("click", () => {
  if (!port) return;
  status.textContent = "Triggering isolated runtime error…";
  port.postMessage({ type: "crash" });
});
