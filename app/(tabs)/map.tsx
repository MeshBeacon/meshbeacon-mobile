import { MaterialIcons } from "@expo/vector-icons";
import {
    Camera,
    type CameraRef,
    MapView,
    UserLocation,
} from "@maplibre/maplibre-react-native";
import { useRef, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SerialStatusBanner } from "@/components/serial-status-banner";
import { useLocationCtx } from "@/contexts/location-context";
import { useToast } from "@/contexts/toast-context";
import { OFFLINE_STYLE_URL, useOfflineMap } from "@/hooks/use-offline-map";

// Default centre when GPS is unavailable — peninsular Malaysia
const DEFAULT_CENTER: [number, number] = [109.7, 4.2]; // [lng, lat]
const DEFAULT_ZOOM = 5;
const CONNECTED_ZOOM = 12;

export default function MapScreen() {
  const gps = useLocationCtx();
  const { showToast } = useToast();
  const offlineMap = useOfflineMap();

  const [mapReady, setMapReady] = useState(false);
  const cameraRef = useRef<CameraRef>(null);

  const userCenter: [number, number] | null =
    gps.status === "ready" ? [gps.coords.longitude, gps.coords.latitude] : null;

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleDownload = async () => {
    if (gps.status !== "ready") {
      showToast("GPS fix required to download your current area.", "warning");
      return;
    }
    showToast(
      `Downloading ${offlineMap.radiusKm} km area (zoom up to ${offlineMap.maxZoom})…`,
      "info",
    );
    await offlineMap.download(gps.coords.latitude, gps.coords.longitude);
  };

  const handleDelete = async () => {
    await offlineMap.deletePack();
    showToast("Offline map data deleted.", "success");
  };

  const handleCenterUser = () => {
    if (!userCenter) {
      showToast("Waiting for GPS fix…", "warning");
      return;
    }
    cameraRef.current?.setCamera({
      centerCoordinate: userCenter,
      zoomLevel: CONNECTED_ZOOM,
      animationDuration: 600,
    });
  };

  // ── Status panel content ──────────────────────────────────────────────────

  const renderStatusPanel = () => {
    const { status, percentage, sizeLabel, createdAt, error } = offlineMap;

    if (status === "checking") {
      return (
        <View style={styles.panelRow}>
          <ActivityIndicator size="small" color="#f27f0d" />
          <Text style={styles.panelText}>Checking offline data…</Text>
        </View>
      );
    }

    if (status === "downloading") {
      return (
        <>
          <View style={styles.panelRow}>
            <MaterialIcons name="download" size={16} color="#f27f0d" />
            <Text style={styles.panelText}>
              Downloading… {percentage}%
              {sizeLabel !== "0 B" ? `  ·  ${sizeLabel}` : ""}
            </Text>
          </View>
          {/* Progress bar */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percentage}%` }]} />
          </View>
          <Text style={styles.panelHint}>
            {offlineMap.radiusKm} km radius · zoom 3–{offlineMap.maxZoom} · keep
            the app open
          </Text>
        </>
      );
    }

    if (status === "complete") {
      const dateLabel = createdAt
        ? new Date(createdAt).toLocaleDateString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Unknown date";
      return (
        <>
          <View style={styles.panelRow}>
            <MaterialIcons name="offline-pin" size={16} color="#22c55e" />
            <Text style={[styles.panelText, { color: "#22c55e" }]}>
              Offline map ready
            </Text>
            <View style={styles.spacer} />
            <Text style={styles.panelMeta}>{sizeLabel}</Text>
          </View>
          <Text style={styles.panelHint}>
            Downloaded {dateLabel} · {offlineMap.radiusKm} km radius · zoom 3–
            {offlineMap.maxZoom}
          </Text>
          <View style={styles.actionRow}>
            <Pressable style={styles.btnOutline} onPress={handleDownload}>
              <MaterialIcons name="refresh" size={14} color="#f27f0d" />
              <Text style={styles.btnOutlineText}>Re-download</Text>
            </Pressable>
            <Pressable style={styles.btnDestructive} onPress={handleDelete}>
              <MaterialIcons name="delete-outline" size={14} color="#dc2626" />
              <Text style={styles.btnDestructiveText}>Delete</Text>
            </Pressable>
          </View>
        </>
      );
    }

    if (status === "error") {
      return (
        <>
          <View style={styles.panelRow}>
            <MaterialIcons name="error-outline" size={16} color="#dc2626" />
            <Text style={[styles.panelText, { color: "#dc2626" }]}>
              Download failed
            </Text>
          </View>
          {error ? (
            <Text style={styles.panelHint} numberOfLines={2}>
              {error}
            </Text>
          ) : null}
          <Pressable style={styles.btnPrimary} onPress={handleDownload}>
            <MaterialIcons name="refresh" size={16} color="#fff" />
            <Text style={styles.btnPrimaryText}>Retry</Text>
          </Pressable>
        </>
      );
    }

    // idle
    return (
      <>
        <View style={styles.panelRow}>
          <MaterialIcons name="cloud-download" size={16} color="#8a7560" />
          <Text style={styles.panelText}>No offline map data</Text>
        </View>
        <Text style={styles.panelHint}>
          Download your current area (±{offlineMap.radiusKm} km, zoom 3–
          {offlineMap.maxZoom}) for use without internet. Uses{" "}
          <Text style={styles.panelLink}>OpenFreeMap</Text> — free, no account
          needed.
        </Text>
        <Pressable
          style={[
            styles.btnPrimary,
            gps.status !== "ready" && { opacity: 0.5 },
          ]}
          onPress={handleDownload}
          disabled={gps.status !== "ready"}
        >
          {gps.status !== "ready" ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.btnPrimaryText}>Waiting for GPS…</Text>
            </>
          ) : (
            <>
              <MaterialIcons name="download" size={16} color="#fff" />
              <Text style={styles.btnPrimaryText}>Download area</Text>
            </>
          )}
        </Pressable>
      </>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.container}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Map</Text>
            <MaterialIcons name="map" size={20} color="#f27f0d" />
          </View>
        </View>

        <SerialStatusBanner />

        {/* ── Map ── */}
        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            mapStyle={OFFLINE_STYLE_URL}
            compassEnabled
            compassViewPosition={0}
            logoEnabled={false}
            onDidFinishLoadingMap={() => setMapReady(true)}
          >
            <Camera
              ref={cameraRef}
              defaultSettings={{
                centerCoordinate: userCenter ?? DEFAULT_CENTER,
                zoomLevel: userCenter ? CONNECTED_ZOOM : DEFAULT_ZOOM,
              }}
            />
            <UserLocation visible androidRenderMode="normal" />
          </MapView>

          {/* Center-on-user FAB */}
          <Pressable
            style={[styles.fab, !mapReady && { opacity: 0 }]}
            onPress={handleCenterUser}
            accessibilityLabel="Centre map on my location"
          >
            <MaterialIcons name="my-location" size={22} color="#f27f0d" />
          </Pressable>
        </View>

        {/* ── Offline data panel ── */}
        <View style={styles.panel}>{renderStatusPanel()}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, backgroundColor: "#fff" },

  // Header
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f27f0d1f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 24, fontWeight: "700", color: "#181411" },

  // Map
  mapContainer: { flex: 1, position: "relative" },
  map: { flex: 1 },

  // Floating action button
  fab: {
    position: "absolute",
    bottom: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },

  // Offline panel
  panel: {
    borderTopWidth: 1,
    borderTopColor: "#e6e0db",
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingBottom: 20,
    backgroundColor: "#fff",
    gap: 8,
  },
  panelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  panelText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#181411",
    flex: 1,
  },
  panelMeta: {
    fontSize: 12,
    color: "#8a7560",
    fontWeight: "500",
  },
  panelHint: {
    fontSize: 12,
    color: "#8a7560",
    lineHeight: 17,
  },
  panelLink: {
    color: "#f27f0d",
    fontWeight: "600",
  },
  spacer: { flex: 1 },

  // Progress bar
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#f0eeec",
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#f27f0d",
  },

  // Action row
  actionRow: { flexDirection: "row", gap: 8 },

  // Buttons
  btnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#f27f0d",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  btnOutline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#f27f0d",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  btnOutlineText: { color: "#f27f0d", fontWeight: "600", fontSize: 13 },

  btnDestructive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#dc2626",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  btnDestructiveText: { color: "#dc2626", fontWeight: "600", fontSize: 13 },
});
