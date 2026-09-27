import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Cho phép đọc địa chỉ + ABI contract ở ../contracts/deployments (nằm ngoài thư mục frontend)
      allow: [searchForWorkspaceRoot(process.cwd()), '../contracts/deployments'],
    },
  },
})
