import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { useEffect, useRef, useState } from 'react';
import { Euler, Quaternion } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RigOutput } from '../types/vtuber';

interface AvatarCanvasProps {
  modelUrl: string | null;
  avatarScale: number;
  yOffset: number;
  cameraZoom: number;
  rigOutput: RigOutput | null;
  trackingEnabled: boolean;
  onLoadingChange: (loading: boolean) => void;
}

interface VrmNodeProps {
  modelUrl: string;
  avatarScale: number;
  yOffset: number;
  rigOutput: RigOutput | null;
  trackingEnabled: boolean;
  onLoadingChange: (loading: boolean) => void;
}

interface VrmLoadResult {
  userData: {
    vrm?: {
      scene: object;
      update: (delta: number) => void;
      humanoid?: {
        getNormalizedBoneNode: (name: string) => {
          quaternion: Quaternion;
        } | null;
      };
      expressionManager?: {
        setValue: (key: string, value: number) => void;
      };
    };
  };
}

type RestPoseMap = Record<string, Quaternion>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const applyExpressions = (vrm: NonNullable<VrmLoadResult['userData']['vrm']>, rig: RigOutput) => {
  const face = rig.face;
  if (!face || !vrm.expressionManager) return;
  vrm.expressionManager.setValue('blinkLeft', clamp01(face.eyes.leftBlink));
  vrm.expressionManager.setValue('blinkRight', clamp01(face.eyes.rightBlink));
  vrm.expressionManager.setValue('lookLeft', clamp01(Math.max(0, -face.eyes.lookX)));
  vrm.expressionManager.setValue('lookRight', clamp01(Math.max(0, face.eyes.lookX)));
  vrm.expressionManager.setValue('lookUp', clamp01(Math.max(0, face.eyes.lookY)));
  vrm.expressionManager.setValue('lookDown', clamp01(Math.max(0, -face.eyes.lookY)));
  vrm.expressionManager.setValue('aa', clamp01(face.mouth.a));
  vrm.expressionManager.setValue('ee', clamp01(face.mouth.e));
  vrm.expressionManager.setValue('ih', clamp01(face.mouth.i));
  vrm.expressionManager.setValue('oh', clamp01(face.mouth.o));
  vrm.expressionManager.setValue('ou', clamp01(face.mouth.u));
  vrm.expressionManager.setValue('happy', clamp01(face.expression.smile));
  vrm.expressionManager.setValue('angry', clamp01(face.expression.angry));
  vrm.expressionManager.setValue('sad', clamp01(face.expression.sorrow));
  vrm.expressionManager.setValue('surprised', clamp01(face.expression.surprised));
};

const applyFaceBones = (vrm: NonNullable<VrmLoadResult['userData']['vrm']>, rig: RigOutput) => {
  const face = rig.face;
  if (!face || !vrm.humanoid) return;

  const headBone = vrm.humanoid.getNormalizedBoneNode('head');
  const neckBone = vrm.humanoid.getNormalizedBoneNode('neck');

  if (headBone) {
    const targetHead = new Quaternion(face.head.x, face.head.y, face.head.z, face.head.w);
    headBone.quaternion.slerp(targetHead, 0.4);
  }
  if (neckBone) {
    const targetNeck = new Quaternion(face.neck.x, face.neck.y, face.neck.z, face.neck.w);
    neckBone.quaternion.slerp(targetNeck, 0.3);
  }
};

const applyPoseBones = (vrm: NonNullable<VrmLoadResult['userData']['vrm']>, rig: RigOutput) => {
  const pose = rig.pose;
  if (!pose || !vrm.humanoid) return;

  const slerpBone = (name: string, quat: { x: number; y: number; z: number; w: number }, alpha = 0.25) => {
    const bone = vrm.humanoid?.getNormalizedBoneNode(name);
    if (!bone) return;
    bone.quaternion.slerp(new Quaternion(quat.x, quat.y, quat.z, quat.w), alpha);
  };

  slerpBone('hips', pose.hips, 0.18);
  slerpBone('spine', pose.spine, 0.22);
  slerpBone('chest', pose.chest, 0.24);
  if (pose.upperChest) slerpBone('upperChest', pose.upperChest, 0.24);

  slerpBone('leftUpperArm', pose.leftArm.upper, 0.34);
  slerpBone('leftLowerArm', pose.leftArm.lower, 0.34);
  slerpBone('leftHand', pose.leftArm.hand, 0.34);
  slerpBone('rightUpperArm', pose.rightArm.upper, 0.34);
  slerpBone('rightLowerArm', pose.rightArm.lower, 0.34);
  slerpBone('rightHand', pose.rightArm.hand, 0.34);
};

const applyDefaultArmPose = (
  vrm: NonNullable<VrmLoadResult['userData']['vrm']>,
  rigOutput: RigOutput | null,
  restPoseMap: RestPoseMap,
) => {
  if (!vrm.humanoid) return;
  if (rigOutput?.pose || rigOutput?.hands) return;

  const quatFromEuler = (x: number, y: number, z: number): Quaternion =>
    new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ'));
  const setBone = (name: string, x: number, y: number, z: number, alpha = 0.2) => {
    const bone = vrm.humanoid?.getNormalizedBoneNode(name);
    if (!bone) return;
    const base = restPoseMap[name];
    if (!base) return;
    const target = base.clone().multiply(quatFromEuler(x, y, z));
    bone.quaternion.slerp(target, alpha);
  };
  const setFingerCurl = (side: 'left' | 'right') => {
    setBone(`${side}ThumbProximal`, -0.15, 0, side === 'left' ? -0.15 : 0.15, 0.22);
    setBone(`${side}ThumbDistal`, -0.18, 0, side === 'left' ? -0.12 : 0.12, 0.22);

    setBone(`${side}IndexProximal`, -0.22, 0, 0, 0.22);
    setBone(`${side}IndexIntermediate`, -0.16, 0, 0, 0.22);
    setBone(`${side}IndexDistal`, -0.12, 0, 0, 0.22);

    setBone(`${side}MiddleProximal`, -0.25, 0, 0, 0.22);
    setBone(`${side}MiddleIntermediate`, -0.18, 0, 0, 0.22);
    setBone(`${side}MiddleDistal`, -0.13, 0, 0, 0.22);

    setBone(`${side}RingProximal`, -0.3, 0, 0, 0.22);
    setBone(`${side}RingIntermediate`, -0.22, 0, 0, 0.22);
    setBone(`${side}RingDistal`, -0.15, 0, 0, 0.22);

    setBone(`${side}LittleProximal`, -0.34, 0, 0, 0.22);
    setBone(`${side}LittleIntermediate`, -0.24, 0, 0, 0.22);
    setBone(`${side}LittleDistal`, -0.17, 0, 0, 0.22);
  };

  setBone('leftUpperArm', 0.08, 0, 1.2);
  setBone('rightUpperArm', 0.08, 0, -1.2);
  setBone('leftLowerArm', 0.24, 0, -0.08);
  setBone('rightLowerArm', 0.24, 0, 0.08);
  setBone('leftHand', -0.2, 0, 0.06);
  setBone('rightHand', -0.2, 0, -0.06);
  setFingerCurl('left');
  setFingerCurl('right');
};

const captureRestPose = (vrm: NonNullable<VrmLoadResult['userData']['vrm']>): RestPoseMap => {
  const names = [
    'leftUpperArm',
    'rightUpperArm',
    'leftLowerArm',
    'rightLowerArm',
    'leftHand',
    'rightHand',
    'leftThumbProximal',
    'leftThumbDistal',
    'leftIndexProximal',
    'leftIndexIntermediate',
    'leftIndexDistal',
    'leftMiddleProximal',
    'leftMiddleIntermediate',
    'leftMiddleDistal',
    'leftRingProximal',
    'leftRingIntermediate',
    'leftRingDistal',
    'leftLittleProximal',
    'leftLittleIntermediate',
    'leftLittleDistal',
    'rightThumbProximal',
    'rightThumbDistal',
    'rightIndexProximal',
    'rightIndexIntermediate',
    'rightIndexDistal',
    'rightMiddleProximal',
    'rightMiddleIntermediate',
    'rightMiddleDistal',
    'rightRingProximal',
    'rightRingIntermediate',
    'rightRingDistal',
    'rightLittleProximal',
    'rightLittleIntermediate',
    'rightLittleDistal',
  ];

  const out: RestPoseMap = {};
  for (const name of names) {
    const bone = vrm.humanoid?.getNormalizedBoneNode(name);
    if (bone) {
      out[name] = bone.quaternion.clone();
    }
  }
  return out;
};

function VrmNode({
  modelUrl,
  avatarScale,
  yOffset,
  rigOutput,
  trackingEnabled,
  onLoadingChange,
}: VrmNodeProps) {
  const [scene, setScene] = useState<object | null>(null);
  const vrmRef = useRef<NonNullable<VrmLoadResult['userData']['vrm']> | null>(null);
  const restPoseRef = useRef<RestPoseMap>({});
  const groupRef = useRef<any>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser as any));
    onLoadingChange(true);
    loader.load(
      modelUrl,
      (gltf: VrmLoadResult) => {
        if (!mounted) return;
        const vrm = gltf.userData.vrm;
        if (!vrm) {
          onLoadingChange(false);
          return;
        }
        VRMUtils.rotateVRM0(vrm as any);
        vrmRef.current = vrm;
        restPoseRef.current = captureRestPose(vrm);
        setScene(vrm.scene);
        onLoadingChange(false);
      },
      undefined,
      () => {
        if (!mounted) return;
        onLoadingChange(false);
      },
    );
    return () => {
      mounted = false;
      vrmRef.current = null;
      restPoseRef.current = {};
      setScene(null);
    };
  }, [modelUrl, onLoadingChange]);

  useFrame((_state, delta) => {
    timeRef.current += delta;
    const group = groupRef.current;
    if (!group) return;
    group.position.y = yOffset + (trackingEnabled ? 0 : Math.sin(timeRef.current * 1.5) * 0.01);
    const vrm = vrmRef.current;
    if (!vrm) return;
    applyDefaultArmPose(vrm, rigOutput, restPoseRef.current);
    if (trackingEnabled && rigOutput) {
      applyPoseBones(vrm, rigOutput);
      applyFaceBones(vrm, rigOutput);
      applyExpressions(vrm, rigOutput);
    }
    vrm.update(delta);
  });

  if (!scene) return null;
  return (
    <group ref={groupRef} scale={avatarScale} position={[0, yOffset, 0]}>
      <primitive object={scene} />
    </group>
  );
}

function Lighting() {
  const ambientRef = useRef<any>(null);
  const keyRef = useRef<any>(null);
  const rimRef = useRef<any>(null);
  return (
    <>
      <ambientLight ref={ambientRef} intensity={1.2} />
      <directionalLight ref={keyRef} position={[2, 3, 2]} intensity={1.1} />
      <directionalLight ref={rimRef} position={[-2, 2, -1]} intensity={0.75} />
    </>
  );
}

function CameraRig({ cameraZoom, controlsRef }: {
  cameraZoom: number;
  controlsRef: React.RefObject<any>;
}) {
  const { camera } = useThree();

  useEffect(() => {
    const eyeLevelY = 1.12;
    camera.position.set(0, eyeLevelY, cameraZoom);
    camera.lookAt(0, eyeLevelY, 0);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, eyeLevelY, 0);
      controlsRef.current.update();
    }
  }, [camera, cameraZoom, controlsRef]);

  return null;
}

export function AvatarCanvas({
  modelUrl,
  avatarScale,
  yOffset,
  cameraZoom,
  rigOutput,
  trackingEnabled,
  onLoadingChange,
}: AvatarCanvasProps) {
  const controlsRef = useRef<any>(null);

  return (
    <Canvas dpr={[1, 2]} camera={{ fov: 30 }} gl={{ alpha: true }} style={{ background: 'transparent' }}>
      <CameraRig cameraZoom={cameraZoom} controlsRef={controlsRef} />
      <Lighting />
      {modelUrl ? (
        <VrmNode
          modelUrl={modelUrl}
          avatarScale={avatarScale}
          yOffset={yOffset}
          rigOutput={rigOutput}
          trackingEnabled={trackingEnabled}
          onLoadingChange={onLoadingChange}
        />
      ) : null}
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={false} enableRotate={false} />
    </Canvas>
  );
}
