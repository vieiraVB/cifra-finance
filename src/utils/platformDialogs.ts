import { Alert, Platform } from "react-native";

export function showMessage(title: string, message: string, onDismiss?: () => void) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\\n\\n${message}`);
    onDismiss?.();
    return;
  }
  if (onDismiss) Alert.alert(title, message, [{ text: "OK", onPress: onDismiss }]);
  else Alert.alert(title, message);
}

export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void | Promise<void>,
) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`${title}\\n\\n${message}`)) {
      void onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancelar", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: () => { void onConfirm(); } },
  ]);
}

export function downloadBlob(bytes: BlobPart, filename: string, mimeType: string) {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Download não disponível neste ambiente.");
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
