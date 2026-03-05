import { isAllowedImageFile, isAllowedVrmFile } from './fileValidation';

export type AssetKind = 'background' | 'sticker' | 'character';

export interface AssetItem {
  id: string;
  name: string;
  url: string;
  kind: AssetKind;
}

interface GithubContentFile {
  type: 'file' | 'dir';
  name: string;
  path: string;
  download_url: string | null;
}

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

const normalizeSourceUrl = (kind: AssetKind): string => {
  const key = SOURCE_ENV_KEY[kind];
  const raw = import.meta.env[key]?.trim();
  if (!raw) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return toGithubContentsApi(raw);
};

export const loadAssets = async (kind: AssetKind): Promise<AssetItem[]> => {
  const endpoint = normalizeSourceUrl(kind);
  const response = await fetch(endpoint, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to load ${kind} assets (${response.status})`);
  }
  const data = (await response.json()) as GithubContentFile[] | GithubContentFile;
  const files = Array.isArray(data) ? data : [data];
  return files
    .filter(entry => entry.type === 'file' && !!entry.download_url)
    .filter(entry => extensionAllowed(kind, entry.name))
    .map(entry => ({
      id: `${kind}:${entry.path}`,
      name: entry.name,
      url: entry.download_url as string,
      kind,
    }));
};
