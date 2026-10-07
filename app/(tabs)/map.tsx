/**
 * Map screen — shows all discovered ClusterDuck nodes that have a GPS fix.
 *
 * Tiles:   OpenFreeMap (https://openfreemap.org) — free, no API key, OSM-based.
 * Offline: Tap "Save Offline" to cache the current viewport with MapLibre's
 *          offline pack manager. Downloaded packs persist across sessions.
 */

import { MaterialIcons } from "@expo/vector-icons";
import {
  Camera,
  type CameraRef,
  Map,
  type MapRef,
  Marker,
  OfflineManager,
  type OfflinePackDownloadState,
  type OfflinePackError,
  OfflinePack,
  type OfflinePackStatus,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useEsp32DataCtx } from "@/contexts/esp32-data-context";
import { useLocationCtx } from "@/contexts/location-context";
import { useNearbyDucksCtx } from "@/contexts/nearby-ducks-context";
import { useSerial } from "@/contexts/serial-context";
import { SerialStatusBanner } from "@/components/serial-status-banner";

const MESHBEACON_LOGO = require("@/assets/images/logo.png");

// ── Map style ─────────────────────────────────────────────────────────────────
// OpenFreeMap Liberty — vector tiles, no API key required, OSM-based.
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const OFFLINE_PACK_NAME = "cdp_area_v1";
// How long the connected device's marker lingers (dimmed) after a disconnect
// before it's removed from the map entirely.
const SELF_MARKER_TTL_MS = 5 * 60 * 1000; // 5 minutes

// OfflineManager is a shared singleton exported from MapLibre.
// It is NOT a constructor — call its methods directly.

// ── Types ─────────────────────────────────────────────────────────────────────
interface SelectedDuck {
  duckId: string;
  duckType: string;
  lat: number;
  lng: number;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MapScreen() {
  const router = useRouter();
  const { nearbyDucks } = useNearbyDucksCtx();
  const { sendScan, status, transportMode } = useSerial();
  const { deviceId } = useEsp32DataCtx();
  const gpsState = useLocationCtx();

  const connectionIcon = transportMode === "ble" ? "bluetooth" : "usb";

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);

  const [mapReady, setMapReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [selected, setSelected] = useState<SelectedDuck | null>(null);

  // Check for an existing offline pack on mount
  useEffect(() => {
    OfflineManager.getPacks()
      .then((packs: OfflinePack[]) => { if (packs.length > 0) setOfflineReady(true); })
      .catch(() => {});
  }, []);

  const userLngLat: [number, number] | null =
    gpsState.status === "ready"
      ? [gpsState.coords.longitude, gpsState.coords.latitude]
      : null;

  // Last known position of the device this phone was connected to, kept
  // around for SELF_MARKER_TTL_MS after a disconnect so the marker fades
  // out instead of vanishing the instant the link drops.
  const [lastKnownSelf, setLastKnownSelf] = useState<
    { duckId: string; lng: number; lat: number; at: number } | null
  >(null);

  useEffect(() => {
    if (status === "connected" && deviceId && userLngLat) {
      setLastKnownSelf({
        duckId: deviceId,
        lng: userLngLat[0],
        lat: userLngLat[1],
        at: Date.now(),
      });
    }
  }, [status, deviceId, userLngLat]);

  // Evict the stale "last known" marker once it goes past the TTL.
  useEffect(() => {
    const id = setInterval(() => {
      setLastKnownSelf((prev) =>
        prev && Date.now() - prev.at >= SELF_MARKER_TTL_MS ? null : prev,
      );
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // The connected device's own marker: a live position while connected, or
  // a dimmed "last known" position for a short time after it disconnects.
  const selfMarker = useMemo(() => {
    const isConnected = status === "connected" && !!deviceId;
    if (isConnected && userLngLat) {
      return {
        duckId: deviceId!,
        lng: userLngLat[0],
        lat: userLngLat[1],
        connected: true as const,
        at: Date.now(),
      };
    }
    if (isConnected && lastKnownSelf?.duckId === deviceId) {
      return { ...lastKnownSelf, connected: true as const };
    }
    if (!isConnected && lastKnownSelf) {
      return { ...lastKnownSelf, connected: false as const };
    }
    return null;
  }, [status, deviceId, userLngLat, lastKnownSelf]);

  // Mesh-discovered ducks, excluding the connected device itself — that one
  // is always rendered via `selfMarker` instead, so it never duplicates.
  const otherDucks = useMemo(
    () => nearbyDucks.filter((d) => d.duckId !== selfMarker?.duckId),
    [nearbyDucks, selfMarker],
  );

  // Only ducks that have a confirmed GPS fix
  const ducksWithGps = useMemo(
    () =>
      otherDucks.filter(
        (d): d is typeof d & { lat: number; lng: number } =>
          d.lat != null && d.lng != null,
      ),
    [otherDucks],
  );

  // Ducks heard over LoRa but with no GPS fix yet
  const ducksWithoutGps = useMemo(
    () => otherDucks.filter((d) => d.lat == null || d.lng == null),
    [otherDucks],
  );

  const centreOnUser = useCallback(() => {
    if (!userLngLat) return;
    cameraRef.current?.flyTo({ center: userLngLat, zoom: 14, duration: 600 });
  }, [userLngLat]);

  const centreOnDucks = useCallback(() => {
    const points = ducksWithGps.map((d) => [d.lng, d.lat] as [number, number]);
    if (selfMarker) points.push([selfMarker.lng, selfMarker.lat]);
    if (points.length === 0) return;
    if (points.length === 1) {
      cameraRef.current?.flyTo({ center: points[0], zoom: 14, duration: 600 });
      return;
    }
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    if (userLngLat) { lngs.push(userLngLat[0]); lats.push(userLngLat[1]); }
    const pad = 0.004;
    cameraRef.current?.fitBounds(
      [Math.min(...lngs) - pad, Math.min(...lats) - pad,
       Math.max(...lngs) + pad, Math.max(...lats) + pad],
      { duration: 600 },
    );
  }, [ducksWithGps, selfMarker, userLngLat]);

  const handleScan = useCallback(async () => {
    if (status !== "connected" || scanning) return;
    setScanning(true);
    try { await sendScan(); } catch { /* ignore */ }
    finally { setTimeout(() => setScanning(false), 5000); }
  }, [status, scanning, sendScan]);

  const downloadOfflinePack = useCallback(async () => {
    if (!mapRef.current) return;
    setDownloading(true);
    try {
      // bounds = [west, south, east, north]
      const bounds = await mapRef.current.getBounds();
      await OfflineManager.createPack(
        { mapStyle: MAP_STYLE_URL, bounds, minZoom: 4, maxZoom: 16,
          metadata: { name: OFFLINE_PACK_NAME } },
        (_pack: OfflinePack, packStatus: OfflinePackStatus) => {
          const state = packStatus.state as OfflinePackDownloadState;
          if (state === "complete") {
            setOfflineReady(true);
            setDownloading(false);
          }
        },
        (_pack: OfflinePack, error: OfflinePackError) => {
          setDownloading(false);
          Alert.alert("Download failed", error.message);
        },
      );
    } catch (err) {
      setDownloading(false);
      Alert.alert(
        "Download failed",
        err instanceof Error ? err.message : "Could not download offline tiles.",
      );
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MaterialIcons name="map" size={20} color="#f27f0d" />
            <Text style={styles.title}>Node Map</Text>
            {nearbyDucks.length > 0 && (
              <View style={styles.countPill}>
                <Text style={styles.countText}>{nearbyDucks.length}</Text>
              </View>
            )}
          </View>
          <View style={styles.headerActions}>
            {offlineReady && (
              <MaterialIcons
                name="offline-pin"
                size={16}
                color="#22c55e"
                style={{ marginRight: 6 }}
              />
            )}
            <Pressable
              style={[styles.headerBtn, downloading && { opacity: 0.4 }]}
              onPress={downloadOfflinePack}
              disabled={downloading || !mapReady}
            >
              {downloading ? (
                <ActivityIndicator size={12} color="#f27f0d" />
              ) : (
                <MaterialIcons name="download" size={16} color="#f27f0d" />
              )}
              <Text style={styles.headerBtnText}>
                {downloading ? "Saving…" : "Save Offline"}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* ── Connection warning (only shown when disconnected) ── */}
        <SerialStatusBanner disconnectedOnly />

        {/* ── Map ── */}
        <View style={styles.mapWrap}>
          <Map
            ref={mapRef}
            style={styles.map}
            mapStyle={MAP_STYLE_URL}
            onDidFinishLoadingMap={() => setMapReady(true)}
            onPress={() => setSelected(null)}
            attributionPosition={{ bottom: 20, left: 80 }}
            logoPosition={{ bottom: 20, left: 8 }}
          >
            <Camera
              ref={cameraRef}
              initialViewState={{
                center: userLngLat ?? [101.6869, 3.139],
                zoom: 12,
              }}
            />

            <UserLocation animated accuracy heading />

            {/* One Marker per duck that has a GPS fix (excludes the connected
                device itself, which is rendered separately below) */}
            {ducksWithGps.map((duck) => (
              <Marker
                key={duck.duckId}
                lngLat={[duck.lng, duck.lat]}
                anchor="bottom"
                onPress={() =>
                  setSelected({
                    duckId: duck.duckId,
                    duckType: duck.duckType,
                    lat: duck.lat,
                    lng: duck.lng,
                  })
                }
              >
                <View style={styles.markerWrap}>
                  <View style={styles.marker}>
                    <Text style={styles.markerType}>{duck.duckType[0]}</Text>
                  </View>
                  <Text style={styles.markerLabel} numberOfLines={1}>
                    {duck.duckId}
                  </Text>
                  {/* Callout stem */}
                  <View style={styles.markerStem} />
                </View>
              </Marker>
            ))}

            {/* Branded marker for the device this phone is connected to over
                BLE/USB. Stays dimmed with its last known position for a short
                time after a disconnect, then disappears once it goes stale. */}
            {selfMarker && (
              <Marker
                key="SELF_MARKER"
                lngLat={[selfMarker.lng, selfMarker.lat]}
                anchor="bottom"
                onPress={() =>
                  setSelected({
                    duckId: selfMarker.duckId,
                    duckType: "ME",
                    lat: selfMarker.lat,
                    lng: selfMarker.lng,
                  })
                }
              >
                <View
                  style={[
                    styles.markerWrap,
                    !selfMarker.connected && styles.markerFaded,
                  ]}
                >
                  <View style={styles.markerBadgeAnchor}>
                    <View style={[styles.marker, styles.markerConnected]}>
                      <Image
                        source={MESHBEACON_LOGO}
                        style={styles.markerLogo}
                        resizeMode="contain"
                      />
                    </View>
                    <View
                      style={[
                        styles.markerConnBadge,
                        !selfMarker.connected && styles.markerConnBadgeOffline,
                      ]}
                    >
                      <MaterialIcons
                        name={selfMarker.connected ? connectionIcon : "cloud-off"}
                        size={9}
                        color="#fff"
                      />
                    </View>
                  </View>
                  <Text style={styles.markerLabel} numberOfLines={1}>
                    {selfMarker.connected ? selfMarker.duckId : "Last seen"}
                  </Text>
                  <View
                    style={[styles.markerStem, styles.markerStemConnected]}
                  />
                </View>
              </Marker>
            )}
          </Map>

          {/* ── FAB column ── */}
          <View style={styles.fabs}>
            {/* LoRa scan */}
            <Pressable
              style={[
                styles.fab,
                (scanning || status !== "connected") && { opacity: 0.4 },
              ]}
              onPress={handleScan}
              disabled={scanning || status !== "connected"}
            >
              {scanning ? (
                <ActivityIndicator size={18} color="#fff" />
              ) : (
                <MaterialIcons name="radar" size={20} color="#fff" />
              )}
            </Pressable>

            {/* Fit all ducks in viewport */}
            {(ducksWithGps.length > 0 || selfMarker) && (
              <Pressable style={styles.fab} onPress={centreOnDucks}>
                <MaterialIcons name="zoom-out-map" size={20} color="#fff" />
              </Pressable>
            )}

            {/* My location */}
            <Pressable
              style={[styles.fab, styles.fabAlt, !userLngLat && { opacity: 0.4 }]}
              onPress={centreOnUser}
              disabled={!userLngLat}
            >
              <MaterialIcons name="my-location" size={20} color="#f27f0d" />
            </Pressable>
          </View>

          {/* ── No-GPS node chips bar ── */}
          {ducksWithoutGps.length > 0 && (
            <View style={styles.noGpsBar}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.noGpsScroll}
              >
                <View style={styles.noGpsLabel}>
                  <MaterialIcons name="location-off" size={12} color="#8a7560" />
                  <Text style={styles.noGpsLabelText}>No GPS</Text>
                </View>
                {ducksWithoutGps.map((duck) => (
                  <Pressable
                    key={duck.duckId}
                    style={styles.noGpsChip}
                    onPress={() =>
                      router.push({
                        pathname: "/chat/[peerId]" as any,
                        params: { peerId: duck.duckId },
                      })
                    }
                  >
                    <View style={styles.noGpsAvatar}>
                      <Text style={styles.noGpsAvatarText}>
                        {duck.duckType[0]}
                      </Text>
                    </View>
                    <Text style={styles.noGpsChipText} numberOfLines={1}>
                      {duck.duckId}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {/* ── No-GPS placeholder ── */}
          {ducksWithGps.length === 0 && !selfMarker && mapReady && (
            <View style={styles.emptyOverlay} pointerEvents="none">
              <View style={styles.emptyCard}>
                <MaterialIcons name="cell-tower" size={32} color="#d1c5b8" />
                <Text style={styles.emptyTitle}>No nodes with GPS</Text>
                <Text style={styles.emptyHint}>
                  {status === "connected"
                    ? "Tap the radar button to ping nearby ducks"
                    : "Connect to a device first"}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Selected duck info panel ── */}
        {selected && (
          <View style={styles.panel}>
            <View style={styles.panelLeft}>
              <View
                style={[
                  styles.panelAvatar,
                  selected.duckId === selfMarker?.duckId && styles.panelAvatarConnected,
                ]}
              >
                {selected.duckId === selfMarker?.duckId ? (
                  <Image
                    source={MESHBEACON_LOGO}
                    style={styles.panelLogo}
                    resizeMode="contain"
                  />
                ) : (
                  <Text style={styles.panelAvatarText}>
                    {selected.duckId.charAt(0)}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.panelNameRow}>
                  <Text style={styles.panelName} numberOfLines={1}>
                    {selected.duckId}
                  </Text>
                  <View style={styles.panelTypePill}>
                    <Text style={styles.panelTypeText}>{selected.duckType}</Text>
                  </View>
                  {selected.duckId === selfMarker?.duckId && (
                    <View style={styles.panelConnPill}>
                      <MaterialIcons
                        name={selfMarker.connected ? connectionIcon : "cloud-off"}
                        size={10}
                        color="#2563eb"
                      />
                      <Text style={styles.panelConnPillText}>
                        {selfMarker.connected ? "Connected" : "Last seen"}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.panelCoords}>
                  {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
                </Text>
              </View>
            </View>
            <View style={styles.panelActions}>
              <Pressable
                style={styles.panelBtn}
                onPress={() => {
                  setSelected(null);
                  router.push({
                    pathname: "/chat/[peerId]" as any,
                    params: { peerId: selected.duckId },
                  });
                }}
              >
                <MaterialIcons name="chat" size={16} color="#fff" />
                <Text style={styles.panelBtnText}>Chat</Text>
              </Pressable>
              <Pressable
                style={styles.panelClose}
                onPress={() => setSelected(null)}
              >
                <MaterialIcons name="close" size={18} color="#8a7560" />
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f27f0d1f",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 24, fontWeight: "700", color: "#181411" },
  countPill: {
    backgroundColor: "#f27f0d",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  countText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f27f0d40",
  },
  headerBtnText: { fontSize: 12, fontWeight: "600", color: "#f27f0d" },

  mapWrap: { flex: 1 },
  map: { flex: 1 },

  markerWrap: { alignItems: "center" },
  markerBadgeAnchor: { width: 36, height: 36 },
  marker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f27f0d",
    borderWidth: 2.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  // Branded marker for the duck this phone is directly connected to (BLE/USB).
  markerConnected: {
    backgroundColor: "#fff",
    borderColor: "#f27f0d",
  },
  markerLogo: { width: 22, height: 22, borderRadius: 11 },
  markerConnBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  markerStemConnected: { backgroundColor: "#2563eb" },
  // Dimmed treatment for the self-marker once the device has disconnected —
  // still shows its last known position, but visually de-emphasized.
  markerFaded: { opacity: 0.45 },
  markerConnBadgeOffline: { backgroundColor: "#8a7560" },
  markerType: { fontSize: 11, fontWeight: "700", color: "#fff" },
  markerLabel: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: "700",
    color: "#181411",
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: "hidden",
    maxWidth: 80,
  },
  markerStem: {
    width: 2,
    height: 6,
    backgroundColor: "#f27f0d",
    borderRadius: 1,
  },

  fabs: {
    position: "absolute",
    right: 14,
    bottom: 60,
    gap: 10,
  },
  fab: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabAlt: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#f27f0d" },

  noGpsBar: {
    position: "absolute",
    left: 12,
    bottom: 60,
    right: 78, // leave room for FABs on the right
  },
  noGpsScroll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  noGpsLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#e0d8d0",
  },
  noGpsLabelText: { fontSize: 10, fontWeight: "600", color: "#8a7560" },
  noGpsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#e0d8d0",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  noGpsAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#8a7560",
    alignItems: "center",
    justifyContent: "center",
  },
  noGpsAvatarText: { fontSize: 9, fontWeight: "700", color: "#fff" },
  noGpsChipText: { fontSize: 11, fontWeight: "600", color: "#181411", maxWidth: 70 },

  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 80,
  },
  emptyCard: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: "center",
    gap: 6,
    maxWidth: 280,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: "#8a7560" },
  emptyHint: {
    fontSize: 12,
    color: "#b0a090",
    textAlign: "center",
    lineHeight: 18,
  },

  panel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#f0eeec",
    gap: 12,
  },
  panelLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  panelAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
  },
  panelAvatarConnected: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#f27f0d",
  },
  panelLogo: { width: 24, height: 24, borderRadius: 12 },
  panelAvatarText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  panelNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  panelName: { fontSize: 15, fontWeight: "700", color: "#181411" },
  panelTypePill: {
    backgroundColor: "#bbf7d0",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  panelTypeText: { fontSize: 9, fontWeight: "700", color: "#15803d" },
  panelConnPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#dbeafe",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  panelConnPillText: { fontSize: 9, fontWeight: "700", color: "#2563eb" },
  panelCoords: {
    fontSize: 11,
    color: "#8a7560",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 2,
  },
  panelActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  panelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#f27f0d",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  panelBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  panelClose: { padding: 4 },
});
