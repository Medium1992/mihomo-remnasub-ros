// Проверка оверрайдов без сохранения: CGI ставит сборку в очередь воркера,
// здесь — ожидание результата и окно с выводом mihomo -t и итоговым YAML.
import { $ } from "./dom.js";
import { decode } from "./codec.js";
import { request, requestJson } from "./api.js";
import { renderYamlViewer } from "./yaml.js";

let checkToken = "";
let checkOutput = "";
let checkYaml = "";

function setState(kind, message, footer = "") {
  $("check-state").className = `check-state ${kind}`;
  $("check-message").textContent = message;
  $("check-footer").textContent = footer;
}

function showOutput() {
  $("check-viewer").textContent = checkOutput || "mihomo -t ничего не вывел.";
  $("check-toggle-yaml").textContent = "Итоговый YAML";
  $("check-viewer").dataset.view = "output";
}

export function closeCheck() {
  checkToken = "";
  $("check-modal").classList.add("hidden");
}

export async function toggleCheckYaml() {
  const viewer = $("check-viewer");
  if (viewer.dataset.view === "yaml") { showOutput(); return; }
  if (!checkYaml) {
    const result = await request(`/cgi-bin/remna-check?token=${encodeURIComponent(checkToken)}&yaml=1`);
    checkYaml = result.text || "Итоговый YAML уже удалён — запустите проверку ещё раз.";
  }
  renderYamlViewer("check-viewer", checkYaml);
  viewer.dataset.view = "yaml";
  viewer.scrollTop = 0;
  $("check-toggle-yaml").textContent = "Вывод проверки";
}

// fields — поля формы для remna-check: scope, profile_id и оверрайды.
export async function runCheck(fields, title) {
  checkOutput = "";
  checkYaml = "";
  $("check-title").textContent = title;
  $("check-toggle-yaml").classList.add("hidden");
  $("check-viewer").textContent = "";
  setState("pending", "Проверка поставлена в очередь...", "Сборка идёт тем же конвейером, что и рабочий конфиг");
  $("check-modal").classList.remove("hidden");
  const started = await requestJson("/cgi-bin/remna-check", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields)
  }).catch((error) => {
    setState("error", error.message);
    throw error;
  });
  const token = started.token;
  checkToken = token;
  const deadline = Date.now() + 120000;
  while (checkToken === token) {
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    if (checkToken !== token) return;
    const result = await requestJson(`/cgi-bin/remna-check?token=${encodeURIComponent(token)}`);
    if (checkToken !== token) return;
    if (result.state === "queued" || result.state === "running") {
      setState("pending", result.state === "queued" ? "Ждёт своей очереди у воркера..." : "Mihomo проверяет конфигурацию...");
      if (Date.now() > deadline) { setState("error", "Проверка не завершилась за две минуты"); return; }
      continue;
    }
    checkOutput = decode(result.validation_b64);
    const message = decode(result.message_b64);
    if (result.state === "ok") {
      setState("ok", message || "Конфигурация принята Mihomo", "Ничего не сохранено: чтобы применить, нажмите «Сохранить»");
      $("check-toggle-yaml").classList.remove("hidden");
    } else {
      setState("error", message || "Конфигурация отклонена", "Рабочий конфиг не тронут");
    }
    showOutput();
    return;
  }
}
