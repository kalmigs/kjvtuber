export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export type HandSide = 'left' | 'right';

export interface Landmark2D extends Vec2 {
  visibility?: number;
  presence?: number;
}

export interface Landmark3D extends Vec3 {
  visibility?: number;
  presence?: number;
}

export interface FaceBlendshape {
  categoryName: string;
  score: number;
}

export interface FaceTrackingResult {
  landmarks: Landmark3D[];
  blendshapes: FaceBlendshape[];
  facialMatrix?: number[];
  confidence: number;
}

export interface PoseTrackingResult {
  landmarks: Landmark3D[];
  confidence: number;
}

export interface HandTrackingResult {
  side: HandSide;
  landmarks: Landmark3D[];
  confidence: number;
}

export interface TrackingFrame {
  timestampMs: number;
  face?: FaceTrackingResult;
  pose?: PoseTrackingResult;
  hands: HandTrackingResult[];
}

export interface RigFace {
  neck: Quat;
  head: Quat;
  eyes: {
    leftBlink: number;
    rightBlink: number;
    lookX: number;
    lookY: number;
  };
  mouth: {
    a: number;
    e: number;
    i: number;
    o: number;
    u: number;
  };
  expression: {
    smile: number;
    angry: number;
    sorrow: number;
    surprised: number;
  };
}

export interface RigArm {
  upper: Quat;
  lower: Quat;
  hand: Quat;
}

export interface RigPose {
  hips: Quat;
  spine: Quat;
  chest: Quat;
  upperChest?: Quat;
  neck: Quat;
  leftArm: RigArm;
  rightArm: RigArm;
}

export interface RigFinger {
  proximal: Quat;
  intermediate: Quat;
  distal: Quat;
}

export interface RigHand {
  wrist: Quat;
  thumb: RigFinger;
  index: RigFinger;
  middle: RigFinger;
  ring: RigFinger;
  little: RigFinger;
}

export interface RigHands {
  left?: RigHand;
  right?: RigHand;
}

export interface RigOutput {
  timestampMs: number;
  face?: RigFace;
  pose?: RigPose;
  hands?: RigHands;
}

export interface SmoothingConfig {
  enabled: boolean;
  factor: number;
}

export interface ThresholdConfig {
  face: number;
  pose: number;
  hand: number;
}

export interface CalibrationOffsets {
  headYaw: number;
  headPitch: number;
  headRoll: number;
  shoulderYaw: number;
}

export interface RuntimeSettings {
  mirrorVideo: boolean;
  autoBlink: boolean;
  smoothing: {
    face: SmoothingConfig;
    pose: SmoothingConfig;
    hands: SmoothingConfig;
  };
  thresholds: ThresholdConfig;
  camera: {
    facingMode: 'user' | 'environment';
    width?: number;
    height?: number;
    fps?: number;
  };
  calibration: CalibrationOffsets;
}

export interface StoredModelRecord {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedAppState {
  activeModelId?: string;
  settings: RuntimeSettings;
}
