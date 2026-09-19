// pose-detection statically imports `Pose` from @mediapipe/pose for its optional
// BlazePose runtime, which this app doesn't use (MoveNet only). @mediapipe/pose
// ships as a UMD build without a real `Pose` named export, which strict ESM
// bundlers reject — so this stub is aliased in for build purposes only.
export class Pose {
  constructor() {
    throw new Error('BlazePose (@mediapipe/pose) is not used by this app.')
  }
}
