/**
 * useOfflineMap — wraps MapLibre's OfflineManager to manage a single
 * downloadable region around the user's current location.
 *
 * Tile service: OpenFreeMap (https://openfreemap.org)
 *   - Completely free, no account or API key required.
 *   - Based on OpenStreetMap data, updated weekly.
 *   - Provides MapLibre-compatible vector tiles.
 *
 * A single offline pack named "cdk-offline-area" is managed.
 * Downloading the same area again overwrites (deletes then recreates) the pack.
 */

import {
    OfflineManager,
    type OfflinePackStatus,
} from "@maplibre/maplibre-react-native";
import { useCallback, useEffect, useState } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

export const OFFLINE_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const PACK_NAME = "cdk-offline-area";

/** Radius in km around the user's location to download. */
const RADIUS_KM = 15;

/** Min zoom — world overview level, very few tiles. */
const MIN_ZOOM = 3;

/**
 * Max zoom — street-level detail.
 * 14 is a good balance between detail and download size.
 * Raising to 15 quadruples the tile count.
 */
const MAX_ZOOM = 14;

// ── Types ─────────────────────────────────────────────────────────────────────

export type OfflineMapStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "complete"
  | "error";

export interface OfflineMapState {
  status: OfflineMapStatus;
  /** Download progress 0-100 */
  percentage: number;
  /** Size of downloaded tiles in bytes */
  sizeBytes: number;
  /** Human-readable size string */
  sizeLabel: string;
  /** ISO date string of when this pack was created */
  createdAt: string | null;
  /** Error details if status === "error" */
  error: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bytesToLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Build a bounding box [[neLng, neLat], [swLng, swLat]] from a centre
 * lat/lng with a radius in km. GeoJSON.Position = [longitude, latitude].
 */
function boundingBox(
  lat: number,
  lng: number,
  radiusKm: number,
): [GeoJSON.Position, GeoJSON.Position] {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return [
    [lng + lngDelta, lat + latDelta], // NE corner [lng, lat]
    [lng - lngDelta, lat - latDelta], // SW corner [lng, lat]
  ];
}

const initialState: OfflineMapState = {
  status: "checking",
  percentage: 0,
  sizeBytes: 0,
  sizeLabel: "0 B",
  createdAt: null,
  error: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOfflineMap() {
  const [state, setState] = useState<OfflineMapState>(initialState);

  // ── Load existing pack state on mount ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pack = await OfflineManager.getPack(PACK_NAME);
        if (cancelled) return;

        if (!pack) {
          setState((s) => ({ ...s, status: "idle" }));
          return;
        }

        const status: OfflinePackStatus = await pack.status();
        if (cancelled) return;

        const meta = pack.metadata ?? {};
        const sizeBytes = status.completedTileSize ?? 0;

        if (status.state === 2 /* Complete */) {
          setState({
            status: "complete",
            percentage: 100,
            sizeBytes,
            sizeLabel: bytesToLabel(sizeBytes),
            createdAt: (meta as Record<string, string>).createdAt ?? null,
            error: null,
          });
        } else {
          // Pack exists but isn't finished — resume
          setState({
            status: "downloading",
            percentage: status.percentage ?? 0,
            sizeBytes,
            sizeLabel: bytesToLabel(sizeBytes),
            createdAt: null,
            error: null,
          });
        }
      } catch {
        if (!cancelled) {
          setState((s) => ({ ...s, status: "idle" }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Download ──────────────────────────────────────────────────────────────
  const download = useCallback(async (lat: number, lng: number) => {
    setState({
      status: "downloading",
      percentage: 0,
      sizeBytes: 0,
      sizeLabel: "0 B",
      createdAt: null,
      error: null,
    });

    try {
      // Delete any existing pack first so we can re-download cleanly
      const existing = await OfflineManager.getPack(PACK_NAME);
      if (existing) {
        await OfflineManager.deletePack(PACK_NAME);
      }

      const createdAt = new Date().toISOString();
      const bounds = boundingBox(lat, lng, RADIUS_KM);

      await OfflineManager.createPack(
        {
          name: PACK_NAME,
          styleURL: OFFLINE_STYLE_URL,
          bounds,
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          metadata: { createdAt },
        },
        // Progress callback
        (_pack, status: OfflinePackStatus) => {
          const sizeBytes = status.completedTileSize ?? 0;
          const isDone = status.state === 2; /* Complete */
          setState({
            status: isDone ? "complete" : "downloading",
            percentage: Math.round(status.percentage ?? 0),
            sizeBytes,
            sizeLabel: bytesToLabel(sizeBytes),
            createdAt: isDone ? createdAt : null,
            error: null,
          });
        },
        // Error callback
        (_pack, err) => {
          setState((s) => ({
            ...s,
            status: "error",
            error: err.message ?? "Unknown error",
          }));
        },
      );
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  // ── Delete ────────────────────────────────────────────────────────────────
  const deletePack = useCallback(async () => {
    try {
      await OfflineManager.deletePack(PACK_NAME);
      setState({
        status: "idle",
        percentage: 0,
        sizeBytes: 0,
        sizeLabel: "0 B",
        createdAt: null,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  return {
    ...state,
    download,
    deletePack,
    /** Radius used for the downloaded bounding box, exposed for UI info. */
    radiusKm: RADIUS_KM,
    maxZoom: MAX_ZOOM,
  };
}
