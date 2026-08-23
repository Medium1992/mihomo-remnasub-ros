// Бэкенд отдаёт все свободные строки в base64, чтобы не экранировать их в
// собранном вручную JSON. Здесь единственная точка обратного преобразования.
export function decode(value) {
  if (!value) return "";
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (_) {
    return "";
  }
}
