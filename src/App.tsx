import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  PluginCommAPI,
  PluginManager,
  PluginNoteAPI,
} from 'sn-plugin-lib';

const TARGET_LAYER_INDEX = 4; // Layer 4 in Supernote Note (0=Bg, 1=Main, 2=L2, 3=L3, 4=L4)
const MANTA_CANVAS_WIDTH = 1920;
const MANTA_CANVAS_HEIGHT = 2560;

export default function App() {
  const [visible, setVisible] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>(
    'Enter or browse the image path in INBOX / EXPORT from LocalSend.'
  );
  const [imagePath, setImagePath] = useState<string>(
    '/storage/emulated/0/INBOX/'
  );
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number }>({
    w: 800,
    h: 800,
  });

  // Transform state: Rotate, Crop, Resize
  const [rotation, setRotation] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.0);
  const [cropPreset, setCropPreset] = useState<'FULL' | 'SQUARE' | 'TIGHT'>('FULL');

  useEffect(() => {
    const subscription = PluginManager.registerButtonListener((event: any) => {
      if (event?.id === 'localsend_layer4_btn') {
        setVisible(true);
        detectLatestFile();
      }
    });
    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  const detectLatestFile = async () => {
    setLoading(true);
    try {
      // Check if PluginCommAPI or native file bridge exposes directory listing
      const fileApi = (PluginCommAPI as any);
      if (typeof fileApi.getLatestInboxFile === 'function') {
        const res = await fileApi.getLatestInboxFile();
        if (res?.success && res.result) {
          setImagePath(res.result);
          loadDimensions(res.result);
          setStatus(`Loaded: ${res.result}`);
          return;
        }
      }
      setStatus('Ready: Enter image filename in INBOX or EXPORT below.');
    } catch (err: any) {
      setStatus(`Note: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const loadDimensions = (path: string) => {
    const uri = path.startsWith('file://') ? path : `file://${path}`;
    Image.getSize(
      uri,
      (w, h) => setImgDimensions({ w, h }),
      () => setImgDimensions({ w: 800, h: 800 })
    );
  };

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
      await (PluginNoteAPI as any).setCurrentLayer({
        layerIndex: TARGET_LAYER_INDEX,
      });
    }
  };

  const handlePasteToLayer4 = async () => {
    const cleanPath = imagePath.replace(/^file:\/\//, '').trim();
    if (!cleanPath || cleanPath.endsWith('/')) {
      setStatus('Enter a valid image file path (e.g., /storage/emulated/0/INBOX/photo.png).');
      return;
    }

    setLoading(true);
    setStatus('Inserting image into Layer 4...');
    try {
      const pageRes = await PluginCommAPI.getCurrentPageNum();
      if (!pageRes.success) {
        throw new Error(pageRes.error || 'No open note page detected.');
      }

      await ensureLayer4Ready();

      const cropRatio =
        cropPreset === 'FULL' ? 1.0 : cropPreset === 'SQUARE' ? 0.8 : 0.65;
      const isSwapped = Math.abs(rotation % 180) === 90;
      const rawW = (isSwapped ? imgDimensions.h : imgDimensions.w) * cropRatio;
      const rawH = (isSwapped ? imgDimensions.w : imgDimensions.h) * cropRatio;

      const maxFit = 1200;
      const fitFactor = Math.min(1, maxFit / Math.max(rawW, rawH));
      const finalW = Math.max(80, Math.round(rawW * fitFactor * scale));
      const finalH = Math.max(80, Math.round(rawH * fitFactor * scale));

      const centerX = Math.max(40, Math.round((MANTA_CANVAS_WIDTH - finalW) / 2));
      const centerY = Math.max(40, Math.round((MANTA_CANVAS_HEIGHT - finalH) / 2));

      const insertRes = await PluginCommAPI.insertSticker({
        filePath: cleanPath,
        layerIndex: TARGET_LAYER_INDEX,
        rotation,
        cropRatio,
        x: centerX,
        y: centerY,
        width: finalW,
        height: finalH,
      } as any);

      if (!insertRes.success) {
        const elemRes = await PluginCommAPI.createElement({
          type: 'IMAGE',
          layerIndex: TARGET_LAYER_INDEX,
          filePath: cleanPath,
          rotation,
          rect: {
            left: centerX,
            top: centerY,
            right: centerX + finalW,
            bottom: centerY + finalH,
          },
        } as any);

        if (!elemRes.success || !elemRes.result) {
          throw new Error(insertRes.error || elemRes.error || 'Failed to insert image.');
        }

        const pageInsertRes = await PluginCommAPI.insertPageElements({
          layerIndex: TARGET_LAYER_INDEX,
          elements: [elemRes.result],
        } as any);

        if (!pageInsertRes.success) {
          throw new Error(pageInsertRes.error || 'Failed to place image on Layer 4.');
        }
      }

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

  const previewUri = imagePath.startsWith('file://')
    ? imagePath
    : `file://${imagePath}`;
  const cropBoxSize =
    cropPreset === 'FULL' ? 300 : cropPreset === 'SQUARE' ? 240 : 195;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => setVisible(false)}
    >
      <SafeAreaView style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>LocalSend → Layer 4 Placer</Text>
            <TouchableOpacity
              style={styles.btnSmall}
              onPress={() => setVisible(false)}
            >
              <Text style={styles.btnText}>Close</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.statusText}>{status}</Text>

          <TextInput
            style={styles.input}
            value={imagePath}
            onChangeText={(txt) => {
              setImagePath(txt);
              if (!txt.endsWith('/')) loadDimensions(txt);
            }}
            placeholder="/storage/emulated/0/INBOX/image.png"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.stage}>
            {loading ? (
              <ActivityIndicator size="large" color="#000000" />
            ) : !imagePath.endsWith('/') ? (
              <View
                style={[
                  styles.cropFrame,
                  { width: cropBoxSize, height: cropBoxSize },
                ]}
              >
                <Image
                  source={{ uri: previewUri }}
                  resizeMode="contain"
                  style={{
                    width: 300,
                    height: 300,
                    transform: [{ rotate: `${rotation}deg` }, { scale }],
                  }}
                />
              </View>
            ) : (
              <Text style={styles.emptyText}>
                Type or paste the filename saved by LocalSend in INBOX or EXPORT.
              </Text>
            )}
          </View>

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
              onPress={() =>
                setScale((s) => Math.max(0.25, Number((s - 0.15).toFixed(2))))
              }
            >
              <Text style={styles.btnText}>Shrink -15%</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btn}
              onPress={() =>
                setScale((s) => Math.min(2.5, Number((s + 0.15).toFixed(2))))
              }
            >
              <Text style={styles.btnText}>Enlarge +15%</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => {
                setRotation(0);
                setScale(1.0);
                setCropPreset('FULL');
              }}
            >
              <Text style={styles.btnText}>Reset</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.btnPrimary, loading && styles.btnDisabled]}
            disabled={loading}
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
    backgroundColor: 'rgba(255,255,255,0.94)',
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
    gap: 10,
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
  input: {
    borderWidth: 2,
    borderColor: '#000000',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#000000',
    backgroundColor: '#FFFFFF',
  },
  stage: {
    height: 310,
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
