const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

const VRM_EXTENSIONS = new Set(['.vrm']);

const getExtension = (value: string): string => {
  const clean = value.split('?')[0].split('#')[0].toLowerCase();
  const dotIndex = clean.lastIndexOf('.');
  return dotIndex === -1 ? '' : clean.slice(dotIndex);
};

export const isAllowedImageFile = (value: string): boolean =>
  IMAGE_EXTENSIONS.has(getExtension(value));

export const isAllowedVrmFile = (value: string): boolean => VRM_EXTENSIONS.has(getExtension(value));
