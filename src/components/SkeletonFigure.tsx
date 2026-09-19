// A single full-figure pose skeleton built from the same 17-keypoint COCO
// layout the analyzer itself tracks — the signature visual section's
// centerpiece, not decorative stock art.
const KEYPOINTS: Record<string, [number, number]> = {
  nose: [50, 8],
  left_eye: [47, 6],
  right_eye: [53, 6],
  left_ear: [44, 7],
  right_ear: [56, 7],
  left_shoulder: [38, 22],
  right_shoulder: [62, 22],
  left_elbow: [30, 38],
  right_elbow: [70, 38],
  left_wrist: [26, 54],
  right_wrist: [74, 54],
  left_hip: [42, 54],
  right_hip: [58, 54],
  left_knee: [40, 74],
  right_knee: [60, 74],
  left_ankle: [38, 94],
  right_ankle: [62, 94],
}

const BONES: [string, string][] = [
  ['left_ear', 'left_eye'],
  ['right_ear', 'right_eye'],
  ['left_eye', 'nose'],
  ['right_eye', 'nose'],
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
]

export default function SkeletonFigure() {
  return (
    <svg className="skeleton-figure" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {BONES.map(([a, b], i) => {
        const [x1, y1] = KEYPOINTS[a]
        const [x2, y2] = KEYPOINTS[b]
        return (
          <line
            key={`${a}-${b}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className="skeleton-bone"
            style={{ animationDelay: `${i * 45}ms` }}
          />
        )
      })}
      {Object.entries(KEYPOINTS).map(([name, [x, y]], i) => (
        <g key={name} className="skeleton-joint-group" style={{ animationDelay: `${400 + i * 35}ms` }}>
          <circle cx={x} cy={y} r={1.4} className="skeleton-joint" />
          <text x={x + 2.2} y={y - 1.6} className="skeleton-coord">
            {x.toFixed(0)},{y.toFixed(0)}
          </text>
        </g>
      ))}
    </svg>
  )
}
