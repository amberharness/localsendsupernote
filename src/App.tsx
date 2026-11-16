import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import ViewShot from 'react-native-view-shot';
import {
  PluginCommAPI,
  PluginManager,
  PluginNoteAPI,
} from 'sn-plugin-lib';

/**
 * Official LocalSend (https://github.com/localsend/localsend | org.localsend.localsend_app)
 * Supernote plugins can read shared user folders: INBOX, EXPORT, Document, MyStyle, Note, SCREENSHOT.
 * Set LocalSend -> Settings -> Receive -> Destination to /storage/emulated/0/INBOX on Supernote Manta.
 */
const LOCALSEND_SCAN_DIRS = [
  `${RNFS.ExternalStorageDirectoryPath}/INBOX`,
  `${RNFS.ExternalStorageDirectoryPath}/INBOX/LocalSend`,
  `${RNFS.ExternalStorageDirectoryPath}/EXPORT`,
  `${RNFS.ExternalStorageDirectoryPath}/EXPORT/LocalSend`,
  `${RNFS.ExternalStorageDirectoryPath}/SCREENSHOT`,
];

const SUPPORTED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
const TARGET_LAYER_INDEX = 4; // Layer 4 in Supernote Note (0=Bg, 1=Main, 2=L2, 3=L3, 4=L4)

// Supernote Manta canvas resolution (300 DPI)
const MANTA_CANVAS_WIDTH = 1920;
const MANTA_CANVAS_HEIGHT = 2560;

interface DiscoveredImage {
  name: string;
  path: string;
  mtimeMs: number;
}

export default function App() {
  const [visible, setVisible] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('Ready');
  const [latestFile, setLatestFile] = useState<DiscoveredImage | null>(null);
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number }>({ w: 800, h: 800 });

  // Transform state: Rotate, Crop, Resize
  const [rotation, setRotation] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.0);
  const [cropPreset, setCropPreset] = useState<'FULL' | 'SQUARE' | 'TIGHT'>('FULL');

  const viewShotRef = useRef<ViewShot | null>(null);

  useEffect(() => {
    const subscription = PluginManager.registerButtonListener((event: any) => {
      if (event?.id === 'localsend_layer4_btn') {
        setVisible(true);
        scanForLatestLocalSendImage();
      }
    });
    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  const scanForLatestLocalSendImage = async () => {
    setLoading(true);
    setStatus('Scanning INBOX / EXPORT for LocalSend transfers...');
    try {
      let newest: DiscoveredImage | null = null;

      for (const dir of LOCALSEND_SCAN_DIRS) {
        const exists = await RNFS.exists(dir);
        if (!exists) continue;

        const items = await RNFS.readDir(dir);
        for (const item of items) {
          if (!item.isFile()) continue;
          const lower = item.name.toLowerCase();
          if (!SUPPORTED_IMAGE_EXTS.some((ext) => lower.endsWith(ext))) continue;

          const mtimeMs = item.mtime ? new Date(item.mtime).getTime() : 0;
          if (!newest || mtimeMs > newest.mtimeMs) {
            newest = {
              name: item.name,
              path: item.path,
              mtimeMs,
            };
          }
        }
      }

      if (!newest) {
        setLatestFile(null);
        setStatus(
          'No image found. In LocalSend Settings -> Receive -> Destination, select INBOX or EXPORT.'
        );
      } else {
        setLatestFile(newest);
        setRotation(0);
        setScale(1.0);
        setCropPreset('FULL');
        Image.getSize(
          `file://${newest.path}`,
          (w, h) => setImgDimensions({ w, h }),
          () => setImgDimensions({ w: 800, h: 800 })
        );
        setStatus(`Loaded: ${newest.name}`);
      }
    } catch (err: any) {
      setStatus(`Scan error: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Ensures Layer 4 exists on the active note page and switches/targets Layer 4.
   */
  const ensureLayer4Ready = async () => {
    const layersRes = await (PluginNoteAPI as any).getLayers?.();
    if (layersRes?.success && Array.isArray(layersRes.result)) {
      let count = layersRes.result.length;
      while (count <= TARGET_LAYER_INDEX) {
        const addRes = await (PluginNoteAPI as any).insertLayer?.({
          name: `Layer ${count}`,
        });
        if (!addRes?.success) break;
        count += 1;
      }
    }
    if (typeof (PluginNoteAPI as any).setCurrentLayer === 'function') {
      await (PluginNoteAPI as any).setCurrentLayer({ layerIndex: TARGET_LAYER_INDEX });
    }
  };

  const handlePasteToLayer4 = async () => {
    if (!latestFile || !viewShotRef.current?.capture) {
      setStatus('No image ready to paste.');
      return;
    }

    setLoading(true);
    setStatus('Rendering transformed image & preparing Layer 4...');
    try {
      const pageRes = await PluginCommAPI.getCurrentPageNum();
      if (!pageRes.success) {
        throw new Error(pageRes.error || 'No open note page detected.');
      }

      // Ensure Layer 4 exists and is active
      await ensureLayer4Ready();

      // Capture cropped/rotated/resized PNG from ViewShot
      const base64Png = await viewShotRef.current.capture();

      const cropRatio = cropPreset === 'FULL' ? 1.0 : cropPreset === 'SQUARE' ? 0.8 : 0.65;
      const isSwapped = Math.abs(rotation % 180) === 90;
      const rawW = (isSwapped ? imgDimensions.h : imgDimensions.w) * cropRatio;
      const rawH = (isSwapped ? imgDimensions.w : imgDimensions.h) * cropRatio;

      const maxFit = 1200;
      const fitFactor = Math.min(1, maxFit / Math.max(rawW, rawH));
      const finalW = Math.max(80, Math.round(rawW * fitFactor * scale));
      const finalH = Math.max(80, Math.round(rawH * fitFactor * scale));

      const centerX = Math.max(40, Math.round((MANTA_CANVAS_WIDTH - finalW) / 2));
      const centerY = Math.max(40, Math.round((MANTA_CANVAS_HEIGHT - finalH) / 2));

      // Primary path: createElement + insertPageElements targeting Layer 4
      const elemRes = await PluginCommAPI.createElement({
        type: 'IMAGE',
        layerIndex: TARGET_LAYER_INDEX,
        data: `data:image/png;base64,${base64Png}`,
        rect: {
          left: centerX,
          top: centerY,
          right: centerX + finalW,
          bottom: centerY + finalH,
        },
      } as any);

      if (elemRes.success && elemRes.result) {
        const insertRes = await PluginCommAPI.insertPageElements({
          layerIndex: TARGET_LAYER_INDEX,
          elements: [elemRes.result],
        } as any);
        if (!insertRes.success) {
          throw new Error(insertRes.error || 'insertPageElements failed on Layer 4');
        }
      } else {
        // Fallback path: insertSticker on active Layer 4
        const stickerRes = await PluginCommAPI.insertSticker({
          imageBase64: base64Png,
          layerIndex: TARGET_LAYER_INDEX,
          x: centerX,
          y: centerY,
          width: finalW,
          height: finalH,
        } as any);

        if (!stickerRes.success) {
          throw new Error(stickerRes.error || 'insertSticker failed on Layer 4');
        }
      }

      // Select newly pasted image with Supernote's lasso tool for immediate pen adjustment
      await PluginCommAPI.lassoElements({
        rect: {
          left: centerX,
          top: centerY,
          right: centerX + finalW,
          bottom: centerY + finalH,
        },
      } as any);
      await PluginCommAPI.setLassoBoxState({ visible: true } as any);

      setStatus('Pasted into Layer 4!');
      setVisible(false);
    } catch (err: any) {
      setStatus(`Paste error: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const cropBoxSize = cropPreset === 'FULL' ? 320 : cropPreset === 'SQUARE' ? 256 : 208;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => setVisible(false)}
    >
      <SafeAreaView style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>LocalSend → Layer 4 Placer</Text>
            <TouchableOpacity style={styles.btnSmall} onPress={() => setVisible(false)}>
              <Text style={styles.btnText}>Close</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.statusText}>{status}</Text>

          {/* Preview & Transform Stage */}
          <View style={styles.stage}>
            {loading ? (
              <ActivityIndicator size="large" color="#000000" />
            ) : latestFile ? (
              <ViewShot
                ref={viewShotRef}
                options={{ format: 'png', quality: 1.0, result: 'base64' }}
                style={[
                  styles.cropFrame,
                  { width: cropBoxSize, height: cropBoxSize },
                ]}
              >
                <Image
                  source={{ uri: `file://${latestFile.path}` }}
                  resizeMode="contain"
                  style={{
                    width: 320,
                    height: 320,
                    transform: [
                      { rotate: `${rotation}deg` },
                      { scale },
                    ],
                  }}
                />
              </ViewShot>
            ) : (
              <Text style={styles.emptyText}>
                Send an image from your phone via LocalSend to INBOX, then tap Reload.
              </Text>
            )}
          </View>

          {/* Rotate / Crop / Resize Controls */}
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => setRotation((r) => (r - 90) % 360)}
            >
              <Text style={styles.btnText}>Rotate -90°</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => setRotation((r) => (r + 90) % 360)}
            >
              <Text style={styles.btnText}>Rotate +90°</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btn}
              onPress={() =>
                setCropPreset((prev) =>
                  prev === 'FULL' ? 'SQUARE' : prev === 'SQUARE' ? 'TIGHT' : 'FULL'
                )
              }
            >
              <Text style={styles.btnText}>Crop: {cropPreset}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => setScale((s) => Math.max(0.25, Number((s - 0.15).toFixed(2))))}
            >
              <Text style={styles.btnText}>Shrink -15%</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => setScale((s) => Math.min(2.5, Number((s + 0.15).toFixed(2))))}
            >
              <Text style={styles.btnText}>Enlarge +15%</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={scanForLatestLocalSendImage}>
              <Text style={styles.btnText}>Reload INBOX</Text>
            </TouchableOpacity>
          </View>

          {/* Primary Action */}
          <TouchableOpacity
            style={[styles.btnPrimary, (!latestFile || loading) && styles.btnDisabled]}
            disabled={!latestFile || loading}
            onPress={handlePasteToLayer4}
          >
            <Text style={styles.btnPrimaryText}>Paste Into Layer 4</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#000000',
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    paddingBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
  statusText: {
    fontSize: 13,
    color: '#000000',
    borderWidth: 1,
    borderColor: '#000000',
    padding: 8,
    backgroundColor: '#F4F4F4',
  },
  stage: {
    height: 350,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
    overflow: 'hidden',
  },
  cropFrame: {
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  emptyText: {
    fontSize: 14,
    color: '#000000',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  btn: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnSmall: {
    borderWidth: 2,
    borderColor: '#000000',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  btnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
  },
  btnPrimary: {
    backgroundColor: '#000000',
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
