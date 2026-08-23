export async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { response, text };
}

export async function requestJson(url, options = {}) {
  const result = await request(url, options);
  let payload;
  try { payload = JSON.parse(result.text); }
  catch (_) { throw new Error("Сервер вернул повреждённый JSON"); }
  if (payload.ok === false) throw new Error(payload.error || payload.output || "Операция отклонена");
  return payload;
}

export async function send(fields) {
  return requestJson("/cgi-bin/remna-profile", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields)
  });
}
