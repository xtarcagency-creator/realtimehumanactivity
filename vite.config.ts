import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // pose-detection statically imports BlazePose's @mediapipe/pose, which we
      // don't use (MoveNet only) and which breaks strict ESM builds. See
      // src/stubs/mediapipe-pose-stub.ts for details.
      '@mediapipe/pose': path.resolve(import.meta.dirname, 'src/stubs/mediapipe-pose-stub.ts'),
    },
  },
})
