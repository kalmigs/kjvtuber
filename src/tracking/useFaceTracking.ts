import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Euler, Matrix4, Quaternion } from 'three';
import type { RigOutput } from '../types/vtuber';

const DEFAULT_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const mapBlendshapes = (result: FaceLandmarkerResult): Record<string, number> => {
  const categories = result.faceBlendshapes?.[0]?.categories ?? [];
  const out: Record<string, number> = {};
  for (const entry of categories) {
    out[entry.categoryName] = entry.score;
  }
  return out;
};

interface FaceBaseline {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface FaceTrackingController {
  isTracking: boolean;
  isLoading: boolean;
  statusText: string;
  error: string | null;
  rigOutput: RigOutput | null;
  startTracking: () => Promise<void>;
  stopTracking: () => void;
  calibrateNow: () => void;
}

export function useFaceTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
): FaceTrackingController {
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const baselineRef = useRef<FaceBaseline>({ yaw: 0, pitch: 0, roll: 0 });
  const shouldCalibrateRef = useRef(true);
  const trackingActiveRef = useRef(false);
  const smoothHeadRef = useRef(new Quaternion());
  const smoothNeckRef = useRef(new Quaternion());

  const [isTracking, setIsTracking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('Camera off');
  const [error, setError] = useState<string | null>(null);
  const [rigOutput, setRigOutput] = useState<RigOutput | null>(null);

  const stopTracking = useCallback(() => {
    trackingActiveRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setIsTracking(false);
    setStatusText('Camera off');
  }, [videoRef]);

  useEffect(() => () => stopTracking(), [stopTracking]);

  const calibrateNow = useCallback(() => {
    shouldCalibrateRef.current = true;
    setStatusText('Calibration queued');
  }, []);

  const ensureLandmarker = useCallback(async (): Promise<FaceLandmarker> => {
    if (landmarkerRef.current) return landmarkerRef.current;
    const wasmUrl = import.meta.env.VITE_MEDIAPIPE_WASM_URL || DEFAULT_WASM_URL;
    const modelUrl = import.meta.env.VITE_MEDIAPIPE_FACE_MODEL_URL || DEFAULT_MODEL_URL;
    const vision = await FilesetResolver.forVisionTasks(wasmUrl);
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelUrl,
        delegate: 'GPU',
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      numFaces: 1,
      runningMode: 'VIDEO',
    });
    landmarkerRef.current = landmarker;
    return landmarker;
  }, []);

  const startTracking = useCallback(async () => {
    const video = videoRef.current;
    if (!video || isTracking) return;
    setError(null);
    setIsLoading(true);
    setStatusText('Starting camera...');
    shouldCalibrateRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 960, height: 540 },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      const landmarker = await ensureLandmarker();
      setIsTracking(true);
      trackingActiveRef.current = true;
      setStatusText('Tracking face');
      setIsLoading(false);

      const matrix = new Matrix4();
      const euler = new Euler(0, 0, 0, 'XYZ');
      const rawHead = new Quaternion();
      const rawNeck = new Quaternion();

      const tick = () => {
        if (!videoRef.current || !trackingActiveRef.current) return;
        const result = landmarker.detectForVideo(videoRef.current, performance.now());
        const faceMatrix = result.facialTransformationMatrixes?.[0]?.data;
        const blendshapeMap = mapBlendshapes(result);
        if (faceMatrix) {
          matrix.fromArray(faceMatrix);
          euler.setFromRotationMatrix(matrix);

          if (shouldCalibrateRef.current) {
            baselineRef.current = {
              yaw: euler.y,
              pitch: euler.x,
              roll: euler.z,
            };
            shouldCalibrateRef.current = false;
            setStatusText('Tracking face');
          }

          const yaw = euler.y - baselineRef.current.yaw;
          const pitch = euler.x - baselineRef.current.pitch;
          const roll = euler.z - baselineRef.current.roll;

          rawHead.setFromEuler(new Euler(-pitch * 0.95, yaw * 1.05, roll * 0.85, 'XYZ'));
          rawNeck.setFromEuler(new Euler(-pitch * 0.4, yaw * 0.5, roll * 0.3, 'XYZ'));
          smoothHeadRef.current.slerp(rawHead, 0.28);
          smoothNeckRef.current.slerp(rawNeck, 0.28);

          setRigOutput({
            timestampMs: performance.now(),
            face: {
              head: {
                x: smoothHeadRef.current.x,
                y: smoothHeadRef.current.y,
                z: smoothHeadRef.current.z,
                w: smoothHeadRef.current.w,
              },
              neck: {
                x: smoothNeckRef.current.x,
                y: smoothNeckRef.current.y,
                z: smoothNeckRef.current.z,
                w: smoothNeckRef.current.w,
              },
              eyes: {
                leftBlink: clamp(blendshapeMap.eyeBlinkLeft ?? 0, 0, 1),
                rightBlink: clamp(blendshapeMap.eyeBlinkRight ?? 0, 0, 1),
                lookX: clamp(
                  (blendshapeMap.eyeLookOutLeft ?? 0) -
                    (blendshapeMap.eyeLookInLeft ?? 0) +
                    (blendshapeMap.eyeLookOutRight ?? 0) -
                    (blendshapeMap.eyeLookInRight ?? 0),
                  -1,
                  1,
                ),
                lookY: clamp(
                  (blendshapeMap.eyeLookUpLeft ?? 0) +
                    (blendshapeMap.eyeLookUpRight ?? 0) -
                    (blendshapeMap.eyeLookDownLeft ?? 0) -
                    (blendshapeMap.eyeLookDownRight ?? 0),
                  -1,
                  1,
                ),
              },
              mouth: {
                a: clamp(blendshapeMap.jawOpen ?? 0, 0, 1),
                e: clamp(blendshapeMap.mouthSmileLeft ?? 0, 0, 1),
                i: clamp(blendshapeMap.mouthShrugUpper ?? 0, 0, 1),
                o: clamp(blendshapeMap.mouthFunnel ?? 0, 0, 1),
                u: clamp(blendshapeMap.mouthPucker ?? 0, 0, 1),
              },
              expression: {
                smile: clamp(
                  (blendshapeMap.mouthSmileLeft ?? 0) * 0.5 +
                    (blendshapeMap.mouthSmileRight ?? 0) * 0.5,
                  0,
                  1,
                ),
                angry: clamp(blendshapeMap.browDownLeft ?? 0, 0, 1),
                sorrow: clamp(blendshapeMap.browInnerUp ?? 0, 0, 1),
                surprised: clamp(blendshapeMap.eyeWideLeft ?? 0, 0, 1),
              },
            },
          });
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setIsLoading(false);
      setIsTracking(false);
      setStatusText('Camera unavailable');
      setError(err instanceof Error ? err.message : 'Failed to start camera.');
      stopTracking();
    }
  }, [ensureLandmarker, isTracking, stopTracking, videoRef]);

  return {
    isTracking,
    isLoading,
    statusText,
    error,
    rigOutput,
    startTracking,
    stopTracking,
    calibrateNow,
  };
}
