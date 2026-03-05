import { isAllowedImageFile, isAllowedVrmFile } from './fileValidation';

export type AssetKind = 'background' | 'sticker' | 'character';

export interface AssetItem {
  id: string;
  name: string;
  url: string;
  kind: AssetKind;
  previewUrl?: string;
}

interface GithubContentFile {
  type: 'file' | 'dir';
  name: string;
  path: string;
  download_url: string | null;
}

const PUBLIC_ASSET_GLOB = {
  ...(import.meta.glob('/public/**/*.{png,jpg,jpeg,webp,gif,svg,avif}', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>),
  ...(import.meta.glob('/public/**/*.vrm', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>),
};

const SOURCE_ENV_KEY: Record<
  AssetKind,
  'VITE_BG_SOURCE_URL' | 'VITE_STICKER_SOURCE_URL' | 'VITE_CHARACTER_SOURCE_URL'
> = {
  background: 'VITE_BG_SOURCE_URL',
  sticker: 'VITE_STICKER_SOURCE_URL',
  character: 'VITE_CHARACTER_SOURCE_URL',
};

const toGithubContentsApi = (source: string): string => {
  if (source.includes('/repos/') && source.includes('/contents/')) return source;
  try {
    const parsed = new URL(source);
    if (parsed.hostname !== 'github.com') return source;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const treeIndex = parts.indexOf('tree');
    if (parts.length < 4 || treeIndex === -1 || treeIndex + 1 >= parts.length) {
      return source;
    }
    const owner = parts[0];
    const repo = parts[1];
    const branch = parts[treeIndex + 1];
    const path = parts.slice(treeIndex + 2).join('/');
    if (!owner || !repo || !branch || !path) return source;
    return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  } catch {
    return source;
  }
};

const extensionAllowed = (kind: AssetKind, filename: string): boolean => {
  if (kind === 'character') return isAllowedVrmFile(filename);
  return isAllowedImageFile(filename);
};
const isIgnoredPath = (path: string): boolean => /(^|\/)archive(\/|$)/i.test(path);

const stripExtension = (name: string): string => name.replace(/\.[^/.]+$/, '');

const makeSiblingKey = (path: string): string => {
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : path.slice(0, lastSlash);
  const filename = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  return `${dir}/${stripExtension(filename).toLowerCase()}`;
};

type SourceConfig =
  | {
      mode: 'remote';
      endpoint: string;
    }
  | {
      mode: 'public-folder';
      folder: string;
    };

const isRemoteUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizePublicFolder = (value: string): string => {
  let folder = value.trim();
  if (folder.startsWith('./')) folder = folder.slice(2);
  if (folder.startsWith('/')) folder = folder.slice(1);
  if (folder.startsWith('public/')) folder = folder.slice('public/'.length);
  folder = folder.replace(/\/+$/, '');
  return folder;
};

const normalizeSource = (kind: AssetKind): SourceConfig => {
  const key = SOURCE_ENV_KEY[kind];
  const raw = import.meta.env[key]?.trim();
  if (!raw) {
    throw new Error(`Missing required env var: ${key}`);
  }
  if (isRemoteUrl(raw)) {
    return { mode: 'remote', endpoint: toGithubContentsApi(raw) };
  }
  return { mode: 'public-folder', folder: normalizePublicFolder(raw) };
};

const loadFromPublicFolder = (kind: AssetKind, folder: string): AssetItem[] => {
  const prefix = folder ? `/public/${folder}/` : '/public/';
  const entries = Object.entries(PUBLIC_ASSET_GLOB).filter(
    ([path]) => path.startsWith(prefix) && !isIgnoredPath(path),
  );
  if (kind !== 'character') {
    return entries
      .filter(([path]) => extensionAllowed(kind, path))
      .map(([path, url]) => ({
        id: `${kind}:${path.replace('/public/', '')}`,
        name: path.split('/').pop() ?? path,
        url,
        kind,
      }));
  }

  const imageBySibling = new Map<string, string>();
  for (const [path, url] of entries) {
    if (isAllowedImageFile(path)) {
      imageBySibling.set(makeSiblingKey(path), url);
    }
  }
  return entries
    .filter(([path]) => isAllowedVrmFile(path))
    .map(([path, url]) => ({
      id: `${kind}:${path.replace('/public/', '')}`,
      name: path.split('/').pop() ?? path,
      url,
      kind,
      previewUrl: imageBySibling.get(makeSiblingKey(path)),
    }));
};

export const loadAssets = async (kind: AssetKind): Promise<AssetItem[]> => {
  const source = normalizeSource(kind);
  if (source.mode === 'public-folder') {
    return loadFromPublicFolder(kind, source.folder);
  }

  const endpoint = source.endpoint;
  const response = await fetch(endpoint, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to load ${kind} assets (${response.status})`);
  }
  const data = (await response.json()) as GithubContentFile[] | GithubContentFile;
  const files = Array.isArray(data) ? data : [data];
  const fileEntries = files.filter(
    (entry): entry is GithubContentFile =>
      entry.type === 'file' && typeof entry.download_url === 'string' && !!entry.download_url,
  );
  if (kind !== 'character') {
    return fileEntries
      .filter(entry => !isIgnoredPath(entry.path))
      .filter(entry => extensionAllowed(kind, entry.name))
      .map(entry => ({
        id: `${kind}:${entry.path}`,
        name: entry.name,
        url: entry.download_url as string,
        kind,
      }));
  }

  const imageBySibling = new Map<string, string>();
  for (const entry of fileEntries) {
    if (isIgnoredPath(entry.path)) continue;
    if (isAllowedImageFile(entry.name)) {
      imageBySibling.set(makeSiblingKey(entry.path), entry.download_url as string);
    }
  }
  return fileEntries
    .filter(entry => !isIgnoredPath(entry.path))
    .filter(entry => isAllowedVrmFile(entry.name))
    .map(entry => ({
      id: `${kind}:${entry.path}`,
      name: entry.name,
      url: entry.download_url as string,
      kind,
      previewUrl: imageBySibling.get(makeSiblingKey(entry.path)),
    }));
};
