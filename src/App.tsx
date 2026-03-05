import { Leva, useControls } from 'leva';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AvatarCanvas } from './components/AvatarCanvas';
import { type AssetItem, loadAssets } from './lib/githubAssets';
import { isAllowedVrmFile } from './lib/fileValidation';
import {
  clearStoredModels,
  getStoredModelBlob,
  listStoredModels,
  saveUploadedModel,
  type StoredModelSummary,
} from './lib/modelDb';
import { useUiStore } from './store/useUiStore';
import { useFaceTracking } from './tracking/useFaceTracking';

type CharacterItem = AssetItem & {
  source: 'remote' | 'uploaded' | 'custom';
  modelId?: string;
};

const STICKER_POSITIONS = [
  { top: '18%', left: '12%' },
  { top: '18%', right: '12%' },
  { top: '42%', left: '10%' },
  { top: '42%', right: '10%' },
  { top: '68%', left: '16%' },
  { top: '68%', right: '16%' },
];

const formatCharacterLabel = (name: string): string =>
  name
    .replace(/\.vrm$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();

function App() {
  const [backgrounds, setBackgrounds] = useState<AssetItem[]>([]);
  const [stickers, setStickers] = useState<AssetItem[]>([]);
  const [remoteCharacters, setRemoteCharacters] = useState<AssetItem[]>([]);
  const [uploadedCharacters, setUploadedCharacters] = useState<CharacterItem[]>([]);
  const [customCharacters, setCustomCharacters] = useState<CharacterItem[]>([]);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [modelLoading, setModelLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [bodyTrackingEnabled, setBodyTrackingEnabled] = useState(
    () => (import.meta.env.VITE_ENABLE_BODY_TRACKING ?? '').toLowerCase() === 'true',
  );
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);

  const {
    isTracking,
    isLoading: cameraLoading,
    statusText,
    error: trackingError,
    rigOutput,
    startTracking,
    stopTracking,
    calibrateNow,
  } = useFaceTracking(cameraRef, { bodyTrackingEnabled });

  const {
    activeBackgroundId,
    activeCharacterId,
    activeStickerIds,
    controlsHidden,
    drawerPanel,
    setBackground,
    setCharacter,
    toggleSticker,
    setDrawerPanel,
    toggleControls,
    showControls,
    resetUi,
  } = useUiStore();

  const { avatarScale, yOffset, cameraZoom, bgDimmer } = useControls(
    'Avatar',
    {
      avatarScale: { value: 1.1, min: 0.6, max: 1.8, step: 0.01 },
      yOffset: { value: -0.3, min: -2.2, max: 1.2, step: 0.01 },
      cameraZoom: { value: 1.5, min: 1.5, max: 5.2, step: 0.01 },
      bgDimmer: { value: 0.1, min: 0, max: 0.5, step: 0.01 },
    },
    { collapsed: true },
  );

  const characterOptions = useMemo<CharacterItem[]>(
    () => [
      ...uploadedCharacters,
      ...customCharacters,
      ...remoteCharacters.map(entry => ({
        ...entry,
        source: 'remote' as const,
      })),
    ],
    [customCharacters, remoteCharacters, uploadedCharacters],
  );

  const activeBackground = useMemo(
    () => backgrounds.find(item => item.id === activeBackgroundId) ?? null,
    [activeBackgroundId, backgrounds],
  );

  const activeStickers = useMemo(
    () => stickers.filter(item => activeStickerIds.includes(item.id)),
    [activeStickerIds, stickers],
  );

  const refreshUploadedCharacters = useCallback(async () => {
    const stored = await listStoredModels();
    const mapped: CharacterItem[] = stored.map((entry: StoredModelSummary) => ({
      id: `character:upload:${entry.id}`,
      kind: 'character',
      name: entry.name,
      url: '',
      source: 'uploaded',
      modelId: entry.id,
    }));
    setUploadedCharacters(mapped);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setAssetsLoading(true);
      setAssetError(null);
      const [bgResult, stResult, chResult] = await Promise.allSettled([
        loadAssets('background'),
        loadAssets('sticker'),
        loadAssets('character'),
      ]);
      if (!mounted) return;

      const failures = [bgResult, stResult, chResult]
        .filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
        .map(entry =>
          entry.reason instanceof Error ? entry.reason.message : 'Unknown asset load error',
        );

      if (bgResult.status === 'fulfilled') setBackgrounds(bgResult.value);
      if (stResult.status === 'fulfilled') setStickers(stResult.value);
      if (chResult.status === 'fulfilled') setRemoteCharacters(chResult.value);
      if (failures.length) setAssetError(failures.join(' | '));

      await refreshUploadedCharacters();
      setAssetsLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [refreshUploadedCharacters]);

  useEffect(() => {
    if (!characterOptions.length) return;
    const isMissingActive =
      !activeCharacterId || !characterOptions.some(item => item.id === activeCharacterId);
    if (!isMissingActive) return;
    const randomIndex = Math.floor(Math.random() * characterOptions.length);
    setCharacter(characterOptions[randomIndex].id);
  }, [activeCharacterId, characterOptions, setCharacter]);

  useEffect(() => {
    let mounted = true;
    const revokePreviousObjectUrl = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    const selected = characterOptions.find(item => item.id === activeCharacterId);
    if (!selected) return;
    (async () => {
      revokePreviousObjectUrl();
      setModelLoading(true);
      if (selected.source === 'uploaded' && selected.modelId) {
        const blob = await getStoredModelBlob(selected.modelId);
        if (!mounted) return;
        if (!blob) {
          setModelUrl(null);
          setModelLoading(false);
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setModelUrl(objectUrl);
        return;
      }
      setModelUrl(selected.url);
    })();
    return () => {
      mounted = false;
    };
  }, [activeCharacterId, characterOptions]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (initialLoadDone) return;
    if (!assetsLoading && !modelLoading) {
      setInitialLoadDone(true);
    }
  }, [assetsLoading, initialLoadDone, modelLoading]);

  const panelItems = useMemo(() => {
    if (drawerPanel === 'backgrounds') return backgrounds;
    if (drawerPanel === 'stickers') return stickers;
    if (drawerPanel === 'characters') return characterOptions;
    return [];
  }, [backgrounds, characterOptions, drawerPanel, stickers]);

  const gradient = `linear-gradient(165deg, rgba(70, 225, 255, ${bgDimmer}), rgba(20, 52, 88, ${Math.min(
    bgDimmer + 0.1,
    0.6,
  )}))`;
  const backgroundStyle = !activeBackground?.url
    ? {
        backgroundImage: `${gradient}, radial-gradient(circle at 20% 20%, #7bf2ff, #5bc0e8 35%, #1f4d75 100%)`,
      }
    : { backgroundImage: `${gradient}, url("${activeBackground.url}")` };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleModelUpload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!isAllowedVrmFile(file.name)) {
      window.alert('Only .vrm files are allowed.');
      return;
    }
    const modelId = await saveUploadedModel(file);
    await refreshUploadedCharacters();
    setCharacter(`character:upload:${modelId}`);
    showControls();
  };

  const handleLinkImport = () => {
    const raw = window.prompt('Paste VRM URL:');
    if (!raw) return;
    const trimmed = raw.trim();
    if (!isAllowedVrmFile(trimmed)) {
      window.alert('URL must end with .vrm');
      return;
    }
    const id = `character:custom:${trimmed}`;
    setCustomCharacters(prev => {
      if (prev.some(entry => entry.id === id)) return prev;
      return [
        {
          id,
          kind: 'character',
          name: trimmed.split('/').pop() || 'Custom VRM',
          url: trimmed,
          source: 'custom',
        },
        ...prev,
      ];
    });
    setCharacter(id);
    showControls();
  };

  const selectItem = (item: AssetItem | CharacterItem) => {
    if (controlsHidden) showControls();
    if (item.kind === 'background') setBackground(item.id);
    if (item.kind === 'sticker') toggleSticker(item.id);
    if (item.kind === 'character') setCharacter(item.id);
  };

  const handleReset = async () => {
    const shouldReset = window.confirm('Reset settings and remove uploaded models?');
    if (!shouldReset) return;
    stopTracking();
    await clearStoredModels();
    resetUi();
    setCustomCharacters([]);
    setModelUrl(null);
    await refreshUploadedCharacters();
  };

  const handleToggleCamera = async () => {
    if (controlsHidden) showControls();
    if (isTracking) {
      stopTracking();
      return;
    }
    await startTracking();
  };

  const handleToggleBodyTracking = () => {
    if (isTracking) stopTracking();
    setBodyTrackingEnabled(prev => !prev);
  };

  const panelLabel =
    drawerPanel === 'backgrounds'
      ? 'Backgrounds'
      : drawerPanel === 'stickers'
        ? 'Stickers'
        : drawerPanel === 'characters'
          ? 'Characters'
          : drawerPanel === 'settings'
            ? 'Settings'
            : '';
  const loadingText = assetsLoading
    ? 'Loading asset packs...'
    : modelLoading
      ? 'Loading character...'
      : 'Starting camera...';
  const showInitialSplash = !initialLoadDone && (assetsLoading || modelLoading);
  const showStickyLoading = initialLoadDone && (modelLoading || cameraLoading);

  return (
    <div
      className="app-shell"
      style={backgroundStyle}
      onPointerDownCapture={() => {
        if (controlsHidden) showControls();
      }}
    >
      <video ref={cameraRef} className="camera-feed" playsInline muted />
      <input ref={fileInputRef} type="file" accept=".vrm" hidden onChange={handleModelUpload} />

      <div className="canvas-wrap">
        <AvatarCanvas
          modelUrl={modelUrl}
          avatarScale={avatarScale}
          yOffset={yOffset}
          cameraZoom={cameraZoom}
          rigOutput={rigOutput}
          trackingEnabled={isTracking}
          onLoadingChange={setModelLoading}
        />
        <div className="sticker-layer">
          {activeStickers.map((sticker, index) => {
            const pos = STICKER_POSITIONS[index % STICKER_POSITIONS.length];
            return (
              <img
                key={sticker.id}
                className="sticker"
                src={sticker.url}
                alt={sticker.name}
                style={pos}
              />
            );
          })}
        </div>
      </div>

      {!controlsHidden ? (
        <aside className={`drawer ${drawerPanel ? 'open' : ''}`}>
          <div className="drawer-header">
            <div className="drawer-actions">
              <button type="button" onClick={handleUploadClick} title="Upload VRM">
                Upload
              </button>
              <button type="button" onClick={handleLinkImport} title="Import VRM URL">
                Link
              </button>
            </div>
            <button
              type="button"
              className="close-btn"
              onClick={() => setDrawerPanel(null)}
              aria-label="Close panel"
            >
              x
            </button>
          </div>

          <h2>{panelLabel}</h2>
          {drawerPanel === 'settings' ? (
            <div className="settings-panel">
              <p>Camera status: {statusText}</p>
              <p>Body tracking: {bodyTrackingEnabled ? 'On' : 'Off'}</p>
              <button type="button" onClick={handleToggleBodyTracking}>
                {bodyTrackingEnabled ? 'Disable Body Tracking' : 'Enable Body Tracking'}
              </button>
              <button type="button" onClick={calibrateNow}>
                Calibrate Face
              </button>
              <button type="button" onClick={handleReset}>
                Fresh Start
              </button>
            </div>
          ) : (
            <div className="thumb-grid">
              {panelItems.map(item => {
                const active =
                  item.kind === 'background'
                    ? activeBackgroundId === item.id
                    : item.kind === 'sticker'
                      ? activeStickerIds.includes(item.id)
                      : activeCharacterId === item.id;
                const displayName = item.kind === 'character' ? formatCharacterLabel(item.name) : item.name;
                const preview = item.kind === 'character' ? item.previewUrl ?? null : item.url;
                const fallbackInitial = (displayName || item.name).trim().charAt(0).toUpperCase();
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`thumb-card ${active ? 'active' : ''}`}
                    onClick={() => selectItem(item)}
                  >
                    {preview ? (
                      <img
                        src={preview}
                        alt={displayName}
                        className={item.kind === 'character' ? 'character-preview' : undefined}
                      />
                    ) : (
                      <div className="avatar-dot">{fallbackInitial || '?'}</div>
                    )}
                    <span>{displayName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>
      ) : null}

      {!controlsHidden ? (
        <div className="control-rail">
          <button type="button" title="Info">
            i
          </button>
          <button type="button" title="Settings" onClick={() => setDrawerPanel('settings')}>
            gear
          </button>
          <button type="button" title="Effects">
            wand
          </button>
          <button type="button" title="Hide Controls" onClick={toggleControls}>
            eye
          </button>
        </div>
      ) : (
        <button type="button" className="reveal-btn" onClick={toggleControls}>
          eye
        </button>
      )}

      {!controlsHidden ? (
        <div className="menu-cluster">
          <button
            type="button"
            className={`main-button ${isTracking ? 'active' : ''}`}
            onClick={handleToggleCamera}
          >
            {isTracking ? 'live' : 'cam'}
          </button>
          <button
            type="button"
            className="orbit-btn bg visible"
            onClick={() => setDrawerPanel('backgrounds')}
          >
            BG
          </button>
          <button
            type="button"
            className="orbit-btn st visible"
            onClick={() => setDrawerPanel('stickers')}
          >
            ST
          </button>
          <button
            type="button"
            className="orbit-btn ch visible"
            onClick={() => setDrawerPanel('characters')}
          >
            VRM
          </button>
          <button
            type="button"
            className="orbit-btn set visible"
            onClick={() => setDrawerPanel('settings')}
          >
            SET
          </button>
        </div>
      ) : null}

      {showInitialSplash && (
        <div className="splash">
          <div className="spinner" />
          <h1>KJVTuber</h1>
          <p>{loadingText}</p>
        </div>
      )}
      {showStickyLoading && (
        <div className="loading-chip" role="status" aria-live="polite">
          <div className="spinner small" />
          <p>{loadingText}</p>
        </div>
      )}

      {assetError || trackingError ? (
        <p className="error-banner">{assetError || trackingError}</p>
      ) : null}
      <div className="leva-center">
        <Leva collapsed hidden={controlsHidden} fill />
      </div>
    </div>
  );
}

export default App;
