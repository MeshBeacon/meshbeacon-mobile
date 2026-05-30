/**
 * ToastContext
 *
 * Provides two helpers for in-app feedback:
 *   showToast  — auto-dismissing slide-up notification
 *   showConfirm — styled modal confirmation dialog (replaces Alert with buttons)
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = "success" | "error" | "warning" | "info";

interface ToastEntry {
  id: number;
  message: string;
  variant: ToastVariant;
  anim: Animated.Value;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
  showConfirm: (opts: ConfirmOptions) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  showConfirm: () => {},
});

// ── Variant styles ────────────────────────────────────────────────────────────

const VARIANT_COLORS: Record<ToastVariant, { bg: string; icon: string }> = {
  success: { bg: "#16a34a", icon: "✓" },
  error: { bg: "#dc2626", icon: "✕" },
  warning: { bg: "#d97706", icon: "!" },
  info: { bg: "#2563eb", icon: "i" },
};

// ── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { bottom } = useSafeAreaInsets();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const idRef = useRef(0);

  // Track keyboard height so toasts can be shifted above the keyboard.
  // The toast stack renders in a Modal which is NOT affected by adjustResize,
  // so we always need the raw keyboard height on both iOS and Android.
  // iOS fires keyboardWillShow/Hide (smoother); Android uses keyboardDidShow/Hide.
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = (e: { endCoordinates: { height: number } }) =>
      setKeyboardHeight(e.endCoordinates.height);
    const onHide = () => setKeyboardHeight(0);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  // ── Toast ──────────────────────────────────────────────────────────────────

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = ++idRef.current;
      const anim = new Animated.Value(0);

      setToasts((prev) => [...prev, { id, message, variant, anim }]);

      // Slide in
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();

      // Auto-dismiss after 3 s
      setTimeout(() => {
        Animated.timing(anim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }).start(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        });
      }, 3000);
    },
    [],
  );

  // ── Confirm dialog ────────────────────────────────────────────────────────

  const showConfirm = useCallback((opts: ConfirmOptions) => {
    setConfirm(opts);
  }, []);

  const handleConfirm = () => {
    confirm?.onConfirm();
    setConfirm(null);
  };

  const handleCancel = () => {
    confirm?.onCancel?.();
    setConfirm(null);
  };

  return (
    <ToastContext.Provider value={{ showToast, showConfirm }}>
      {children}

      {/* ── Confirm Dialog ── */}
      <Modal
        visible={!!confirm}
        transparent
        animationType="fade"
        onRequestClose={handleCancel}
      >
        <Pressable style={styles.overlay} onPress={handleCancel}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>{confirm?.title}</Text>
            <Text style={styles.dialogMessage}>{confirm?.message}</Text>
            <View style={styles.dialogButtons}>
              <Pressable style={styles.cancelBtn} onPress={handleCancel}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.confirmBtn,
                  confirm?.destructive && styles.confirmBtnDestructive,
                ]}
                onPress={handleConfirm}
              >
                <Text style={styles.confirmBtnText}>
                  {confirm?.confirmText ?? "OK"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Toast Stack ─────────────────────────────────────────────────────
           Rendered inside a transparent Modal so it is guaranteed to appear
           above the keyboard and all other UI on both iOS and Android.
           The Modal is only mounted while toasts are visible (≤ 3 s), so
           the brief touch-interception window is acceptable.
      ── */}
      <Modal
        visible={toasts.length > 0}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={styles.toastWrapper} pointerEvents="box-none">
          <View
            style={[
              styles.toastContainer,
              {
                bottom:
                  keyboardHeight > 0
                    ? keyboardHeight + 12
                    : Math.max(bottom + 16, 32),
              },
            ]}
            pointerEvents="none"
          >
            {toasts.map((toast) => {
              const { bg, icon } = VARIANT_COLORS[toast.variant];
              const translateY = toast.anim.interpolate({
                inputRange: [0, 1],
                outputRange: [80, 0],
              });
              const opacity = toast.anim;
              return (
                <Animated.View
                  key={toast.id}
                  style={[
                    styles.toast,
                    {
                      backgroundColor: bg,
                      transform: [{ translateY }],
                      opacity,
                    },
                  ]}
                >
                  <View style={styles.toastIcon}>
                    <Text style={styles.toastIconText}>{icon}</Text>
                  </View>
                  <Text style={styles.toastMessage} numberOfLines={3}>
                    {toast.message}
                  </Text>
                </Animated.View>
              );
            })}
          </View>
        </View>
      </Modal>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Confirm dialog
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  dialog: {
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
    width: "100%",
    maxWidth: 340,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#181411",
    marginBottom: 8,
  },
  dialogMessage: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
    marginBottom: 20,
  },
  dialogButtons: {
    flexDirection: "row",
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6b7280",
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: "#f27f0d",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  confirmBtnDestructive: {
    backgroundColor: "#dc2626",
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  // Toast
  toastWrapper: {
    flex: 1,
  },
  toastContainer: {
    position: "absolute",
    left: 16,
    right: 16,
    gap: 8,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  toastIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  toastIconText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },
  toastMessage: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
});
